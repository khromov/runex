//! Apps: `AppSpec` from a JavaScript object, `App`'s builder, and the `Pump` JavaScript turns.

use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use napi::bindgen_prelude::{Array, Function, Object, Uint8Array, Unknown};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::Env;
use napi_derive::napi;

use crate::conv::{self, FromJs, Raw};
use crate::js::{self, JsRef};
use crate::state::{self, AppFns, JsState};
use crate::util::{intern, leak_bytes, pair};

/// The raw handle of a napi-rs value.
pub fn raw<'a, T: napi::JsValue<'a>>(v: &T) -> napi::sys::napi_value {
    v.value().value
}

/// Whether new apps and windows start as standard titled windows (`--titlebar`,
/// `RUNEX_TITLEBAR=native`). ts/app.ts sets it when runex loads.
static NATIVE_TITLEBAR: AtomicBool = AtomicBool::new(false);

pub fn set_titlebar_default(native: bool) {
    NATIVE_TITLEBAR.store(native, Ordering::Relaxed);
}

/// The frame a new app or window starts with, when it isn't Rune's `Chrome::DEFAULT` (content
/// under a transparent, title-less titlebar): with `--titlebar`, a standard titled window. It is
/// set before any builder call, so the app's own `chrome` or `titlebar` replaces it. Overlays
/// aren't apps and keep their own frame. Only macOS reads it: elsewhere the native frame stays.
pub fn chrome_default() -> Option<rune::Chrome> {
    NATIVE_TITLEBAR.load(Ordering::Relaxed).then_some(rune::Chrome { full_size_content: false, ..rune::Chrome::DEFAULT })
}

fn opt_fn(spec: &Object, name: &str) -> napi::Result<Option<JsRef>> {
    let value: Option<Unknown> = spec.get(name)?;
    Ok(match value {
        Some(v) if v.get_type()? == napi::ValueType::Function => Some(JsRef::new(raw(&v))),
        Some(v) if matches!(v.get_type()?, napi::ValueType::Undefined | napi::ValueType::Null) => None,
        Some(_) => return Err(napi::Error::from_reason(format!("AppSpec.{name} must be a function"))),
        None => None,
    })
}

/// Reads an `AppSpec`'s functions into `fns`, replacing what was there.
pub fn read_fns(spec: &Object, fns: &AppFns) -> napi::Result<()> {
    *fns.init.borrow_mut() = opt_fn(spec, "init")?;
    *fns.view.borrow_mut() = Some(opt_fn(spec, "view")?.ok_or_else(|| napi::Error::from_reason("AppSpec.view is required"))?);
    *fns.poll.borrow_mut() = opt_fn(spec, "poll")?;
    *fns.on_key.borrow_mut() = opt_fn(spec, "on_key")?;
    *fns.setup.borrow_mut() = opt_fn(spec, "setup")?;
    let mut scenes = Vec::new();
    if let Some(list) = spec.get::<Option<Vec<Array>>>("scenes")?.flatten() {
        for entry in list {
            let name: Option<String> = entry.get(0)?;
            let f: Option<Unknown> = entry.get(1)?;
            let (Some(name), Some(f)) = (name, f) else {
                return Err(napi::Error::from_reason("AppSpec.scenes entries are [name, (s) => void]"));
            };
            scenes.push((name, JsRef::new(raw(&f))));
        }
    }
    *fns.scenes.borrow_mut() = scenes;
    Ok(())
}

