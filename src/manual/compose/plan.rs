//! A frame's plan, read from what the compositor's `render(frame)` returned (ts/compose.ts has
//! its documented TypeScript shape).

use rune_fx::{FxLayer, FxSlot};
use rune_light::{Light, Prim, Settings};

use super::Pipeline;
use crate::conv::{self, FromJs, Value};

/// Instances whose `El::mark` satisfies `mark & mask == value`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Match {
    pub value: u32,
    pub mask: u32,
}

impl Match {
    pub fn matches(&self, mark: u32) -> bool {
        mark & self.mask == self.value
    }
}

/// A u32 from a JavaScript number, taking a negative int32 (what `|` and `<<` make of a value
/// with bit 31 set) as its bit pattern.
fn u32_of(v: Value, what: &str) -> conv::Result<u32> {
    let n = f64::from_js(v).map_err(|e| conv::err(format!("{what}: {}", e.reason)))?;
    if !n.is_finite() || n.fract() != 0.0 || n < i32::MIN as f64 || n > u32::MAX as f64 {
        return Err(conv::err(format!("{what}: expected a 32-bit integer, got {n}")));
    }
    Ok(if n < 0.0 { n as i32 as u32 } else { n as u32 })
}

fn is_array(v: Value) -> bool {
    let mut out = false;
    unsafe { napi::sys::napi_is_array(crate::js::env(), v, &mut out) };
    out
}

impl FromJs for Match {
    /// A mark (`value`, every bit compared) or `[value, mask]`.
    fn from_js(v: Value) -> conv::Result<Self> {
        if is_array(v) {
            let parts = Vec::<conv::Js>::from_js(v)?;
            let [value, mask] = &parts[..] else { return Err(conv::err("a Match is a mark or [value, mask]")) };
            let mask = u32_of(mask.0, "mask")?;
            return Ok(Match { value: u32_of(value.0, "value")? & mask, mask });
        }
        Ok(Match { value: u32_of(v, "mark")?, mask: u32::MAX })
    }
}

/// Where an fx layer draws.
#[derive(Clone, Copy, Debug)]
pub(super) enum Anchor {
    /// `"ui"`: at the effect slot with this painter index (`Frame.slots()[i].index`).
    Slot(u32),
    /// `"hdr"`: just before the first main-list instance whose mark matches.
    Under(Match),
    /// `"hdr"`: just after the last main-list instance whose mark matches.
    Over(Match),
    /// `"hdr"`: after the whole main list (before the `top` routes).
    Top,
}

impl FromJs for Anchor {
    fn from_js(v: Value) -> conv::Result<Self> {
        if conv::kind(v) == napi::sys::ValueType::napi_string {
            return match String::from_js(v)?.as_str() {
                "top" => Ok(Anchor::Top),
                other => Err(conv::err(format!("an anchor is \"top\", {{ slot }}, {{ under }} or {{ over }}, not {other:?}"))),
            };
        }
        let (tag, payload) = conv::enum_tag(v, "Anchor")?;
        let payload = payload.ok_or_else(|| conv::err("an anchor object has a payload"))?;
        match tag.as_str() {
            "slot" => Ok(Anchor::Slot(u32_of(payload, "slot")?)),
            "under" => Ok(Anchor::Under(Match::from_js(payload)?)),
            "over" => Ok(Anchor::Over(Match::from_js(payload)?)),
            other => Err(conv::err(format!("an anchor is \"top\", {{ slot }}, {{ under }} or {{ over }}, not {{ {other} }}"))),
        }
    }
}

pub(super) struct Layer {
    pub layer: FxLayer,
    pub at: Anchor,
    /// `"ui"`: the layer's placement in its slot (default: the slot's scale, clip and fade).
    pub slot: Option<FxSlot>,
}

impl FromJs for Layer {
    fn from_js(v: Value) -> conv::Result<Self> {
        Ok(Layer {
            layer: conv::field(v, "PlanLayer", "layer")?,
            at: conv::field(v, "PlanLayer", "at")?,
            slot: conv::field_or(v, "PlanLayer", "slot", || None)?,
        })
    }
}

/// Where a routed instance draws.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Draw {
    /// The main list, in painter order (the default).
    Main,
    /// After the main list and every layer: above everything (a demo pointer).
    Top,
    /// Nowhere in the scene (only where `also` / `lit` send it).
    None,
    /// Into source slot `n` instead of the scene (an effect reads it through `FxLayer.source`;
    /// on a frame no layer reads it, the instance draws nowhere).
    Source(usize),
}

