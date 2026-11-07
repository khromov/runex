//! The macOS side of turning winit's loop from JavaScript's (`Pump::tick`).
//!
//! A turn of the loop runs `[NSApp run]` until winit stops it, which costs about half a
//! millisecond even with nothing to do; an idle app polled for input every few milliseconds
//! would spend several percent of a core on it. Peeking at AppKit's queue costs a fraction of
//! that, so an idle tick peeks and pumps only when something is there. Elsewhere a turn of the
//! loop is already a cheap peek (`PeekMessage`, a zero-timeout `epoll`).
//!
//! winit ends a turn from a before-waiting observer: `[NSApp stop:]`, then a dummy event posted
//! so that `run` wakes, takes it and returns. Two things go wrong around that:
//! - In a process linked against the macOS 26 SDK or later (Bun 1.4 is, Node 26 isn't), AppKit's
//!   update cycle holds events back from `run` for part of each display frame. Until it lets
//!   the dummy through, the run loop goes round, and each pass stops the app again and posts
//!   another dummy: a turn spun for up to a frame and left hundreds of dummies queued.
//!   [`pumping`] turns the update cycle off (`NSApplicationUpdateCycleEnabled`, in the
//!   registration domain, so a user default still wins), as it is for older SDKs. Should a
//!   dummy still be held, the passes that follow wait a little first, and their dummies go.
//! - A dummy can still be left queued after a turn. It means nothing once `run` has returned,
//!   so the peek drops it rather than pumping for it.
//!
//! Peeking runs the run loop, outside winit's handler:
//! - In the default mode, the run loop also delivers window notifications, and winit drops the
//!   events it makes of them when its handler isn't set. An idle window's occlusion changes came
//!   there, so a window covered while it drew and uncovered while idle stayed covered for Rune
//!   and never drew again. The peek runs in a mode of its own instead. AppKit's event source
//!   serves any mode, so input still shows; the default mode's other sources (occlusion, the
//!   appearance, winit's queued closures, such as a scale change) wait for the next turn: the
//!   one for the input that came with them, or at most a second later (`SAFETY_TURN`).
//! - AppKit may handle Apple events there. A Quit would end the process without Rune's exit
//!   (close hooks, trace). Quit goes to a handler of ours instead, and the next turn quits from
//!   inside winit's loop.

#[cfg(target_os = "macos")]
pub use mac::{exited, os_events_pending, pumping};

/// True when a turn of the loop may find OS events to dispatch.
#[cfg(not(target_os = "macos"))]
pub fn os_events_pending() -> bool {
    true
}

/// Runs `f`, a turn of the loop.
#[cfg(not(target_os = "macos"))]
pub fn pumping<R>(f: impl FnOnce() -> R) -> R {
    f()
}