/// A `rune::AppSpec` whose functions call the JavaScript spec's, registered in `fns`.
pub fn spec_from(spec: &Object, fns: &Rc<AppFns>) -> napi::Result<rune::AppSpec<JsState>> {
    read_fns(spec, fns)?;
    let title: String = spec.get("title")?.unwrap_or_default();
    let size: Vec<f64> = spec.get("size")?.ok_or_else(|| napi::Error::from_reason("AppSpec.size is required"))?;
    let init = state::register(fns);
    let mut out = rune::AppSpec::new(intern(&title), pair(&size)?, init, state::view);
    if let Some(min) = spec.get::<Option<Vec<f64>>>("min_size")?.flatten() {
        out.min_size = Some(pair(&min)?);
    }
    let names: Vec<String> = fns.scenes.borrow().iter().map(|(n, _)| n.clone()).collect();
    out.scenes = state::scenes(&names);
    if let Some(fonts) = spec.get::<Option<Vec<Uint8Array>>>("fonts")?.flatten() {
        if !fonts.is_empty() {
            let fonts: Vec<&'static [u8]> = fonts.into_iter().map(|b| leak_bytes(b.to_vec())).collect();
            out.fonts = Box::leak(fonts.into_boxed_slice());
        }
    }
    if let Some(families) = spec.get::<Option<Vec<String>>>("families")?.flatten() {
        if let [ui, mono] = &families[..] {
            out.families = (intern(ui), intern(mono));
        }
    }
    // Always installed, so a hot reload can add them; without a JavaScript function they do nothing.
    out.poll = Some(state::poll);
    out.on_key = Some(state::on_key);
    if fns.setup.borrow().is_some() {
        out.setup = Some(state::setup);
    }
    Ok(out)
}

/// A JavaScript function argument as a kept reference.
pub fn keep(f: &Function<'_, Unknown<'_>, Unknown<'_>>) -> JsRef {
    JsRef::new(raw(f))
}

/// A closure for `impl FnMut(&WindowHandle)`: calls `f` with a handle to the window.
pub fn window_callback(f: Rc<state::Handler>) -> impl FnMut(&rune::WindowHandle) + 'static {
    move |w: &rune::WindowHandle| {
        js::scope(|| {
            let w = conv::arg_js(w.clone());
            f.call(&[w]);
        })
    }
}

