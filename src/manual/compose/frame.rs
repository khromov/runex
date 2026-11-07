//! `ComposeFrame`: what a compositor's `render(frame)` reads, lent for the length of the call
//! (Rust's `rune::compose::Frame` and the `Runtime` it holds, minus the GPU handles).

use napi::bindgen_prelude::ToNapiValue;
use napi_derive::napi;
use rune::compose::Frame;
use rune::render::{Instance, KIND_EFFECT};
use rune::Runtime;

use super::Last;
use crate::conv::{self, Raw, ToJs};
use crate::js;
use crate::state::JsState;

struct View {
    rt: *mut Runtime<JsState>,
    size: (u32, u32),
    dt: f64,
    update_ms: f64,
    srgb_blend: bool,
    format: wgpu::TextureFormat,
    last: Last,
}

/// One frame handed to a compositor's `render`: valid only during that call.
#[napi(js_name = "ComposeFrame")]
pub struct ComposeFrame {
    view: Option<View>,
}

/// Lends `f` to JavaScript as a `ComposeFrame` for the length of `call`.
pub(super) fn lend<R>(f: &mut Frame<'_, JsState>, last: Last, call: impl FnOnce(conv::Value) -> R) -> R {
    let view = View { rt: &mut *f.rt, size: f.size, dt: f.dt, update_ms: f.update_ms, srgb_blend: f.srgb_blend(), format: f.format, last };
    // SAFETY: on the JavaScript thread with its env.
    let v = unsafe { ComposeFrame::to_napi_value(js::env(), ComposeFrame { view: Some(view) }) }.unwrap_or_else(|_| conv::undefined());
    let r = call(v);
    if let Ok(mut frame) = conv::instance_plain::<ComposeFrame>(v) {
        frame.view = None;
    }
    r
}

fn effect_mark(i: &Instance) -> u32 {
    (i.border[0] as u32 & 0xFFFF) | (i.border[1] as u32 & 0xFFFF) << 16
}

impl ComposeFrame {
    fn view(&self) -> napi::Result<&View> {
        self.view.as_ref().ok_or_else(|| conv::err("this frame was lent to a compositor's render, which has returned"))
    }

    fn rt(&self) -> napi::Result<&mut Runtime<JsState>> {
        // SAFETY: the runtime outlives the render call the frame is lent for; JavaScript holds no
        // other reference to it meanwhile.
        Ok(unsafe { &mut *self.view()?.rt })
    }
}

#[napi]
impl ComposeFrame {
    /// The app's state (`rt.state`). Change it in place, then `invalidate()` so the view re-runs.
    #[napi(getter, ts_return_type = "any")]
    pub fn state(&self) -> napi::Result<Raw> {
        Ok(Raw(self.rt()?.state.value()))
    }

    /// Animation time in seconds (`rt.t`; Rune's virtual clock when headless).
    #[napi(getter)]
    pub fn t(&self) -> napi::Result<f64> {
        Ok(self.rt()?.t)
    }

    /// Seconds since the first frame, unscaled (`rt.clock`).
    #[napi(getter)]
    pub fn clock(&self) -> napi::Result<f64> {
        Ok(self.rt()?.clock)
    }

    /// Scale and theme (`rt.env`): `scale` is device pixels per point.
    #[napi(getter, ts_return_type = "Env")]
    pub fn env(&self) -> napi::Result<Raw> {
        Ok(Raw(self.rt()?.env.clone().to_js()?))
    }

    /// The window in points (`rt.viewport`).
    #[napi(getter, ts_return_type = "[number, number]")]
    pub fn viewport(&self) -> napi::Result<Raw> {
        let (w, h) = self.rt()?.viewport;
        Ok(Raw((w, h).to_js()?))
    }

    /// Target size in device pixels.
    #[napi(getter, ts_return_type = "[number, number]")]
    pub fn size(&self) -> napi::Result<Raw> {
        Ok(Raw(self.view()?.size.to_js()?))
    }

    /// Real seconds since the previous frame (0 on the first).
    #[napi(getter)]
    pub fn dt(&self) -> napi::Result<f64> {
        Ok(self.view()?.dt)
    }

    /// CPU milliseconds Rune's frame took before the compositor (handlers, view, layout, animation).
    #[napi(getter, js_name = "update_ms")]
    pub fn update_ms(&self) -> napi::Result<f64> {
        Ok(self.view()?.update_ms)
    }

    /// Whether the frame blends in sRGB space (`App::srgb_blend`).
    #[napi(getter, js_name = "srgb_blend")]
    pub fn srgb_blend(&self) -> napi::Result<bool> {
        Ok(self.view()?.srgb_blend)
    }

