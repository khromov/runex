//! The bridge between Rune's callbacks and JavaScript.
//!
//! Rune calls views and handlers on the main thread while JavaScript is inside a call into the
//! addon (`Pump::tick`, `App::run`), so those callbacks call straight back into JavaScript with
//! the env that call carried. A thrown exception can't unwind through Rune: it is caught here,
//! kept, and rethrown to JavaScript when the outer call returns.

use std::cell::{Cell, RefCell};
use std::ptr;

use napi::bindgen_prelude::ToNapiValue;
use napi::sys;

thread_local! {
    static ENV: Cell<sys::napi_env> = const { Cell::new(ptr::null_mut()) };
    static ERRORS: RefCell<Vec<JsRef>> = const { RefCell::new(Vec::new()) };
    static DEPTH: Cell<u32> = const { Cell::new(0) };
}

/// Records this thread's env when the addon loads on it, so references made in any call (a
/// constructor reading a spec's functions) have one.
#[napi_derive::napi(module_exports)]
pub fn module_init(_exports: napi::bindgen_prelude::Object, env: napi::Env) {
    ENV.with(|e| e.set(env.raw()));
}

/// This thread's JavaScript env, or null on a thread with none.
pub fn env() -> sys::napi_env {
    ENV.with(Cell::get)
}

/// Marks this thread as inside a call from JavaScript for `f`; callbacks Rune makes meanwhile
/// may call into JavaScript. Rethrows the first exception a callback threw.
pub fn entered<R>(env: sys::napi_env, f: impl FnOnce() -> R) -> napi::Result<R> {
    // The env stays set after the call: a thread's env lives as long as its JavaScript runtime,
    // and references dropped between calls (a finalizer) still need it.
    ENV.with(|e| e.set(env));
    DEPTH.with(|d| d.set(d.get() + 1));
    let result = f();
    DEPTH.with(|d| d.set(d.get() - 1));
    rethrow(env)?;
    Ok(result)
}

/// Throws the first exception kept from a callback, if any, and prints the rest.
fn rethrow(env: sys::napi_env) -> napi::Result<()> {
    if DEPTH.with(Cell::get) > 0 {
        return Ok(());
    }
    let errors = ERRORS.with(|e| std::mem::take(&mut *e.borrow_mut()));
    let mut errors = errors.into_iter();
    let Some(first) = errors.next() else { return Ok(()) };
    for rest in errors {
        report(rest.value());
    }
    // SAFETY: on the JavaScript thread inside a call, with a live reference.
    unsafe { sys::napi_throw(env, first.value()) };
    Err(napi::Error::new(napi::Status::PendingException, String::new()))
}

/// `console.error(value)`.
pub fn report(value: sys::napi_value) {
    let env = env();
    if env.is_null() {
        return;
    }
    // SAFETY: on the JavaScript thread with its env.
    unsafe {
        let mut global = ptr::null_mut();
        sys::napi_get_global(env, &mut global);
        let mut console = ptr::null_mut();
        sys::napi_get_named_property(env, global, c"console".as_ptr(), &mut console);
        let mut error = ptr::null_mut();
        sys::napi_get_named_property(env, console, c"error".as_ptr(), &mut error);
        let mut result = ptr::null_mut();
        if sys::napi_call_function(env, console, error, 1, &value, &mut result) != sys::Status::napi_ok {
            let mut exception = ptr::null_mut();
            sys::napi_get_and_clear_last_exception(env, &mut exception);
        }
    }
}

/// Keeps the pending exception, if any, for `entered` to rethrow.
fn keep_exception() {
    let env = env();
    // SAFETY: on the JavaScript thread with its env.
    unsafe {
        let mut pending = false;
        sys::napi_is_exception_pending(env, &mut pending);
        if !pending {
            return;
        }
        let mut exception = ptr::null_mut();
        sys::napi_get_and_clear_last_exception(env, &mut exception);
        let kept = JsRef::new(exception);
        if DEPTH.with(Cell::get) == 0 {
            report(kept.value());
        } else {
            ERRORS.with(|e| e.borrow_mut().push(kept));
        }
    }
}

/// A strong reference to a JavaScript value that outlives the call that passed it.
///
/// Node-API references only hold objects, functions and symbols; a primitive (a state that is
/// a number) is kept in a holder object `{ v }` and read back from it.
pub struct JsRef {
    raw: sys::napi_ref,
    boxed: bool,
}

impl JsRef {
    pub fn new(value: sys::napi_value) -> JsRef {
        let env = env();
        let mut raw = ptr::null_mut();
        let mut kind = 0;
        // SAFETY: on the JavaScript thread with its env; `value` belongs to it.
        unsafe { sys::napi_typeof(env, value, &mut kind) };
        let referenceable = matches!(kind, sys::ValueType::napi_object | sys::ValueType::napi_function | sys::ValueType::napi_symbol);
        if referenceable && unsafe { sys::napi_create_reference(env, value, 1, &mut raw) } == sys::Status::napi_ok {
            return JsRef { raw, boxed: false };
        }
        let mut holder = ptr::null_mut();
        unsafe {
            sys::napi_create_object(env, &mut holder);
            sys::napi_set_named_property(env, holder, c"v".as_ptr(), value);
            sys::napi_create_reference(env, holder, 1, &mut raw);
        }
        JsRef { raw, boxed: true }
    }

    pub fn value(&self) -> sys::napi_value {
        let env = env();
        let mut value = ptr::null_mut();
        // SAFETY: on the JavaScript thread; the reference is alive while `self` is.
        unsafe { sys::napi_get_reference_value(env, self.raw, &mut value) };
        if self.boxed {
            let mut inner = ptr::null_mut();
            unsafe { sys::napi_get_named_property(env, value, c"v".as_ptr(), &mut inner) };
            return inner;
        }
        value
    }
}