/// The builder methods `rune::App` and `rune::WindowSpec` share, for a wrapper holding the Rust
/// value in an `Option` (moved out on start) and its app's JavaScript functions in `fns`.
#[macro_export]
macro_rules! app_builder_for {
    ($ty:ident, $inner:ty, $what:literal) => {
        impl $ty {
            fn map(&mut self, f: impl FnOnce($inner) -> $crate::conv::Result<$inner>) -> napi::Result<()> {
                let v = self.inner.take().ok_or_else(|| $crate::conv::err(concat!("this ", $what, " has already started")))?;
                match f(v) {
                    Ok(v) => {
                        self.inner = Some(v);
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
        }

        #[napi_derive::napi]
        impl $ty {
            #[napi(js_name = "srgb_blend", ts_return_type = "this")]
            pub fn srgb_blend<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, enabled: bool) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                self.map(|a| Ok(a.srgb_blend(enabled)))?;
                Ok(this)
            }
            #[napi(js_name = "font_smoothing", ts_args_type = "mode: FontSmoothing", ts_return_type = "this")]
            pub fn font_smoothing<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, mode: $crate::conv::Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                let mode = <rune::FontSmoothing as $crate::conv::FromJs>::from_js(mode.0)?;
                self.map(|a| Ok(a.font_smoothing(mode)))?;
                Ok(this)
            }
            #[napi(js_name = "chrome", ts_args_type = "chrome: Chrome", ts_return_type = "this")]
            pub fn chrome<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, chrome: $crate::conv::Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                let chrome = <rune::Chrome as $crate::conv::FromJs>::from_js(chrome.0)?;
                self.map(|a| Ok(a.chrome(chrome)))?;
                Ok(this)
            }
            #[napi(js_name = "titlebar", ts_args_type = "titlebar: Titlebar", ts_return_type = "this")]
            pub fn titlebar<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, titlebar: $crate::conv::Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                let titlebar = <rune::Titlebar as $crate::conv::FromJs>::from_js(titlebar.0)?;
                self.map(|a| Ok(a.titlebar(titlebar)))?;
                Ok(this)
            }
            #[napi(js_name = "modifier_keys", ts_return_type = "this")]
            pub fn modifier_keys<'t>(&mut self, this: napi::bindgen_prelude::This<'t>) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                self.map(|a| Ok(a.modifier_keys()))?;
                Ok(this)
            }
            #[napi(js_name = "tab_visits_controls", ts_return_type = "this")]
            pub fn tab_visits_controls<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, on: bool) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                self.map(|a| Ok(a.tab_visits_controls(on)))?;
                Ok(this)
            }
            #[napi(js_name = "configured_options", ts_args_type = "options: ConfiguredWindowOptions", ts_return_type = "this")]
            pub fn configured_options<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, options: $crate::conv::Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                let options = <rune::ConfiguredWindowOptions as $crate::conv::FromJs>::from_js(options.0)?;
                self.map(|a| Ok(a.configured_options(options)))?;
                Ok(this)
            }
            #[napi(js_name = "on_focus", ts_args_type = "f: (s: any, focused: boolean, tx: Tx) => void", ts_return_type = "this")]
            pub fn on_focus<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: napi::bindgen_prelude::Function<'_, napi::bindgen_prelude::Unknown<'_>, napi::bindgen_prelude::Unknown<'_>>) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                *self.fns.on_focus.borrow_mut() = Some($crate::app::keep(&f));
                self.map(|a| Ok(a.on_focus($crate::state::on_focus)))?;
                Ok(this)
            }
            #[napi(js_name = "on_ime", ts_args_type = "f: (s: any, ime: Ime, tx: Tx) => boolean", ts_return_type = "this")]
            pub fn on_ime<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: napi::bindgen_prelude::Function<'_, napi::bindgen_prelude::Unknown<'_>, napi::bindgen_prelude::Unknown<'_>>) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                *self.fns.on_ime.borrow_mut() = Some($crate::app::keep(&f));
                self.map(|a| Ok(a.on_ime($crate::state::on_ime)))?;
                Ok(this)
            }
            #[napi(js_name = "on_reopen", ts_args_type = "f: (s: any, has_visible_windows: boolean, tx: Tx) => boolean", ts_return_type = "this")]
            pub fn on_reopen<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: napi::bindgen_prelude::Function<'_, napi::bindgen_prelude::Unknown<'_>, napi::bindgen_prelude::Unknown<'_>>) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                *self.fns.on_reopen.borrow_mut() = Some($crate::app::keep(&f));
                self.map(|a| Ok(a.on_reopen($crate::state::on_reopen)))?;
                Ok(this)
            }
            #[napi(js_name = "on_open_url", ts_args_type = "f: (s: any, url: string, tx: Tx) => void", ts_return_type = "this")]
            pub fn on_open_url<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: napi::bindgen_prelude::Function<'_, napi::bindgen_prelude::Unknown<'_>, napi::bindgen_prelude::Unknown<'_>>) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                *self.fns.on_open_url.borrow_mut() = Some($crate::app::keep(&f));
                self.map(|a| Ok(a.on_open_url($crate::state::on_open_url)))?;
                Ok(this)
            }
            /// Runs `f(handle)` once the window's first frame is ready, once per native creation.
            #[napi(js_name = "on_ready", ts_args_type = "f: (window: WindowHandle) => void", ts_return_type = "this")]
            pub fn on_ready<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: napi::bindgen_prelude::Function<'_, napi::bindgen_prelude::Unknown<'_>, napi::bindgen_prelude::Unknown<'_>>) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                let h = $crate::state::Handler::new($crate::app::raw(&f));
                self.map(|a| Ok(a.on_ready($crate::app::window_callback(h))))?;
                Ok(this)
            }
            /// The window's playground: stories and pages it opens over the app.
            #[napi(js_name = "playground", ts_args_type = "playground: Playground", ts_return_type = "this")]
            pub fn playground<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, playground: $crate::conv::Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
                let pg = $crate::conv::take::<$crate::gen::rune::W_Playground>(playground.0)?;
                self.map(|a| Ok(a.playground(pg)))?;
                Ok(this)
            }
        }
    };
}

/// `rune::App`: an `AppSpec` with its lifetime. `start` opens it and hands back the `Pump`.
#[napi(js_name = "NativeApp")]
pub struct NativeApp {
    inner: Option<rune::App<JsState>>,
    pub(crate) fns: Rc<AppFns>,
}

crate::app_builder_for!(NativeApp, rune::App<JsState>, "App");

impl NativeApp {
    pub(crate) fn take(&mut self) -> napi::Result<rune::App<JsState>> {
        self.inner.take().ok_or_else(|| conv::err("this App has already started (or was moved into a WindowSpec)"))
    }
    fn get_mut(&mut self) -> napi::Result<&mut rune::App<JsState>> {
        self.inner.as_mut().ok_or_else(|| conv::err("this App has already started"))
    }
}