    /// The target's texture format, as wgpu names it (e.g. `"Bgra8UnormSrgb"`).
    #[napi(getter)]
    pub fn format(&self) -> napi::Result<String> {
        Ok(format!("{:?}", self.view()?.format))
    }

    /// GPU milliseconds of a recent frame, when the compositor asked for `timestamps` and a
    /// reading landed since the previous frame; otherwise null.
    #[napi(getter, js_name = "gpu_ms", ts_return_type = "number | null")]
    pub fn gpu_ms(&self) -> napi::Result<Option<f64>> {
        Ok(self.view()?.last.gpu_ms.map(f64::from))
    }

    /// What the previous frame's effects cost (`FxRenderer::prepare`'s `FxStats`).
    #[napi(getter, ts_return_type = "FxStats")]
    pub fn stats(&self) -> napi::Result<Raw> {
        Ok(Raw(self.view()?.last.stats.to_js()?))
    }

    /// CPU milliseconds the previous frame's compositor took (this call and its drawing).
    #[napi(getter, js_name = "compose_ms")]
    pub fn compose_ms(&self) -> napi::Result<f64> {
        Ok(self.view()?.last.compose_ms)
    }

    /// The pointer in window points, or null outside the window (`rt.pointer()`).
    #[napi(js_name = "pointer", ts_return_type = "[number, number] | null")]
    pub fn pointer(&self) -> napi::Result<Raw> {
        Ok(Raw(self.rt()?.pointer().to_js()?))
    }

    /// Whether a press is held (`rt.pressing()`).
    #[napi(js_name = "pressing")]
    pub fn pressing(&self) -> napi::Result<bool> {
        Ok(self.rt()?.pressing())
    }

    /// Drawn rect `[x, y, w, h]` in points and effective opacity of the element keyed `key`,
    /// exiting or not, as of this frame (`rt.presented`).
    #[napi(js_name = "presented", ts_return_type = "[[number, number, number, number], number] | null")]
    pub fn presented(&self, key: String) -> napi::Result<Raw> {
        Ok(Raw(self.rt()?.presented(&key).to_js()?))
    }

    /// The window's clear colour (`rt.clear_color()`), premultiplied, in the frame's encoding.
    #[napi(js_name = "clear_color", ts_return_type = "[number, number, number, number]")]
    pub fn clear_color(&self) -> napi::Result<Raw> {
        Ok(Raw(self.rt()?.clear_color().to_js()?))
    }

    /// Marks the state changed (`rt.invalidate()`): the next frame re-runs the view.
    #[napi(js_name = "invalidate")]
    pub fn invalidate(&self) -> napi::Result<()> {
        self.rt()?.invalidate();
        Ok(())
    }

    /// How many instances Rune painted this frame (`rt.instances.len()`).
    #[napi(getter, js_name = "instance_count")]
    pub fn instance_count(&self) -> napi::Result<u32> {
        Ok(self.rt()?.instances.len() as u32)
    }

    /// The frame's effect slots (`El::effect`), in painter order: `index` (anchor a layer with
    /// `{ slot: index }`), `mark` (`El::mark`, which `effect(mark)` sets), `effect` (the slot's
    /// effect tag), `data` (`El::effect_data`), `rect` `[x, y, w, h]` and `radii` in device pixels,
    /// `scale` (device pixels per point at the slot), `clip` and `fade` (for `FxSlot.clip`), and
    /// `backdrop` (`El::effect_backdrop`).
    #[napi(js_name = "slots", ts_return_type = "EffectSlot[]")]
    pub fn slots(&self) -> napi::Result<Raw> {
        let rt = self.rt()?;
        let mut out = Vec::new();
        for (n, i) in rt.instances.iter().enumerate() {
            if i.params[1] != KIND_EFFECT {
                continue;
            }
            let o = conv::object();
            conv::set(o, "index", (n as u32).to_js()?);
            conv::set(o, "mark", rt.marks.get(n).copied().unwrap_or(0).to_js()?);
            conv::set(o, "effect", effect_mark(i).to_js()?);
            conv::set(o, "data", i.uv.to_js()?);
            conv::set(o, "rect", i.rect.to_js()?);
            conv::set(o, "radii", i.radii.to_js()?);
            conv::set(o, "scale", i.params[3].to_js()?);
            conv::set(o, "clip", i.clip.to_js()?);
            conv::set(o, "fade", i.fade.to_js()?);
            conv::set(o, "backdrop", (i.params[0] != 0.0).to_js()?);
            out.push(o);
        }
        Ok(Raw(conv::array(out)))
    }
}