/// The loop has ended.
#[cfg(not(target_os = "macos"))]
pub fn exited() {}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::Cell;
    use std::ffi::c_void;
    use std::time::Duration;

    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, NSObject, Sel};
    use objc2::{class, msg_send, sel, ClassType};
    use objc2_app_kit::{NSApplication, NSEvent, NSEventMask, NSEventSubtype, NSEventType};
    use objc2_foundation::{ns_string, MainThreadMarker, NSDate, NSString};

    type CFRunLoopRef = *mut c_void;
    type CFStringRef = *const c_void;
    type Callout = extern "C" fn(*mut c_void, usize, *mut c_void);

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFRunLoopDefaultMode: CFStringRef;
        fn CFRunLoopGetMain() -> CFRunLoopRef;
        fn CFRunLoopObserverCreate(allocator: *const c_void, activities: usize, repeats: u8, order: isize, callout: Callout, context: *mut c_void) -> *mut c_void;
        fn CFRunLoopAddObserver(rl: CFRunLoopRef, observer: *mut c_void, mode: CFStringRef);
    }

    /// `kCFRunLoopBeforeWaiting`.
    const BEFORE_WAITING: usize = 1 << 5;
    /// `'aevt'` and `'quit'`: `kCoreEventClass` and `kAEQuitApplication`.
    const CORE_EVENT: u32 = u32::from_be_bytes(*b"aevt");
    const QUIT_APP: u32 = u32::from_be_bytes(*b"quit");
    /// Stale dummies one peek drops at most; the next turn takes any left.
    const DROP_MAX: usize = 8;
    /// Dummies dropped after a held turn at most.
    const DRAIN_MAX: u32 = 64;
    /// A pass of the run loop while AppKit holds winit's dummy back waits this long first.
    const HELD_PASS: Duration = Duration::from_micros(200);

    thread_local! {
        /// While `Pump::tick` turns the loop.
        static PUMPING: Cell<bool> = const { Cell::new(false) };
        /// Before-waiting passes this turn that found the app stopped (one when all is well).
        static STOPPED: Cell<u32> = const { Cell::new(0) };
        /// Until the loop ends. Quit then falls back to AppKit's own behavior.
        static LIVE: Cell<bool> = const { Cell::new(true) };
        /// A Quit that came while peeking, for the next turn.
        static QUIT: Cell<bool> = const { Cell::new(false) };
        /// 0: nothing installed, 1: the observer, 2: the observer and the Quit handler.
        static INSTALLED: Cell<u8> = const { Cell::new(0) };
    }

    /// True when a turn of the loop would find something to do: queued input, or a Quit.
    pub fn os_events_pending() -> bool {
        let Some(mtm) = MainThreadMarker::new() else { return true };
        autoreleasepool(|_| {
            let app = NSApplication::sharedApplication(mtm);
            for _ in 0..DROP_MAX {
                // Not dequeued: the next turn dispatches it.
                let Some(event) = next(&app, NSEventMask::Any, false) else { return QUIT.get() };
                if !is_stop(&event) || !drop_stop(&app) {
                    return true;
                }
            }
            true
        })
    }

    /// Runs `f`, a turn of winit's loop, with the observer that keeps its end cheap (see the
    /// module's docs) and a Quit that came while peeking.
    pub fn pumping<R>(f: impl FnOnce() -> R) -> R {
        struct Reset;
        impl Drop for Reset {
            fn drop(&mut self) {
                PUMPING.set(false);
            }
        }
        let Some(mtm) = MainThreadMarker::new() else { return f() };
        if INSTALLED.get() == 0 {
            no_update_cycle();
            add_observer();
            INSTALLED.set(1);
        }
        STOPPED.set(0);
        PUMPING.set(true);
        let reset = Reset;
        let result = f();
        drop(reset);
        // Each pass after the first posted a dummy that `run` never took.
        let extra = STOPPED.get().saturating_sub(1).min(DRAIN_MAX);
        if extra > 0 {
            autoreleasepool(|_| {
                let app = NSApplication::sharedApplication(mtm);
                for _ in 0..extra {
                    if !drop_stop(&app) {
                        break;
                    }
                }
            });
        }
        // After the first turn, which finishes launching: AppKit has its own handlers by then.
        if INSTALLED.get() == 1 {
            install_quit();
            INSTALLED.set(2);
        }
        result
    }

    /// The loop has ended: a Quit now quits at once, as AppKit's own handler would.
    pub fn exited() {
        LIVE.set(false);
        QUIT.set(false);
    }

    /// The next event matching `mask`, if one is queued or waiting at the window server. The
    /// run loop runs in a mode of its own, so no other source delivers anything (module docs).
    fn next(app: &NSApplication, mask: NSEventMask, dequeue: bool) -> Option<Retained<NSEvent>> {
        // SAFETY: on the main thread (the callers hold a MainThreadMarker); the mode is a
        // static string.
        unsafe { app.nextEventMatchingMask_untilDate_inMode_dequeue(mask, Some(&NSDate::distantPast()), ns_string!("RunexPeekMode"), dequeue) }
    }

    /// winit's `dummy_event()`: an ApplicationDefined event with no window, time or data.
    fn is_stop(event: &NSEvent) -> bool {
        // SAFETY: plain property reads of a live event.
        unsafe {
            event.r#type() == NSEventType::ApplicationDefined
                && event.subtype() == NSEventSubtype::WindowExposed
                && event.data1() == 0
                && event.data2() == 0
                && event.windowNumber() == 0
                && event.timestamp() == 0.0
        }
    }

    /// Dequeues the first ApplicationDefined event if it's a stale dummy (else puts it back).
    /// False when there was none to drop.
    fn drop_stop(app: &NSApplication) -> bool {
        match next(app, NSEventMask::ApplicationDefined, true) {
            Some(event) if is_stop(&event) => true,
            Some(event) => {
                app.postEvent_atStart(&event, true);
                false
            }
            None => false,
        }
    }

    /// Registers `NSApplicationUpdateCycleEnabled = NO`. AppKit reads it as it runs, so before
    /// the first turn is soon enough.
    fn no_update_cycle() {
        // SAFETY: Foundation calls with live objects; the dictionary is autoreleased.
        autoreleasepool(|_| unsafe {
            let defaults: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
            let no: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: Bool::NO];
            let key = NSString::from_str("NSApplicationUpdateCycleEnabled");
            let values: *mut AnyObject = msg_send![class!(NSDictionary), dictionaryWithObject: no, forKey: &*key];
            if let Some(defaults) = defaults.as_ref() {
                let _: () = msg_send![defaults, registerDefaults: values];
            }
        })
    }

    /// Last of the default mode's before-waiting observers, so after winit's (`cleared`, which
    /// stops the app to end a turn). Added once, for the process.
    fn add_observer() {
        // SAFETY: CoreFoundation calls on the main thread; the observer lives for the process.
        unsafe {
            let observer = CFRunLoopObserverCreate(std::ptr::null(), BEFORE_WAITING, 1, isize::MAX, before_waiting, std::ptr::null_mut());
            if !observer.is_null() {
                CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopDefaultMode);
            }
        }
    }

    extern "C" fn before_waiting(_: *mut c_void, _: usize, _: *mut c_void) {
        if !PUMPING.get() {
            return;
        }
        let Some(mtm) = MainThreadMarker::new() else { return };
        let app = NSApplication::sharedApplication(mtm);
        // SAFETY: a property read on the main thread.
        if unsafe { app.isRunning() } {
            return;
        }
        // winit has stopped the app from its idle handler, so a quit here runs its exit.
        if QUIT.replace(false) {
            // SAFETY: on the main thread. With winit's delegate it doesn't return.
            unsafe { app.terminate(None) };
        }
        let passes = STOPPED.get();
        STOPPED.set(passes + 1);
        // A pass after the stop: `run` hasn't taken winit's dummy, as AppKit is holding it back.
        // Going round again at once only posts another; the hold ends when AppKit lets it through.
        if passes > 0 {
            std::thread::sleep(HELD_PASS);
        }
    }

    /// Takes Quit Apple events (the Dock's Quit, logout, `quit app`) from AppKit.
    fn install_quit() {
        let Some(handler) = quit_handler() else { return };
        // SAFETY: Foundation calls on the main thread; the handler lives for the process.
        autoreleasepool(|_| unsafe {
            let manager: *mut AnyObject = msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
            if let Some(manager) = manager.as_ref() {
                let _: () = msg_send![manager, setEventHandler: handler, andSelector: sel!(handleQuitEvent:withReplyEvent:),
                    forEventClass: CORE_EVENT, andEventID: QUIT_APP];
            }
        })
    }

    /// The handler object, made once and never released (the event manager doesn't retain it).
    fn quit_handler() -> Option<&'static AnyObject> {
        const NAME: &str = "RunexQuitHandler";
        let class = AnyClass::get(NAME).or_else(|| {
            let mut builder = ClassBuilder::new(NAME, NSObject::class())?;
            // SAFETY: the function matches `handleQuitEvent:withReplyEvent:` (two objects, void).
            unsafe { builder.add_method(sel!(handleQuitEvent:withReplyEvent:), handle_quit as extern "C" fn(_, _, _, _)) };
            Some(builder.register())
        })?;
        // SAFETY: `new` on an NSObject subclass; the +1 reference is kept for the process.
        let made: *mut AnyObject = unsafe { msg_send![class, new] };
        // SAFETY: just made, never released.
        unsafe { made.as_ref() }
    }

    extern "C" fn handle_quit(_: &AnyObject, _: Sel, _event: *mut AnyObject, _reply: *mut AnyObject) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        if LIVE.get() {
            // From a peek, or from inside a turn: the turn's end quits (see `before_waiting`).
            QUIT.set(true);
        } else {
            // SAFETY: on the main thread.
            unsafe { NSApplication::sharedApplication(mtm).terminate(None) };
        }
    }
}