#[napi]
impl NativeApp {
    #[napi(constructor)]
    pub fn new(spec: Object) -> napi::Result<NativeApp> {
        let fns = Rc::new(AppFns::default());
        let rune_spec = spec_from(&spec, &fns)?;
        let init_fns = fns.clone();
        let mut app = rune::App::new(rune_spec).init(move || init_fns.initial());
        if let Some(chrome) = chrome_default() {
            app = app.chrome(chrome);
        }
        Ok(NativeApp { inner: Some(app), fns })
    }

    #[napi(js_name = "keep_running")]
    pub fn keep_running(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.keep_running()))
    }
    #[napi(js_name = "windowless")]
    pub fn windowless(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.windowless()))
    }
    #[napi(js_name = "standard_menus")]
    pub fn standard_menus(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.standard_menus()))
    }
    #[napi(js_name = "accessory")]
    pub fn accessory(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.accessory()))
    }
    #[napi(js_name = "fit_content_height")]
    pub fn fit_content_height(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.fit_content_height()))
    }
    #[napi(js_name = "float_on_open")]
    pub fn float_on_open(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.float_on_open()))
    }
    #[napi(js_name = "release_gpu_when_closed")]
    pub fn release_gpu_when_closed(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.release_gpu_when_closed()))
    }
    #[napi(js_name = "window_options", ts_args_type = "options: WindowOptions")]
    pub fn window_options(&mut self, options: Raw) -> napi::Result<()> {
        let options = rune::WindowOptions::from_js(options.0)?;
        self.map(|a| Ok(a.window_options(options)))
    }
    #[napi(js_name = "macos_window", ts_args_type = "options: MacWindowOptions")]
    pub fn macos_window(&mut self, options: Raw) -> napi::Result<()> {
        let options = rune::MacWindowOptions::from_js(options.0)?;
        self.map(|a| Ok(a.macos_window(options)))
    }
    /// Draws every frame through `compositor` (`App::compositor`): an object with a
    /// `render(frame)` method returning a plan (ts/compose.ts).
    #[napi(js_name = "compositor", ts_args_type = "compositor: any")]
    pub fn compositor(&mut self, compositor: Raw) -> napi::Result<()> {
        let c = crate::manual::compose::JsCompositor::from_js(compositor.0)?;
        self.map(|a| Ok(a.compositor(c)))
    }
    #[napi(js_name = "gpu_backend", ts_args_type = "backend: GpuBackend")]
    pub fn gpu_backend(&mut self, backend: Raw) -> napi::Result<()> {
        let backend = rune::GpuBackend::from_js(backend.0)?;
        self.map(|a| Ok(a.gpu_backend(backend)))
    }
    #[napi(js_name = "on_close", ts_args_type = "f: (s: any, tx: any) => void")]
    pub fn on_close(&mut self, f: Function<'_, Unknown<'_>, Unknown<'_>>) -> napi::Result<()> {
        *self.fns.on_close.borrow_mut() = Some(keep(&f));
        self.map(|a| Ok(a.on_close(state::on_close)))
    }
    /// Runs `f(handle)` after each native window creation.
    #[napi(js_name = "on_window", ts_args_type = "f: (window: any) => void")]
    pub fn on_window(&mut self, f: Function<'_, Unknown<'_>, Unknown<'_>>) -> napi::Result<()> {
        let h = state::Handler::new(raw(&f));
        self.map(|a| Ok(a.on_window(window_callback(h))))
    }
    /// Shows the performance overlay (frame rate; frame, work, update, encode and view times;
    /// where each frame's time went: Rune, bindings, JS; presents, skips, the loop's cost, memory,
    /// a graph) in the window's corner and/or logs it once a second: `mode` is `"overlay"` (the
    /// default), `"log"`, `"overlay,log"` or `"none"`. `on_stats`, if given, gets the same numbers
    /// as one object a second.
    #[napi(js_name = "perf", ts_args_type = "mode?: string | null, on_stats?: ((stats: any) => void) | null")]
    pub fn perf(&mut self, mode: Option<String>, on_stats: Option<Function<'_, Unknown<'_>, Unknown<'_>>>) -> napi::Result<()> {
        let mode = crate::perf::Mode::parse(mode.as_deref().unwrap_or("overlay"));
        let on_stats = on_stats.as_ref().map(keep);
        if (!mode.any() && on_stats.is_none()) || self.fns.perf.borrow().is_some() {
            return Ok(());
        }
        let fns = self.fns.clone();
        self.map(move |a| Ok(crate::perf::install_app(a, &fns, mode, on_stats)))
    }

    /// Makes the app's first state with `f` instead of its spec's `init` (`App::init`).
    #[napi(js_name = "init", ts_args_type = "f: () => any")]
    pub fn init(&mut self, f: Function<'_, Unknown<'_>, Unknown<'_>>) -> napi::Result<()> {
        let h = Rc::new(state::Handler(keep(&f)));
        let fns = self.fns.clone();
        self.map(move |a| {
            Ok(a.init(move || {
                let v = js::scope(|| h.call(&[]).map(JsRef::new));
                JsState { value: v.unwrap_or_else(|| JsRef::new(conv::object())), fns }
            }))
        })
    }
    /// Runs `handler(state, tx)` when `accelerator` ("mod+shift+k") is pressed anywhere, even
    /// with the app in the background (`App::global_shortcut`).
    #[napi(js_name = "global_shortcut", ts_args_type = "accelerator: string, handler: (s: any, tx: any) => void")]
    pub fn global_shortcut(&mut self, accelerator: String, handler: Function<'_, Unknown<'_>, Unknown<'_>>) -> napi::Result<()> {
        let f = shortcut_slot(raw(&handler))?;
        self.map(|a| Ok(a.global_shortcut(&accelerator, f)))
    }
    /// Lets `global_shortcut` take chords without a modifier (`App::allow_unmodified_shortcuts`).
    #[napi(js_name = "allow_unmodified_shortcuts")]
    pub fn allow_unmodified_shortcuts(&mut self) -> napi::Result<()> {
        self.map(|a| Ok(a.allow_unmodified_shortcuts()))
    }
    /// The Rune arguments (`--snap out.png`, `--tree`, `--scene name`, ...), without the
    /// program name. Without it the app reads none, whatever the process was given.
    #[napi(js_name = "args")]
    pub fn args(&mut self, argv: Vec<String>) -> napi::Result<()> {
        self.map(|a| Ok(a.args(argv)))
    }

    /// Adds an overlay window over other apps (`App::overlay`). `spec` is an `OverlaySpec` or
    /// `ConfiguredOverlay` object; `state` is the overlay's own state.
    #[napi(js_name = "overlay", ts_args_type = "spec: any, state: any", ts_return_type = "any")]
    pub fn overlay(&mut self, spec: Object, state_: Raw) -> napi::Result<crate::manual::overlay::OverlayHandle> {
        let (configured, fns) = crate::manual::overlay::configured(&spec)?;
        let state = JsState { value: JsRef::new(state_.0), fns: fns.clone() };
        let handle = conv::guard(|| Ok(self.get_mut()?.overlay(configured, state)))?;
        Ok(crate::manual::overlay::OverlayHandle::new(handle, fns))
    }

    /// Adds a window with its own state (`App::window`); returns `[AppHandle, WindowHandle]`.
    #[napi(js_name = "window", ts_args_type = "spec: any", ts_return_type = "[AppHandle, any]")]
    pub fn window(&mut self, spec: Raw) -> napi::Result<Vec<Raw>> {
        let mut w = conv::instance_plain::<crate::manual::windows::WindowSpec>(spec.0)?;
        let fns = w.fns.clone();
        let window = w.take()?;
        let (app, win) = conv::guard(|| Ok(self.get_mut()?.window(window)))?;
        let app = unsafe { <AppHandle as napi::bindgen_prelude::ToNapiValue>::to_napi_value(js::env(), AppHandle { handle: app, fns }) }?;
        Ok(vec![Raw(app), Raw(conv::ToJs::to_js(win)?)])
    }

    #[napi(js_name = "handle")]
    pub fn handle(&self) -> napi::Result<AppHandle> {
        let app = self.inner.as_ref().ok_or_else(|| conv::err("this App has already started"))?;
        Ok(AppHandle { handle: app.handle(), fns: self.fns.clone() })
    }

    /// Opens the app. Returns the `Pump` to turn, or `null` when Rune's arguments rendered it
    /// headless (`--snap`, `--tree`, ...) and it has finished.
    #[napi(js_name = "start")]
    pub fn start(&mut self, env: Env) -> napi::Result<Option<Pump>> {
        let default = crate::perf::default_mode();
        if default.any() && self.fns.perf.borrow().is_none() {
            let fns = self.fns.clone();
            self.map(move |a| Ok(crate::perf::install_app(a, &fns, default, None)))?;
        }
        let app = self.take()?;
        let windows = vec![(String::from("main"), self.fns.clone())];
        let started = js::entered(env.raw(), || app.start())?;
        match started {
            Ok(Some(pump)) => Ok(Some(Pump::new(pump, windows))),
            Ok(None) => Ok(None),
            Err(error) => Err(conv::err(error)),
        }
    }

    /// Replaces the app's functions with `spec`'s (hot reload).
    #[napi(js_name = "swap")]
    pub fn swap(&self, spec: Object) -> napi::Result<()> {
        read_fns(&spec, &self.fns)
    }
}