impl Drop for JsRef {
    fn drop(&mut self) {
        let env = env();
        // Off the JavaScript thread there is no env: leak rather than touch the heap there.
        if !env.is_null() {
            // SAFETY: on the JavaScript thread, deleting a reference this value owns.
            unsafe { sys::napi_delete_reference(env, self.raw) };
        }
    }
}

/// Runs `f` in its own handle scope, so a long pump doesn't pile up handles.
pub fn scope<R>(f: impl FnOnce() -> R) -> R {
    let env = env();
    let mut scope = ptr::null_mut();
    // SAFETY: on the JavaScript thread; the scope closes before returning.
    unsafe { sys::napi_open_handle_scope(env, &mut scope) };
    let result = f();
    unsafe { sys::napi_close_handle_scope(env, scope) };
    result
}

pub fn undefined() -> sys::napi_value {
    let mut value = ptr::null_mut();
    unsafe { sys::napi_get_undefined(env(), &mut value) };
    value
}

/// Calls `f(...args)`; `None` when it threw (the exception is kept for rethrow).
pub fn call(f: sys::napi_value, args: &[sys::napi_value]) -> Option<sys::napi_value> {
    call_with(undefined(), f, args)
}

// Frame-time attribution for the performance overlay (src/perf.rs): time spent in JavaScript
// called from Rust (views, handlers, poll, compositor plans), and within it, time spent back in
// Rust through the bindings. Off (one `Cell` read per call) unless an overlay is on.
thread_local! {
    static TIMING: Cell<bool> = const { Cell::new(false) };
    static IN_JS: Cell<u32> = const { Cell::new(0) };
    static IN_BINDING: Cell<u32> = const { Cell::new(0) };
    static JS_NS: Cell<u64> = const { Cell::new(0) };
    static BINDING_NS: Cell<u64> = const { Cell::new(0) };
}

pub fn set_timing(on: bool) {
    TIMING.with(|t| t.set(on));
}

/// Nanoseconds in JavaScript (outermost calls from Rust) and, within them, in binding calls
/// back into Rust, since the last take.
pub fn take_timing() -> (u64, u64) {
    (JS_NS.with(|t| t.replace(0)), BINDING_NS.with(|t| t.replace(0)))
}

/// Runs `f` with timing off: calls the overlay itself makes aren't the app's JavaScript.
pub fn untimed<R>(f: impl FnOnce() -> R) -> R {
    let was = TIMING.with(|t| t.replace(false));
    let r = f();
    TIMING.with(|t| t.set(was));
    r
}

/// Runs a binding call from JavaScript (`conv::guard`), timing it when it's made from inside
/// JavaScript that Rust called (a view building elements).
pub fn binding<R>(f: impl FnOnce() -> R) -> R {
    if !TIMING.with(Cell::get) || IN_JS.with(Cell::get) == 0 || IN_BINDING.with(Cell::get) > 0 {
        return f();
    }
    IN_BINDING.with(|d| d.set(1));
    let started = std::time::Instant::now();
    let r = f();
    BINDING_NS.with(|t| t.set(t.get() + started.elapsed().as_nanos() as u64));
    IN_BINDING.with(|d| d.set(0));
    r
}

/// Calls `f(...args)` with `this` = `recv` (a method call); `None` when it threw.
pub fn call_with(recv: sys::napi_value, f: sys::napi_value, args: &[sys::napi_value]) -> Option<sys::napi_value> {
    let env = env();
    let mut result = ptr::null_mut();
    let timed = TIMING.with(Cell::get) && IN_JS.with(Cell::get) == 0;
    let started = timed.then(std::time::Instant::now);
    IN_JS.with(|d| d.set(d.get() + 1));
    // SAFETY: on the JavaScript thread with its env; `recv` and `args` are live handles.
    let status = unsafe { sys::napi_call_function(env, recv, f, args.len(), args.as_ptr(), &mut result) };
    IN_JS.with(|d| d.set(d.get() - 1));
    if let Some(started) = started {
        JS_NS.with(|t| t.set(t.get() + started.elapsed().as_nanos() as u64));
    }
    if status == sys::Status::napi_ok {
        Some(result)
    } else {
        if std::env::var_os("RUNEX_DEBUG").is_some() { eprintln!("runex: call failed with napi status {status}"); }
        keep_exception();
        None
    }
}

/// Converts a Rust value to JavaScript in the current env.
pub fn to_js<T: ToNapiValue>(value: T) -> sys::napi_value {
    // SAFETY: on the JavaScript thread with its env.
    unsafe { T::to_napi_value(env(), value) }.unwrap_or_else(|_| {
        keep_exception();
        undefined()
    })
}

/// Keeps a JavaScript `Error(message)` for rethrow, as if a callback had thrown it.
pub fn throw_error(message: &str) {
    let env = env();
    // SAFETY: on the JavaScript thread with its env.
    unsafe {
        let mut msg = ptr::null_mut();
        sys::napi_create_string_utf8(env, message.as_ptr().cast(), message.len() as isize, &mut msg);
        let mut error = ptr::null_mut();
        sys::napi_create_error(env, ptr::null_mut(), msg, &mut error);
        sys::napi_throw(env, error);
    }
    keep_exception();
}

pub fn is_truthy(value: sys::napi_value) -> bool {
    let env = env();
    let mut coerced = ptr::null_mut();
    let mut out = false;
    // SAFETY: on the JavaScript thread with its env.
    unsafe {
        sys::napi_coerce_to_bool(env, value, &mut coerced);
        sys::napi_get_value_bool(env, coerced, &mut out);
    }
    out
}
