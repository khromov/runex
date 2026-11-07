//! Generic motion and effect helpers the generator skips (`rune_motion::Animated<T>`,
//! `rune_motion::VelocityTracker<T>`, `rune_fx::OneShots<T>`). Rust's are generic over the
//! value; JavaScript has one class each whose kind follows its values: a number (`f32`) or a
//! `Vec2` (`{ x, y }`). `OneShots` carries any JavaScript value as its payload.

use napi_derive::napi;
use rune_motion::{Anim, Curve, Spring, SpringPair, Vec2};

use crate::conv::{self, FromJs, Raw, ToJs};
use crate::js::JsRef;

/// A value's kind, read from JavaScript.
enum Value {
    F32(f32),
    V2(Vec2),
}

fn value(v: conv::Value) -> conv::Result<Value> {
    match conv::kind(v) {
        napi::sys::ValueType::napi_number => Ok(Value::F32(f32::from_js(v)?)),
        napi::sys::ValueType::napi_object => Ok(Value::V2(Vec2::from_js(v)?)),
        _ => Err(conv::err("an animated value is a number or a Vec2 ({ x, y })")),
    }
}

fn mismatch() -> napi::Error {
    conv::err("this value's kind differs from the Animated's (number or Vec2)")
}

/// `impl Into<Anim>`: an `Anim`, a `Spring`, a `SpringPair` or a `Curve`.
fn anim(v: conv::Value) -> conv::Result<Anim> {
    if conv::kind(v) == napi::sys::ValueType::napi_object {
        if conv::has(v, "curve") {
            return Anim::from_js(v);
        }
        if conv::has(v, "duration") && conv::has(v, "bounce") {
            return Ok(Spring::from_js(v)?.into());
        }
        if conv::has(v, "enter") {
            return Ok(SpringPair::from_js(v)?.into());
        }
    }
    Ok(Curve::from_js(v)?.into())
}

/// `impl Into<Curve>`: a `Spring` or a `Curve`.
fn curve(v: conv::Value) -> conv::Result<Curve> {
    if conv::kind(v) == napi::sys::ValueType::napi_object && conv::has(v, "duration") && conv::has(v, "bounce") {
        return Ok(Spring::from_js(v)?.into());
    }
    Curve::from_js(v)
}

#[derive(Clone, Copy)]
enum AnyAnimated {
    F32(rune_motion::Animated<f32>),
    V2(rune_motion::Animated<Vec2>),
}

/// One retargetable value you own directly (`rune_motion::Animated`): a number or a `Vec2`.
#[napi(js_name = "Animated")]
pub struct Animated {
    inner: AnyAnimated,
}

#[napi]
impl Animated {
    /// At rest at `value` (a number or a `Vec2`).
    #[napi(js_name = "new", ts_args_type = "value: number | Vec2", ts_return_type = "Animated")]
    pub fn new(value_: Raw) -> napi::Result<Animated> {
        Ok(Animated {
            inner: match value(value_.0)? {
                Value::F32(v) => AnyAnimated::F32(rune_motion::Animated::new(v)),
                Value::V2(v) => AnyAnimated::V2(rune_motion::Animated::new(v)),
            },
        })
    }

    /// Uses `class`'s settle thresholds (at 2× pixel scale). Returns a new value, as Rust's copy.
    #[napi(js_name = "with_class", ts_args_type = "class_: PropClass", ts_return_type = "Animated")]
    pub fn with_class(&self, class: Raw) -> napi::Result<Animated> {
        let class = rune_motion::PropClass::from_js(class.0)?;
        Ok(Animated {
            inner: match self.inner {
                AnyAnimated::F32(a) => AnyAnimated::F32(a.with_class(class)),
                AnyAnimated::V2(a) => AnyAnimated::V2(a.with_class(class)),
            },
        })
    }

    /// Jumps to `value` (direct manipulation).
    #[napi(js_name = "set", ts_args_type = "value: number | Vec2")]
    pub fn set(&mut self, value_: Raw) -> napi::Result<()> {
        match (&mut self.inner, value(value_.0)?) {
            (AnyAnimated::F32(a), Value::F32(v)) => a.set(v),
            (AnyAnimated::V2(a), Value::V2(v)) => a.set(v),
            _ => return Err(mismatch()),
        }
        Ok(())
    }

