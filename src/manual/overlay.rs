//! Overlays: windows above other apps (`App::overlay`, `OverlaySpec`, `ConfiguredOverlay`,
//! `OverlayHandle`). JavaScript describes an overlay as a plain object (ts/overlay.ts builds them
//! as Rust's literals read); its view and hooks run with the overlay's own state.

use std::rc::Rc;

use napi::bindgen_prelude::{Function, JsObjectValue, Object, Unknown};
use napi_derive::napi;

use crate::app::{keep, raw};
use crate::conv::{self, FromJs, Raw, ToJs};
use crate::js::{self, JsRef};
use crate::gen::rune::W_Story;
use crate::state::{self, AppFns, Handler, JsState};

fn opt_fn(o: &Object, name: &str) -> napi::Result<Option<JsRef>> {
    let v: Option<Unknown> = o.get(name)?;
    Ok(match v {
        Some(v) if v.get_type()? == napi::ValueType::Function => Some(JsRef::new(raw(&v))),
        _ => None,
    })
}

fn field<T: FromJs>(o: &Object, ty: &str, name: &str) -> napi::Result<T> {
    conv::field(raw(o), ty, name)
}

/// A `rune::OverlaySpec` from an `OverlaySpec` object, and the functions (its view) its state runs.
pub fn spec(spec: &Object) -> napi::Result<(rune::OverlaySpec<JsState>, Rc<AppFns>)> {
    let fns = Rc::new(AppFns::default());
    *fns.view.borrow_mut() = Some(opt_fn(spec, "view")?.ok_or_else(|| conv::err("OverlaySpec.view is required"))?);
    let name: String = field(spec, "OverlaySpec", "name")?;
    let rspec = rune::OverlaySpec::<JsState> {
        name: crate::util::intern(&name),
        size: field(spec, "OverlaySpec", "size")?,
        edge: field(spec, "OverlaySpec", "edge")?,
        margin: field(spec, "OverlaySpec", "margin")?,
        align: field(spec, "OverlaySpec", "align")?,
        inset: field(spec, "OverlaySpec", "inset")?,
        interactive: field(spec, "OverlaySpec", "interactive")?,
        view: state::view,
    };
    Ok((rspec, fns))
}

/// `Story::overlay`: an overlay's view at its size, framed on the stage, with a state `init` makes.
#[napi]
impl W_Story {
    #[napi(js_name = "overlay", ts_args_type = "name: string, spec: OverlaySpec<any>, init: () => any", ts_return_type = "Story")]
    pub fn s_overlay(name: String, spec_: Object, init: Function<'_, Unknown<'_>, Unknown<'_>>) -> napi::Result<Raw> {
        let (ospec, fns) = spec(&spec_)?;
        let init = Rc::new(Handler(JsRef::new(raw(&init))));
        let story = rune::Story::overlay(crate::util::intern(&name), &ospec, move || {
            let v = js::scope(|| init.call(&[]).map(JsRef::new));
            JsState { value: v.unwrap_or_else(|| JsRef::new(conv::object())), fns: fns.clone() }
        });
        Ok(Raw(conv::owned::<crate::gen::rune::W_Story>(story)?))
    }
}

