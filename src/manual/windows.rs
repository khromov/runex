//! Several windows from one factory (`rune::run_windows`, `WindowSpec`). Each window has its own
//! state and functions; the factory runs once Rune knows the displays.

use std::cell::RefCell;
use std::rc::Rc;

use napi::bindgen_prelude::{Function, Object, This, Unknown};
use napi::Env;
use napi_derive::napi;

use crate::app::{chrome_default, raw, spec_from, window_callback, NativeApp, Pump};
use crate::conv::{self, FromJs, Raw};
use crate::js::{self, JsRef};
use crate::state::{AppFns, Handler, JsState};

/// One window of a multi-window app (`rune::WindowSpec`): a key, an app and its options.
#[napi(js_name = "WindowSpec")]
pub struct WindowSpec {
    pub(crate) inner: Option<rune::WindowSpec<JsState>>,
    pub(crate) fns: Rc<AppFns>,
}

impl WindowSpec {
    pub(crate) fn take(&mut self) -> napi::Result<rune::WindowSpec<JsState>> {
        self.inner.take().ok_or_else(|| conv::err("this WindowSpec was already used"))
    }
}

crate::app_builder_for!(WindowSpec, rune::WindowSpec<JsState>, "WindowSpec");

#[napi]
impl WindowSpec {
    /// A window keyed `key` running the app `spec` describes.
    #[napi(js_name = "new", ts_args_type = "key: string, spec: AppSpec<any>", ts_return_type = "WindowSpec")]
    pub fn new(key: String, spec: Object) -> napi::Result<WindowSpec> {
        let fns = Rc::new(AppFns::default());
        let rune_spec = spec_from(&spec, &fns)?;
        let mut window = rune::WindowSpec::new(key, rune_spec);
        if let Some(chrome) = chrome_default() {
            window = window.chrome(chrome);
        }
        Ok(WindowSpec { inner: Some(window), fns })
    }

    /// A window keyed `key` running `app`, keeping its handle, lifetime and options.
    #[napi(js_name = "from_app", ts_args_type = "key: string, app: App<any>", ts_return_type = "WindowSpec")]
    pub fn from_app(key: String, app: Raw) -> napi::Result<WindowSpec> {
        let mut app = native_app(app.0)?;
        let fns = app.fns.clone();
        let app = app.take()?;
        Ok(WindowSpec { inner: Some(rune::WindowSpec::from_app(key, app)), fns })
    }

    #[napi(getter)]
    pub fn key(&self) -> napi::Result<String> {
        Ok(self.inner.as_ref().ok_or_else(|| conv::err("this WindowSpec was already used"))?.key.clone())
    }

    #[napi(js_name = "options", ts_args_type = "options: WindowOptions", ts_return_type = "this")]
    pub fn options<'t>(&mut self, this: This<'t>, options: Raw) -> napi::Result<This<'t>> {
        let options = rune::WindowOptions::from_js(options.0)?;
        self.map(|w| Ok(w.options(options)))?;
        Ok(this)
    }

    /// Draws every frame of this window through `compositor` (`App::compositor` on the spec's
    /// app): an object with a `render(frame)` method returning a plan (ts/compose.ts).
    #[napi(js_name = "compositor", ts_args_type = "compositor: Compositor<any>", ts_return_type = "this")]
    pub fn compositor<'t>(&mut self, this: This<'t>, compositor: Raw) -> napi::Result<This<'t>> {
        let c = crate::manual::compose::JsCompositor::from_js(compositor.0)?;
        self.map(|mut w| {
            w.app = w.app.compositor(c);
            Ok(w)
        })?;
        Ok(this)
    }

    /// The window's initial state, instead of its spec's `init`.
    #[napi(js_name = "state", ts_args_type = "state: any", ts_return_type = "this")]
    pub fn state<'t>(&mut self, this: This<'t>, value: Raw) -> napi::Result<This<'t>> {
        let state = JsState { value: JsRef::new(value.0), fns: self.fns.clone() };
        self.map(|w| Ok(w.state(state)))?;
        Ok(this)
    }

    /// Runs `f(handle)` after the native window is created (not in headless runs).
    #[napi(js_name = "on_created", ts_args_type = "f: (window: WindowHandle) => void", ts_return_type = "this")]
    pub fn on_created<'t>(&mut self, this: This<'t>, f: Function<'_, Unknown<'_>, Unknown<'_>>) -> napi::Result<This<'t>> {
        let h = Handler::new(raw(&f));
        let mut call = window_callback(h);
        self.map(|w| Ok(w.on_created(move |handle: rune::WindowHandle| call(&handle))))?;
        Ok(this)
    }

    /// Shows the performance overlay in this window (see `App.perf`).
    #[napi(js_name = "perf", ts_args_type = "mode?: string | null, on_stats?: ((stats: any) => void) | null", ts_return_type = "this")]
    pub fn perf<'t>(&mut self, this: This<'t>, mode: Option<String>, on_stats: Option<Function<'_, Unknown<'_>, Unknown<'_>>>) -> napi::Result<This<'t>> {
        let mode = crate::perf::Mode::parse(mode.as_deref().unwrap_or("overlay"));
        let on_stats = on_stats.as_ref().map(|f| JsRef::new(raw(f)));
        if (mode.any() || on_stats.is_some()) && self.fns.perf.borrow().is_none() {
            let fns = self.fns.clone();
            self.map(move |w| Ok(crate::perf::install_window(w, &fns, mode, on_stats)))?;
        }
        Ok(this)
    }

    /// The same window, its state type erased (`WindowSpec::boxed`): in JavaScript, itself.
    #[napi(js_name = "boxed", ts_return_type = "this")]
    pub fn boxed<'t>(&mut self, this: This<'t>) -> This<'t> {
        this
    }
}