    /// Animates to `target` from the exact state at `now` (a `Spring`, `Curve` or `Anim`).
    #[napi(js_name = "animate_to", ts_args_type = "target: number | Vec2, anim: Spring | Curve | Anim | SpringPair, now: number")]
    pub fn animate_to(&mut self, target: Raw, anim_: Raw, now: f64) -> napi::Result<()> {
        let anim = anim(anim_.0)?;
        match (&mut self.inner, value(target.0)?) {
            (AnyAnimated::F32(a), Value::F32(v)) => a.animate_to(v, anim, now),
            (AnyAnimated::V2(a), Value::V2(v)) => a.animate_to(v, anim, now),
            _ => return Err(mismatch()),
        }
        Ok(())
    }

    /// Retargets on the curve last used.
    #[napi(js_name = "retarget", ts_args_type = "target: number | Vec2, now: number")]
    pub fn retarget(&mut self, target: Raw, now: f64) -> napi::Result<()> {
        match (&mut self.inner, value(target.0)?) {
            (AnyAnimated::F32(a), Value::F32(v)) => a.retarget(v, now),
            (AnyAnimated::V2(a), Value::V2(v)) => a.retarget(v, now),
            _ => return Err(mismatch()),
        }
        Ok(())
    }

    /// Gesture handoff: continue from the current position with `velocity` on `curve`.
    #[napi(js_name = "release", ts_args_type = "velocity: number | Vec2, target: number | Vec2, curve: Spring | Curve, now: number")]
    pub fn release(&mut self, velocity: Raw, target: Raw, curve_: Raw, now: f64) -> napi::Result<()> {
        let curve = curve(curve_.0)?;
        match (&mut self.inner, value(velocity.0)?, value(target.0)?) {
            (AnyAnimated::F32(a), Value::F32(v), Value::F32(t)) => a.release(v, t, curve, now),
            (AnyAnimated::V2(a), Value::V2(v), Value::V2(t)) => a.release(v, t, curve, now),
            _ => return Err(mismatch()),
        }
        Ok(())
    }

    /// Value at `now`.
    #[napi(js_name = "sample", ts_return_type = "any")]
    pub fn sample(&self, now: f64) -> napi::Result<Raw> {
        Ok(Raw(match self.inner {
            AnyAnimated::F32(a) => a.sample(now).to_js()?,
            AnyAnimated::V2(a) => a.sample(now).to_js()?,
        }))
    }

    /// Velocity at `now`, units per second.
    #[napi(js_name = "velocity", ts_return_type = "any")]
    pub fn velocity(&self, now: f64) -> napi::Result<Raw> {
        Ok(Raw(match self.inner {
            AnyAnimated::F32(a) => a.velocity(now).to_js()?,
            AnyAnimated::V2(a) => a.velocity(now).to_js()?,
        }))
    }

    #[napi(js_name = "target", ts_return_type = "any")]
    pub fn target(&self) -> napi::Result<Raw> {
        Ok(Raw(match self.inner {
            AnyAnimated::F32(a) => a.target().to_js()?,
            AnyAnimated::V2(a) => a.target().to_js()?,
        }))
    }

    /// When every lane is within its settle thresholds for good.
    #[napi(js_name = "settle_time")]
    pub fn settle_time(&self) -> f64 {
        match self.inner {
            AnyAnimated::F32(a) => a.settle_time(),
            AnyAnimated::V2(a) => a.settle_time(),
        }
    }

    #[napi(js_name = "is_settled")]
    pub fn is_settled(&self, now: f64) -> bool {
        match self.inner {
            AnyAnimated::F32(a) => a.is_settled(now),
            AnyAnimated::V2(a) => a.is_settled(now),
        }
    }

    #[napi(js_name = "clone", ts_return_type = "Animated")]
    pub fn clone_js(&self) -> Animated {
        Animated { inner: self.inner }
    }
}

#[derive(Clone)]
enum AnyTracker {
    /// No sample yet: the kind follows the first `add`.
    Unset,
    F32(rune_motion::VelocityTracker<f32>),
    V2(rune_motion::VelocityTracker<Vec2>),
}

/// Least-squares velocity of recent samples (`rune_motion::VelocityTracker`): numbers or `Vec2`s,
/// as the first `add` says.
#[napi(js_name = "VelocityTracker")]
pub struct VelocityTracker {
    inner: AnyTracker,
}

#[napi]
impl VelocityTracker {
    #[napi(js_name = "new", ts_return_type = "VelocityTracker")]
    pub fn new() -> VelocityTracker {
        VelocityTracker { inner: AnyTracker::Unset }
    }