/// A started app's event loop, which JavaScript turns between its own tasks.
#[napi(js_name = "Pump")]
pub struct Pump {
    pump: Option<rune::Pump>,
    /// Each window's key and functions, for hot reload.
    windows: Rc<std::cell::RefCell<Vec<(String, Rc<AppFns>)>>>,
    /// Set by Rune's wakes until the next turn; `None` until JavaScript listens for them.
    wake: Option<Arc<AtomicBool>>,
    /// When Rune asked for its next turn (a timer, a frame deadline), if it did.
    deadline: Option<Instant>,
    last_turn: Instant,
    /// The last turn something asked for (input, a wake, a deadline), as opposed to a safety turn.
    last_busy: Instant,
    turns: u64,
}

/// An idle app still turns the loop this often, in case something queued work the idle check
/// can't see.
const SAFETY_TURN: Duration = Duration::from_millis(1000);

impl Pump {
    pub(crate) fn new(pump: rune::Pump, windows: Vec<(String, Rc<AppFns>)>) -> Pump {
        Pump::shared(pump, Rc::new(std::cell::RefCell::new(windows)))
    }
    pub(crate) fn shared(pump: rune::Pump, windows: Rc<std::cell::RefCell<Vec<(String, Rc<AppFns>)>>>) -> Pump {
        Pump { pump: Some(pump), windows, wake: None, deadline: None, last_turn: Instant::now(), last_busy: Instant::now(), turns: 0 }
    }
}