/// A `rune::ConfiguredOverlay` from a `ConfiguredOverlay` (or bare `OverlaySpec`) object, and the
/// functions its state runs.
pub fn configured(o: &Object) -> napi::Result<(rune::ConfiguredOverlay<JsState>, Rc<AppFns>)> {
    // A `ConfiguredOverlay` holds its `OverlaySpec` in `spec`; a bare `OverlaySpec` is its own.
    let spec_: Object = if o.has_named_property("spec")? { o.get_named_property("spec")? } else { o.clone() };
    let (rspec, fns) = spec(&spec_)?;
    let options: Option<rune::OverlayOptions> = conv::field(raw(o), "ConfiguredOverlay", "options").ok().flatten();
    let mut c = match options {
        Some(options) => rspec.options(options),
        None => rune::ConfiguredOverlay::from(rspec),
    };
    if let Some(f) = opt_fn(o, "on_key")? {
        *fns.on_key.borrow_mut() = Some(f);
        c = c.on_key(state::on_key);
    }
    if let Some(f) = opt_fn(o, "poll")? {
        *fns.poll.borrow_mut() = Some(f);
        c = c.poll(state::poll);
    } else {
        // Updates queued through the handle drain in poll.
        c = c.poll(state::poll);
    }
    if let Some(f) = opt_fn(o, "on_focus")? {
        *fns.on_focus.borrow_mut() = Some(f);
        c = c.on_focus(state::on_focus);
    }
    if let Some(f) = opt_fn(o, "setup")? {
        *fns.setup.borrow_mut() = Some(f);
        c = c.setup(state::setup);
    }
    if let Some(f) = opt_fn(o, "on_created")? {
        let h = Rc::new(Handler(f));
        c = c.on_created(move |created: rune::OverlayCreated| {
            js::scope(|| {
                h.call(&[conv::arg_js(created)]);
            })
        });
    }
    let compositor = conv::get(raw(o), "compositor");
    if !conv::is_nullish(compositor) {
        c = c.compositor(crate::manual::compose::JsCompositor::from_js(compositor)?);
    }
    if let Some(on) = conv::field::<Option<bool>>(raw(o), "ConfiguredOverlay", "srgb_blend")? {
        c = c.srgb_blend(on);
    }
    if let Some(level) = conv::field::<Option<isize>>(raw(o), "ConfiguredOverlay", "macos_level")? {
        c = c.macos_level(level);
    }
    if conv::field::<Option<bool>>(raw(o), "ConfiguredOverlay", "modifier_keys")?.unwrap_or(false) {
        c = c.modifier_keys();
    }
    if conv::field::<Option<bool>>(raw(o), "ConfiguredOverlay", "animate_reveal")?.unwrap_or(false) {
        c = c.animate_reveal();
    }
    if let Some(after) = conv::field::<Option<std::time::Duration>>(raw(o), "ConfiguredOverlay", "release_after")? {
        c = c.release_gpu_after(after);
    }
    Ok((c, fns))
}

/// Shows, hides, moves and feeds an overlay (`rune::OverlayHandle`).
#[napi(js_name = "OverlayHandle")]
pub struct OverlayHandle {
    h: rune::OverlayHandle<JsState>,
    fns: Rc<AppFns>,
}

impl OverlayHandle {
    pub fn new(h: rune::OverlayHandle<JsState>, fns: Rc<AppFns>) -> Self {
        OverlayHandle { h, fns }
    }
}