fn native_app(v: conv::Value) -> napi::Result<napi::bindgen_prelude::ClassInstance<'static, NativeApp>> {
    conv::instance_plain::<NativeApp>(v)
        .or_else(|_| conv::instance_plain::<NativeApp>(conv::get(v, "native")))
        .map_err(|_| conv::err("expected an App"))
}

/// Starts the windows `factory(displays)` returns (`rune::run_windows_with_args`). Returns the
/// `Pump`, or `null` when Rune's arguments rendered one window headless and it has finished.
#[napi(js_name = "start_windows", ts_args_type = "options: RunOptions | null, args: string[], factory: (displays: Display[]) => WindowSpec[]")]
pub fn start_windows(env: Env, options: Raw, args: Vec<String>, factory: Function<'_, Unknown<'_>, Unknown<'_>>) -> napi::Result<Option<Pump>> {
    let options = if conv::is_nullish(options.0) { rune::RunOptions::default() } else { rune::RunOptions::from_js(options.0)? };
    let h = Handler::new(raw(&factory));
    let windows: Rc<RefCell<Vec<(String, Rc<AppFns>)>>> = Rc::default();
    let registry = windows.clone();
    let factory = move |displays: &[rune::Display]| -> Vec<rune::AnyWindowSpec> {
        js::scope(|| {
            let list = conv::arg_js(displays.to_vec());
            let Some(out) = h.call(&[list]) else { return Vec::new() };
            let specs = match Vec::<conv::Js>::from_js(out) {
                Ok(specs) => specs,
                Err(e) => {
                    js::throw_error(&format!("the window factory must return an array of WindowSpec: {}", e.reason));
                    return Vec::new();
                }
            };
            let mut erased = Vec::new();
            for spec in specs {
                match conv::instance_plain::<WindowSpec>(spec.0).map_err(|e| e.reason).and_then(|mut w| {
                    let fns = w.fns.clone();
                    w.take().map(|w| (w, fns)).map_err(|e| e.reason)
                }) {
                    Ok((w, fns)) => {
                        let default = crate::perf::default_mode();
                        let w = if default.any() && fns.perf.borrow().is_none() { crate::perf::install_window(w, &fns, default, None) } else { w };
                        registry.borrow_mut().push((w.key.clone(), fns));
                        erased.push(w.into());
                    }
                    Err(e) => js::throw_error(&format!("the window factory returned something that isn't a WindowSpec: {e}")),
                }
            }
            erased
        })
    };
    let started = js::entered(env.raw(), || rune::start_windows_with_args(options, args, factory))?;
    match started {
        Ok(Some(pump)) => Ok(Some(Pump::shared(pump, windows))),
        Ok(None) => Ok(None),
        Err(error) => Err(conv::err(error)),
    }
}
