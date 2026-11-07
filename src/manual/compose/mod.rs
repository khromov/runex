//! The fx compositor: a general `rune::compose::Compositor` that JavaScript plans and Rust draws.
//!
//! Raw wgpu can't be written in JavaScript, so Rust owns every GPU resource and pass (rune-fx's
//! `FxRenderer`, rune-light's `LightRenderer`, offscreen targets, backdrop copies, the resolve)
//! and JavaScript decides, once per frame, what to draw. Rune calls `render`; it lends the
//! compositor object's `render(frame)` a `ComposeFrame` (the clock, sizes, the pointer, presented
//! rects, effect slots, the app state) and reads back a plan (`plan.rs`): which fx layers, where,
//! which lights, and which pipeline features. Two pipelines draw a plan:
//!
//! - `"ui"` (`ui.rs`): Rune draws the frame as usual; each fx layer draws at an `El::effect`
//!   slot, inside the slot's pass (its opacity, clip and transform apply), with backdrop copies at
//!   `El::effect_backdrop` slots.
//! - `"hdr"` (`hdr.rs`): the compositor draws the frame into one linear `Rgba16Float` scene: Rune's
//!   instances are routed by `El::mark` into the main list, a top list, offscreen sources (node
//!   layers, mask pyramids) and rune-light's lighting; fx layers draw under or over marked ranges,
//!   with a backdrop copy before each layer that reads one; one resolve with TPDF dither writes
//!   the target.
//!
//! ts/compose.ts documents the JavaScript side.

mod frame;
mod gpu;
mod hdr;
mod plan;
mod ui;

use std::time::Instant;

use rune::compose::{Compositor, Frame};
use rune_fx::FxStats;

use crate::conv::{self, FromJs};
use crate::js::{self, JsRef};
use crate::state::JsState;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Pipeline {
    Ui,
    Hdr,
}

/// The compositor object's static options, read once when it's attached.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Options {
    pub pipeline: Pipeline,
    /// TPDF dither in the effect shaders (`FxOptions::dither`). Default: on for `"ui"` (8-bit
    /// targets), off for `"hdr"` (it dithers once at the resolve).
    pub dither: bool,
    /// Simulate fire and smoke on small fluid grids (`FxRenderer::set_fire_sim`).
    pub fire_sim: bool,
    /// Blur backdrop copies for frosted layers (`FxRenderer::blur_backdrop`); off, a layer that
    /// reads a backdrop gets the copy bound as is and frost falls back to the shader's small blur.
    pub blur_backdrop: bool,
    /// GPU timestamps around the compositor's passes (`Frame.gpu_ms`, `TIMESTAMP_QUERY`).
    pub timestamps: bool,
}

/// What the previous frame left for the next plan to read.
#[derive(Clone, Copy, Default)]
pub(crate) struct Last {
    pub gpu_ms: Option<f32>,
    pub stats: FxStats,
    pub compose_ms: f64,
}

/// A JavaScript compositor object (`{ render(frame) { return plan } }`) as a Rune compositor.
pub struct JsCompositor {
    obj: JsRef,
    opts: Options,
    animating: bool,
    ui: ui::Ui,
    hdr: hdr::Hdr,
    last: Last,
}

fn flag(o: conv::Value, name: &str, default: bool) -> conv::Result<bool> {
    conv::field_or::<Option<bool>>(o, "Compositor", name, || None).map(|v| v.unwrap_or(default))
}

impl JsCompositor {
    /// Reads a compositor object: its `render` method and its static options.
    pub fn from_js(o: conv::Value) -> conv::Result<JsCompositor> {
        if conv::kind(o) != napi::sys::ValueType::napi_object && conv::kind(o) != napi::sys::ValueType::napi_function {
            return Err(conv::err("a compositor is an object with a render(frame) method"));
        }
        if conv::kind(conv::get(o, "render")) != napi::sys::ValueType::napi_function {
            return Err(conv::err("a compositor needs a render(frame) method"));
        }
        let pipeline = match conv::field_or::<Option<String>>(o, "Compositor", "pipeline", || None)?.as_deref() {
            None | Some("ui") => Pipeline::Ui,
            Some("hdr") => Pipeline::Hdr,
            Some(other) => return Err(conv::err(format!("Compositor.pipeline: \"ui\" or \"hdr\", not {other:?}"))),
        };
        let opts = Options {
            pipeline,
            dither: flag(o, "dither", pipeline == Pipeline::Ui)?,
            fire_sim: flag(o, "fire_sim", false)?,
            blur_backdrop: flag(o, "blur_backdrop", true)?,
            timestamps: flag(o, "timestamps", false)?,
        };
        Ok(JsCompositor { obj: JsRef::new(o), opts, animating: false, ui: ui::Ui::default(), hdr: hdr::Hdr::default(), last: Last::default() })
    }

    /// Calls `render(frame)` and reads its plan; `None` when it threw or returned a bad plan
    /// (the error is kept for the pump to rethrow).
    fn plan(&mut self, f: &mut Frame<'_, JsState>) -> Option<plan::Plan> {
        js::scope(|| {
            let obj = self.obj.value();
            let render = conv::get(obj, "render");
            let out = frame::lend(f, self.last, |frame| js::call_with(obj, render, &[frame]))?;
            if conv::is_nullish(out) {
                return Some(plan::Plan::default());
            }
            match plan::read(out, self.opts.pipeline) {
                Ok(p) => Some(p),
                Err(e) => {
                    js::throw_error(&format!("Compositor.render returned a bad plan: {}", e.reason));
                    None
                }
            }
        })
    }
}

impl Compositor<JsState> for JsCompositor {
    fn features(&self) -> wgpu::Features {
        if self.opts.timestamps { wgpu::Features::TIMESTAMP_QUERY } else { wgpu::Features::empty() }
    }

    fn animating(&self) -> bool {
        self.animating
    }

    fn summary(&mut self, _device: &wgpu::Device) -> Option<String> {
        js::scope(|| {
            let obj = self.obj.value();
            let f = conv::get(obj, "summary");
            if conv::kind(f) != napi::sys::ValueType::napi_function {
                return None;
            }
            js::call_with(obj, f, &[]).and_then(|v| Option::<String>::from_js(v).ok().flatten())
        })
    }

    fn render(&mut self, f: &mut Frame<'_, JsState>) {
        let started = Instant::now();
        let Some(plan) = self.plan(f) else {
            // The view stays visible while the compositor's script is broken.
            self.animating = false;
            f.draw_ui();
            return;
        };
        self.animating = plan.animating;
        match self.opts.pipeline {
            Pipeline::Ui => self.last.stats = self.ui.render(&self.opts, f, plan),
            Pipeline::Hdr => {
                let (stats, gpu_ms) = self.hdr.render(&self.opts, f, plan);
                self.last.stats = stats;
                // Each reading reaches exactly one plan, as `Timer::begin` hands it out once.
                self.last.gpu_ms = gpu_ms;
            }
        }
        self.last.compose_ms = started.elapsed().as_secs_f64() * 1000.0;
    }
}