#[napi]
impl Pump {
    /// Dispatches pending events and due frames. Returns milliseconds until the loop next needs
    /// a turn without an OS event (0 while animating, or when this turn asked for a redraw that
    /// only the next delivers), -1 when only an event will need one, or -2 once the app has quit.
    #[napi(js_name = "tick")]
    pub fn tick(&mut self, env: Env) -> napi::Result<f64> {
        let now = Instant::now();
        let woke = self.wake.as_ref().is_none_or(|w| w.swap(false, Ordering::AcqRel));
        let due = self.deadline.is_some_and(|d| now >= d);
        let launching = self.turns < 8;
        let Some(pump) = self.pump.as_mut() else { return Ok(-2.0) };
        let busy = woke || due || launching || crate::idle::os_events_pending();
        if !busy && now - self.last_turn < SAFETY_TURN {
            crate::perf::record_tick(now, now.elapsed().as_secs_f64() * 1000.0, false);
            return Ok(self.deadline.map_or(-1.0, |d| (d - now).as_secs_f64() * 1000.0));
        }
        if busy {
            self.last_busy = now;
        }
        self.turns += 1;
        self.last_turn = now;
        let alive = js::entered(env.raw(), || crate::idle::pumping(|| pump.pump(Some(Duration::ZERO))))?;
        if !alive {
            rune::set_pump_wake(None);
            crate::idle::exited();
            self.pump = None;
            return Ok(-2.0);
        }
        let next = pump.next_wake();
        crate::perf::record_tick(now, now.elapsed().as_secs_f64() * 1000.0, true);
        self.deadline = next.map(|d| Instant::now() + d);
        Ok(next.map_or(-1.0, |d| d.as_secs_f64() * 1000.0))
    }