    /// Records a position at event time `t` (seconds).
    #[napi(js_name = "add", ts_args_type = "t: number, value: number | Vec2")]
    pub fn add(&mut self, t: f64, value_: Raw) -> napi::Result<()> {
        let v = value(value_.0)?;
        if matches!(self.inner, AnyTracker::Unset) {
            self.inner = match v {
                Value::F32(_) => AnyTracker::F32(rune_motion::VelocityTracker::new()),
                Value::V2(_) => AnyTracker::V2(rune_motion::VelocityTracker::new()),
            };
        }
        match (&mut self.inner, v) {
            (AnyTracker::F32(tr), Value::F32(v)) => tr.add(t, v),
            (AnyTracker::V2(tr), Value::V2(v)) => tr.add(t, v),
            _ => return Err(conv::err("this value's kind differs from the tracker's (number or Vec2)")),
        }
        Ok(())
    }

    #[napi(js_name = "reset")]
    pub fn reset(&mut self) {
        match &mut self.inner {
            AnyTracker::Unset => {}
            AnyTracker::F32(t) => t.reset(),
            AnyTracker::V2(t) => t.reset(),
        }
    }

    /// Velocity in units per second at the newest sample (a zero `Vec2` before any sample).
    #[napi(js_name = "velocity", ts_return_type = "any")]
    pub fn velocity(&self) -> napi::Result<Raw> {
        Ok(Raw(match &self.inner {
            AnyTracker::Unset => Vec2 { x: 0.0, y: 0.0 }.to_js()?,
            AnyTracker::F32(t) => t.velocity().to_js()?,
            AnyTracker::V2(t) => t.velocity().to_js()?,
        }))
    }

    #[napi(js_name = "clone", ts_return_type = "VelocityTracker")]
    pub fn clone_js(&self) -> VelocityTracker {
        VelocityTracker { inner: self.inner.clone() }
    }
}

/// A bounded pool of overlapping one-shot effects (`rune_fx::OneShots`): taps, pings, shockwaves.
/// Each instance carries a JavaScript payload.
#[napi(js_name = "OneShots")]
pub struct OneShots {
    inner: rune_fx::OneShots<u32>,
    cap: usize,
    next: u32,
    /// Payloads by id, the most recent `4 × cap + 8`: no instance outlives that many triggers.
    data: std::collections::VecDeque<(u32, JsRef)>,
}

#[napi]
impl OneShots {
    #[napi(js_name = "new", ts_return_type = "OneShots")]
    pub fn new(cap: u32) -> OneShots {
        let cap = (cap as usize).max(1);
        OneShots { inner: rune_fx::OneShots::new(cap), cap, next: 0, data: Default::default() }
    }

    #[napi(js_name = "trigger", ts_args_type = "t: number, data: any")]
    pub fn trigger(&mut self, t: f64, data: Raw) {
        let id = self.next;
        self.next = self.next.wrapping_add(1);
        self.inner.trigger(t as f32, id);
        // Node-API references hold objects only: the payload rides in a one-item array.
        self.data.push_back((id, JsRef::new(conv::array([data.0]))));
        while self.data.len() > 4 * self.cap + 8 {
            self.data.pop_front();
        }
    }

    /// Instances alive at `t` (started less than `life` seconds ago) with their opacity:
    /// `[{ t0, data, seed }, k]`.
    #[napi(js_name = "live", ts_return_type = "[{ t0: number; data: any; seed: number }, number][]")]
    pub fn live(&self, t: f64, life: f64) -> napi::Result<Raw> {
        let mut out = Vec::new();
        for (s, k) in self.inner.live(t as f32, life as f32) {
            let o = conv::object();
            conv::set(o, "t0", s.t0.to_js()?);
            let data = self.data.iter().find(|(id, _)| *id == s.data).map_or_else(conv::undefined, |(_, d)| conv::element_at(d.value(), 0));
            conv::set(o, "data", data);
            conv::set(o, "seed", s.seed.to_js()?);
            out.push(conv::array([o, k.to_js()?]));
        }
        Ok(Raw(conv::array(out)))
    }

    /// Drop instances that finished (older than `life`) or faded out.
    #[napi(js_name = "prune")]
    pub fn prune(&mut self, t: f64, life: f64) {
        self.inner.prune(t as f32, life as f32);
    }

    #[napi(js_name = "is_animating")]
    pub fn is_animating(&self, t: f64, life: f64) -> bool {
        self.inner.is_animating(t as f32, life as f32)
    }

    #[napi(js_name = "clear")]
    pub fn clear(&mut self) {
        self.inner.clear();
        self.data.clear();
    }
}