#[napi]
impl OverlayHandle {
    #[napi(js_name = "show")]
    pub fn show(&self) {
        self.h.show();
    }
    #[napi(js_name = "hide")]
    pub fn hide(&self) {
        self.h.hide();
    }
    /// Fades in over `duration` seconds.
    #[napi(js_name = "fade_in")]
    pub fn fade_in(&self, duration: f64) {
        self.h.fade_in(std::time::Duration::from_secs_f64(duration.max(0.0)));
    }
    #[napi(js_name = "fade_out")]
    pub fn fade_out(&self, duration: f64) {
        self.h.fade_out(std::time::Duration::from_secs_f64(duration.max(0.0)));
    }
    #[napi(js_name = "set_input", ts_args_type = "input: OverlayInput")]
    pub fn set_input(&self, input: Raw) -> napi::Result<()> {
        self.h.set_input(FromJs::from_js(input.0)?);
        Ok(())
    }
    #[napi(js_name = "set_follow_pointer")]
    pub fn set_follow_pointer(&self, follow: bool) {
        self.h.set_follow_pointer(follow);
    }
    #[napi(js_name = "refollow_pointer")]
    pub fn refollow_pointer(&self) {
        self.h.refollow_pointer();
    }
    #[napi(js_name = "set_placement", ts_args_type = "placement: OverlayPlacement | null")]
    pub fn set_placement(&self, placement: Raw) -> napi::Result<()> {
        self.h.set_placement(FromJs::from_js(placement.0)?);
        Ok(())
    }
    #[napi(js_name = "set_display", ts_args_type = "display: DisplayTarget")]
    pub fn set_display(&self, display: Raw) -> napi::Result<()> {
        self.h.set_display(FromJs::from_js(display.0)?);
        Ok(())
    }
    #[napi(js_name = "request_keys")]
    pub fn request_keys(&self) {
        self.h.request_keys();
    }
    #[napi(js_name = "window_number")]
    pub fn window_number(&self) -> Option<u32> {
        self.h.window_number()
    }
    #[napi(js_name = "capture_exclusion", ts_return_type = "OverlaySupport")]
    pub fn capture_exclusion(&self) -> napi::Result<Raw> {
        Ok(Raw(self.h.capture_exclusion().to_js()?))
    }
    #[napi(js_name = "capabilities", ts_return_type = "OverlayCapabilities")]
    pub fn capabilities(&self) -> napi::Result<Raw> {
        Ok(Raw(self.h.capabilities().to_js()?))
    }
    #[napi(js_name = "set_exclude_from_capture")]
    pub fn set_exclude_from_capture(&self, exclude: bool) {
        self.h.set_exclude_from_capture(exclude);
    }
    #[napi(js_name = "set_xwayland_input")]
    pub fn set_xwayland_input(&self, allow: bool) {
        self.h.set_xwayland_input(allow);
    }
    #[napi(js_name = "set_macos_level")]
    pub fn set_macos_level(&self, level: i64) {
        self.h.set_macos_level(level as isize);
    }
    #[napi(js_name = "set_edge", ts_args_type = "edge: ScreenEdge")]
    pub fn set_edge(&self, edge: Raw) -> napi::Result<()> {
        self.h.set_edge(FromJs::from_js(edge.0)?);
        Ok(())
    }
    #[napi(js_name = "place", ts_args_type = "edge: ScreenEdge, margin: number")]
    pub fn place(&self, edge: Raw, margin: f64) -> napi::Result<()> {
        self.h.place(FromJs::from_js(edge.0)?, margin as f32);
        Ok(())
    }
    #[napi(js_name = "set_align", ts_args_type = "align: Align, inset: number")]
    pub fn set_align(&self, align: Raw, inset: f64) -> napi::Result<()> {
        self.h.set_align(FromJs::from_js(align.0)?, inset as f32);
        Ok(())
    }
    #[napi(js_name = "resize", ts_args_type = "size: [number, number]")]
    pub fn resize(&self, size: Raw) -> napi::Result<()> {
        self.h.resize(FromJs::from_js(size.0)?);
        Ok(())
    }
    /// Runs `f(state, tx)` on the overlay's state before its next frame. Returning a value
    /// replaces a primitive state.
    #[napi(js_name = "update", ts_args_type = "f: (s: any, tx: Tx) => any")]
    pub fn update(&self, f: Function<'_, Unknown<'_>, Unknown<'_>>) {
        self.fns.updates.borrow_mut().push(keep(&f));
        self.h.update(|s: &mut JsState, tx: &mut rune::Tx| {
            state::drain_updates(s, tx);
        });
    }
    #[napi(js_name = "availability", ts_return_type = "Availability")]
    pub fn availability(&self) -> napi::Result<Raw> {
        Ok(Raw(self.h.availability().to_js()?))
    }
    #[napi(js_name = "failure")]
    pub fn failure(&self) -> Option<String> {
        self.h.failure()
    }
    #[napi(js_name = "surface_description")]
    pub fn surface_description(&self) -> Option<String> {
        self.h.surface_description()
    }
    #[napi(js_name = "clone")]
    pub fn clone_js(&self) -> OverlayHandle {
        OverlayHandle { h: self.h.clone(), fns: self.fns.clone() }
    }
}