impl FromJs for Draw {
    fn from_js(v: Value) -> conv::Result<Self> {
        if conv::kind(v) == napi::sys::ValueType::napi_number {
            return Ok(Draw::Source(u32_of(v, "draw")? as usize));
        }
        match String::from_js(v)?.as_str() {
            "main" => Ok(Draw::Main),
            "top" => Ok(Draw::Top),
            "none" => Ok(Draw::None),
            other => Err(conv::err(format!("Route.draw is \"main\", \"top\", \"none\" or a source slot, not {other:?}"))),
        }
    }
}

pub(super) struct Route {
    pub m: Match,
    pub draw: Draw,
    /// Also draw into this source slot (a mask), wherever `draw` puts the instance, on frames a
    /// layer reads it.
    pub also: Option<usize>,
    /// Feed the lighting pass: glyphs to its text layer, everything else to its base, rects to
    /// its primitives (`Lighting.prims`).
    pub lit: bool,
    /// Device pixels added to the rect where `draw` puts it (the main list or a source).
    pub offset: Option<[f32; 2]>,
}

impl Route {
    pub const MAIN: Route = Route { m: Match { value: 0, mask: 0 }, draw: Draw::Main, also: None, lit: false, offset: None };
}

impl FromJs for Route {
    fn from_js(v: Value) -> conv::Result<Self> {
        let also: Option<f64> = conv::field_or(v, "Route", "also", || None)?;
        Ok(Route {
            m: conv::field(v, "Route", "match")?,
            draw: conv::field_or(v, "Route", "draw", || Draw::Main)?,
            also: also.map(|n| n as usize),
            lit: conv::field_or::<Option<bool>>(v, "Route", "lit", || None)?.unwrap_or(false),
            offset: conv::field_or(v, "Route", "offset", || None)?,
        })
    }
}

/// What an offscreen source slot is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SourceKind {
    /// An `Rgba16Float` texture of the window's size (a node an effect redraws, e.g. motion blur).
    Layer,
    /// A mask and its blur pyramid (`rune_fx::MaskPyramid`): glow and shimmer through text.
    Mask,
}

impl FromJs for SourceKind {
    fn from_js(v: Value) -> conv::Result<Self> {
        match String::from_js(v)?.as_str() {
            "layer" => Ok(SourceKind::Layer),
            "mask" => Ok(SourceKind::Mask),
            other => Err(conv::err(format!("a source is \"layer\" or \"mask\", not {other:?}"))),
        }
    }
}

/// How a lit rect stands on the UI plane, applied in this order to
/// `Prim::from_rune(rect, radii).albedo(fill ÷ alpha)`.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct PrimStyle {
    on: Option<f32>,
    raised: Option<f32>,
    floating: Option<[f32; 2]>,
    bevel: Option<[f32; 2]>,
    gloss: Option<[f32; 2]>,
    /// Emission as a multiple of the albedo.
    emissive: Option<f32>,
}

impl PrimStyle {
    pub fn apply(&self, mut p: Prim, albedo: [f32; 3]) -> Prim {
        if let Some(z) = self.on {
            p = p.on(z);
        }
        if let Some(h) = self.raised {
            p = p.raised(h);
        }
        if let Some([b, t]) = self.floating {
            p = p.floating(b, t);
        }
        if let Some([w, h]) = self.bevel {
            p = p.bevel(w, h);
        }
        if let Some([g, r]) = self.gloss {
            p = p.gloss(g, r);
        }
        if let Some(k) = self.emissive {
            p = p.emissive([albedo[0] * k, albedo[1] * k, albedo[2] * k]);
        }
        p
    }
}

impl FromJs for PrimStyle {
    fn from_js(v: Value) -> conv::Result<Self> {
        Ok(PrimStyle {
            on: conv::field_or(v, "PrimStyle", "on", || None)?,
            raised: conv::field_or(v, "PrimStyle", "raised", || None)?,
            floating: conv::field_or(v, "PrimStyle", "floating", || None)?,
            bevel: conv::field_or(v, "PrimStyle", "bevel", || None)?,
            gloss: conv::field_or(v, "PrimStyle", "gloss", || None)?,
            emissive: conv::field_or(v, "PrimStyle", "emissive", || None)?,
        })
    }
}

pub(super) struct PrimRule {
    pub m: Match,
    /// `None`: matching rects stay flat (no primitive).
    pub style: Option<PrimStyle>,
}

impl FromJs for PrimRule {
    fn from_js(v: Value) -> conv::Result<Self> {
        Ok(PrimRule { m: conv::field(v, "PrimRule", "match")?, style: conv::field_or(v, "PrimRule", "style", || None)? })
    }
}

/// Where the lit image composites into the main list.
#[derive(Clone, Copy, Debug)]
pub(super) enum LitAt {
    /// Where the first instance routed to lighting would have drawn.
    First,
    Anchor(Anchor),
}