    /// Calls `f` (from the event loop's thread, soon after) whenever Rune wakes the loop: a
    /// display-link frame, a handle's update, a live value. Wakes coalesce until the next tick.
    #[napi(js_name = "set_wake", ts_args_type = "f: () => void")]
    pub fn set_wake(&mut self, f: Function<'_, (), ()>) -> napi::Result<()> {
        let pending = Arc::new(AtomicBool::new(false));
        let tsfn = f.build_threadsafe_function::<()>().callee_handled::<false>().weak::<true>().build()?;
        let flag = pending.clone();
        rune::set_pump_wake(Some(Arc::new(move || {
            if !flag.swap(true, Ordering::AcqRel) {
                let _ = tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
            }
        })));
        self.wake = Some(pending);
        Ok(())
    }

    /// Milliseconds since a turn last had something to do (input, a wake, a deadline).
    #[napi(getter, js_name = "idle_ms")]
    pub fn idle_ms(&self) -> f64 {
        self.last_busy.elapsed().as_secs_f64() * 1000.0
    }

    /// Whether the app has quit.
    #[napi(getter)]
    pub fn exited(&self) -> bool {
        self.pump.is_none()
    }

    /// The keys of the windows this pump runs (`"main"` for a single app).
    #[napi(getter)]
    pub fn windows(&self) -> Vec<String> {
        self.windows.borrow().iter().map(|(k, _)| k.clone()).collect()
    }

    /// Replaces the first window's functions with `spec`'s (hot reload). The next frame uses them.
    #[napi(js_name = "swap")]
    pub fn swap(&self, spec: Object) -> napi::Result<()> {
        let windows = self.windows.borrow();
        let (_, fns) = windows.first().ok_or_else(|| conv::err("no window"))?;
        read_fns(&spec, fns)
    }

    /// Gives the live window with `spec`'s key that spec's functions (hot reload of a
    /// multi-window app, whose factory made `spec` afresh). False when no window has the key.
    #[napi(js_name = "swap_from", ts_args_type = "spec: WindowSpec")]
    pub fn swap_from(&self, spec: Raw) -> napi::Result<bool> {
        let w = conv::instance_plain::<crate::manual::windows::WindowSpec>(spec.0)?;
        let key = w.inner.as_ref().map(|s| s.key.clone()).ok_or_else(|| conv::err("this WindowSpec was already used"))?;
        let windows = self.windows.borrow();
        let Some((_, fns)) = windows.iter().find(|(k, _)| *k == key) else { return Ok(false) };
        fns.copy_from(&w.fns);
        Ok(true)
    }

    /// Replaces window `key`'s functions with `spec`'s (hot reload of a multi-window app).
    /// False when no window has that key.
    #[napi(js_name = "swap_window")]
    pub fn swap_window(&self, key: String, spec: Object) -> napi::Result<bool> {
        let windows = self.windows.borrow();
        let Some((_, fns)) = windows.iter().find(|(k, _)| *k == key) else { return Ok(false) };
        read_fns(&spec, fns)?;
        Ok(true)
    }
}

/// Feeds and controls a running `App` (`rune::AppHandle`).
#[napi(js_name = "AppHandle")]
pub struct AppHandle {
    pub(crate) handle: rune::AppHandle<JsState>,
    pub(crate) fns: Rc<AppFns>,
}