/// What the lighting pass's base layer clears to (un-premultiplied, opaque).
#[derive(Clone, Copy, Debug)]
pub(super) enum Background {
    /// The window's clear colour.
    Clear,
    /// The fill of the last rect instance whose mark matches (black when none does).
    Mark(Match),
}

pub(super) struct Lighting {
    pub lights: Vec<Light>,
    pub settings: Settings,
    /// How much of the lit image shows over the scene (0..1).
    pub alpha: f32,
    pub at: LitAt,
    pub background: Background,
    pub prims: Vec<PrimRule>,
    /// Rects fainter than this alpha make no primitive.
    pub min_alpha: Option<f32>,
    /// While lit, effect layers whose anchor is present draw over the lit image (at its place)
    /// instead of at their anchors.
    pub effects_on_top: bool,
}

impl FromJs for Lighting {
    fn from_js(v: Value) -> conv::Result<Self> {
        let at = conv::get(v, "at");
        let at = if conv::is_nullish(at) || (conv::kind(at) == napi::sys::ValueType::napi_string && String::from_js(at)? == "first") {
            LitAt::First
        } else {
            LitAt::Anchor(Anchor::from_js(at).map_err(|e| conv::err(format!("Lighting.at: {}", e.reason)))?)
        };
        let bg = conv::get(v, "background");
        let background = if conv::is_nullish(bg) || (conv::kind(bg) == napi::sys::ValueType::napi_string && String::from_js(bg)? == "clear") {
            Background::Clear
        } else {
            Background::Mark(Match::from_js(bg).map_err(|e| conv::err(format!("Lighting.background: {}", e.reason)))?)
        };
        Ok(Lighting {
            lights: conv::field(v, "Lighting", "lights")?,
            settings: conv::field(v, "Lighting", "settings")?,
            alpha: conv::field_or(v, "Lighting", "alpha", || 1.0)?,
            at,
            background,
            prims: conv::field_or(v, "Lighting", "prims", Vec::new)?,
            min_alpha: conv::field_or(v, "Lighting", "min_alpha", || None)?,
            effects_on_top: conv::field_or::<Option<bool>>(v, "Lighting", "effects_on_top", || None)?.unwrap_or(false),
        })
    }
}

#[derive(Default)]
pub(super) struct Plan {
    pub layers: Vec<Layer>,
    /// What `Compositor::animating` answers until the next frame.
    pub animating: bool,
    // ---- "hdr" only
    pub routes: Vec<Route>,
    pub sources: Vec<SourceKind>,
    /// Multiply isolated-layer opacity into the instances inside and drop the layer records.
    pub flatten_layers: bool,
    pub lighting: Option<Lighting>,
    /// Points: the scissor for effects and the lit image, and the region backdrops copy.
    pub clip: Option<[f32; 4]>,
}

pub(super) fn read(v: Value, pipeline: Pipeline) -> conv::Result<Plan> {
    if conv::kind(v) != napi::sys::ValueType::napi_object {
        return Err(conv::err("a plan is an object ({ layers, animating, ... })"));
    }
    let plan = Plan {
        layers: conv::field_or(v, "Plan", "layers", Vec::new)?,
        animating: conv::field_or::<Option<bool>>(v, "Plan", "animating", || None)?.unwrap_or(false),
        routes: conv::field_or(v, "Plan", "routes", Vec::new)?,
        sources: conv::field_or(v, "Plan", "sources", Vec::new)?,
        flatten_layers: conv::field_or::<Option<bool>>(v, "Plan", "flatten_layers", || None)?.unwrap_or(false),
        lighting: conv::field_or(v, "Plan", "lighting", || None)?,
        clip: conv::field_or(v, "Plan", "clip", || None)?,
    };
    match pipeline {
        Pipeline::Ui => {
            if plan.layers.iter().any(|l| !matches!(l.at, Anchor::Slot(_))) {
                return Err(conv::err("the \"ui\" pipeline draws layers at effect slots: anchor them with { slot: index }"));
            }
            if !plan.routes.is_empty() || !plan.sources.is_empty() || plan.lighting.is_some() || plan.flatten_layers || plan.clip.is_some() {
                return Err(conv::err("routes, sources, lighting, flatten_layers and clip need the \"hdr\" pipeline"));
            }
        }
        Pipeline::Hdr => {
            if plan.layers.iter().any(|l| matches!(l.at, Anchor::Slot(_))) {
                return Err(conv::err("the \"hdr\" pipeline anchors layers with \"top\", { under } or { over }, not { slot }"));
            }
            let n = plan.sources.len();
            for r in &plan.routes {
                if matches!(r.draw, Draw::Source(s) if s >= n) || r.also.is_some_and(|s| s >= n) {
                    return Err(conv::err(format!("a route draws into a source slot the plan doesn't declare (it has {n} sources)")));
                }
            }
        }
    }
    Ok(plan)
}