#[napi]
impl AppHandle {
    /// Runs `f(state, tx)` before the next frame, then re-runs the view.
    #[napi(js_name = "update", ts_args_type = "f: (s: any, tx: any) => void")]
    pub fn update(&self, f: Function<'_, Unknown<'_>, Unknown<'_>>) {
        self.fns.updates.borrow_mut().push(keep(&f));
        self.handle.update(|s: &mut JsState, tx: &mut rune::Tx| {
            state::drain_updates(s, tx);
        });
    }
    /// Re-runs the view on the next frame.
    #[napi(js_name = "refresh")]
    pub fn refresh(&self) {
        self.handle.update(|_: &mut JsState, _: &mut rune::Tx| {});
    }
    #[napi(js_name = "wake")]
    pub fn wake(&self) {
        self.handle.wake();
    }
    #[napi(js_name = "open")]
    pub fn open(&self) {
        self.handle.open();
    }
    #[napi(js_name = "show")]
    pub fn show(&self) {
        self.handle.show();
    }
    #[napi(js_name = "hide")]
    pub fn hide(&self) {
        self.handle.hide();
    }
    #[napi(js_name = "focus")]
    pub fn focus(&self) {
        self.handle.focus();
    }
    #[napi(js_name = "close")]
    pub fn close(&self) {
        self.handle.close();
    }
    #[napi(js_name = "minimize")]
    pub fn minimize(&self) {
        self.handle.minimize();
    }
    #[napi(js_name = "quit")]
    pub fn quit(&self) {
        self.handle.quit();
    }
    #[napi(js_name = "set_position", ts_args_type = "position: [number, number]")]
    pub fn set_position(&self, position: Raw) -> napi::Result<()> {
        let p = <(i32, i32)>::from_js(position.0)?;
        self.handle.set_position(p);
        Ok(())
    }
    #[napi(js_name = "place", ts_args_type = "display: DisplayTarget, placement: OverlayPlacement")]
    pub fn place(&self, display: Raw, placement: Raw) -> napi::Result<()> {
        self.handle.place(rune::DisplayTarget::from_js(display.0)?, rune::OverlayPlacement::from_js(placement.0)?);
        Ok(())
    }
    #[napi(js_name = "activate")]
    pub fn activate(&self, token: String) {
        self.handle.activate(token);
    }
    #[napi(js_name = "set_dock_icon")]
    pub fn set_dock_icon(&self, visible: bool) {
        self.handle.set_dock_icon(visible);
    }
    #[napi(js_name = "is_visible")]
    pub fn is_visible(&self) -> bool {
        self.handle.is_visible()
    }
    #[napi(js_name = "window_error")]
    pub fn window_error(&self) -> Option<String> {
        self.handle.window_error()
    }
    #[napi(js_name = "clone")]
    pub fn clone_js(&self) -> AppHandle {
        AppHandle { handle: self.handle.clone(), fns: self.fns.clone() }
    }
}

/// Wakes a running app from anywhere (`rune::Waker`).
#[napi(js_name = "Waker")]
pub struct Waker {
    pub(crate) waker: rune::Waker,
}

#[napi]
impl Waker {
    #[napi(js_name = "wake")]
    pub fn wake(&self) {
        (self.waker)();
    }
}

impl crate::conv::FromJs for rune::Waker {
    fn from_js(v: crate::conv::Value) -> crate::conv::Result<Self> {
        let w = crate::conv::instance_plain::<Waker>(v)?;
        Ok(w.waker.clone())
    }
}
impl crate::conv::ToJs for rune::Waker {
    fn to_js(self) -> crate::conv::Result<crate::conv::Value> {
        Ok(unsafe { <Waker as napi::bindgen_prelude::ToNapiValue>::to_napi_value(crate::js::env(), Waker { waker: self }) }?)
    }
}

// Global shortcut handlers are `fn(&mut S, &mut Tx)`: one trampoline per registered function.
thread_local! {
    static SHORTCUTS: std::cell::RefCell<Vec<JsRef>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn shortcut<const I: usize>(s: &mut JsState, tx: &mut rune::Tx) {
    js::scope(|| {
        let f = SHORTCUTS.with(|r| r.borrow().get(I).map(JsRef::value));
        if let Some(f) = f {
            let r = state::lend_tx(tx, |tx| js::call(f, &[s.value(), tx]));
            state::replace_from(s, r);
        }
    });
}

static SHORTCUT_FNS: [fn(&mut JsState, &mut rune::Tx); 16] = [
    shortcut::<0>, shortcut::<1>, shortcut::<2>, shortcut::<3>, shortcut::<4>, shortcut::<5>, shortcut::<6>, shortcut::<7>,
    shortcut::<8>, shortcut::<9>, shortcut::<10>, shortcut::<11>, shortcut::<12>, shortcut::<13>, shortcut::<14>, shortcut::<15>,
];

fn shortcut_slot(f: conv::Value) -> napi::Result<fn(&mut JsState, &mut rune::Tx)> {
    let i = SHORTCUTS.with(|r| conv::register_fn(&mut r.borrow_mut(), f, SHORTCUT_FNS.len()))?;
    Ok(SHORTCUT_FNS[i])
}
