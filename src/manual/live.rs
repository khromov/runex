//! Live values (`rune::Live<T>`, `Binding<T>`, `Tween<T>`, `LiveText`): values that move a drawn
//! property without re-running the view. Rust's are generic over the value; JavaScript has one
//! `Live` class whose kind follows its first value: a number (`f32`), a 2- or 4-number array
//! (`[f32; 2]`, `[f32; 4]`), or a `Color`.

use napi::bindgen_prelude::This;
use napi_derive::napi;
use rune::live::Binding as RBinding;
use rune::{Color, Live as RLive, LiveText as RLiveText, Tween as RTween};

use crate::conv::{self, FromJs, Raw, ToJs};
use crate::gen::rune::W_El;

#[derive(Clone)]
enum AnyLive {
    F32(RLive<f32>),
    V2(RLive<[f32; 2]>),
    V4(RLive<[f32; 4]>),
    Color(RLive<Color>),
}

enum AnyBinding {
    F32(RBinding<f32>),
    V2(RBinding<[f32; 2]>),
    V4(RBinding<[f32; 4]>),
    Color(RBinding<Color>),
}

/// A value's kind, read from JavaScript.
enum Value {
    F32(f32),
    V2([f32; 2]),
    V4([f32; 4]),
    Color(Color),
}

fn value(v: conv::Value) -> conv::Result<Value> {
    match conv::kind(v) {
        napi::sys::ValueType::napi_number => Ok(Value::F32(f32::from_js(v)?)),
        napi::sys::ValueType::napi_object => {
            let mut is_array = false;
            unsafe { napi::sys::napi_is_array(crate::js::env(), v, &mut is_array) };
            if is_array {
                let items = Vec::<f32>::from_js(v)?;
                return match items[..] {
                    [a, b] => Ok(Value::V2([a, b])),
                    [a, b, c, d] => Ok(Value::V4([a, b, c, d])),
                    _ => Err(conv::err("a Live array holds 2 or 4 numbers")),
                };
            }
            Ok(Value::Color(Color::from_js(v)?))
        }
        _ => Err(conv::err("a Live value is a number, a 2- or 4-number array, or a Color")),
    }
}

fn mismatch() -> napi::Error {
    conv::err("this value's kind differs from the Live's (number, [x, y], [a, b, c, d] or Color)")
}

/// A value other code changes and bound elements follow without re-running the view.
#[napi(js_name = "Live")]
pub struct Live {
    inner: AnyLive,
}

#[napi]
impl Live {
    /// A live value starting at `value`: a number, `[x, y]`, `[a, b, c, d]` or a `Color`.
    #[napi(js_name = "new", ts_args_type = "value: number | [number, number] | [number, number, number, number] | Color", ts_return_type = "Live")]
    pub fn new(value_: Raw) -> napi::Result<Live> {
        conv::guard(|| {
            Ok(Live {
                inner: match value(value_.0)? {
                    Value::F32(v) => AnyLive::F32(RLive::new(v)),
                    Value::V2(v) => AnyLive::V2(RLive::new(v)),
                    Value::V4(v) => AnyLive::V4(RLive::new(v)),
                    Value::Color(v) => AnyLive::Color(RLive::new(v)),
                },
            })
        })
    }

    /// Publishes `value`; true when it changed.
    #[napi(js_name = "set", ts_args_type = "value: number | [number, number] | [number, number, number, number] | Color")]
    pub fn set(&self, value_: Raw) -> napi::Result<bool> {
        Ok(match (&self.inner, value(value_.0)?) {
            (AnyLive::F32(l), Value::F32(v)) => l.set(v),
            (AnyLive::V2(l), Value::V2(v)) => l.set(v),
            (AnyLive::V4(l), Value::V4(v)) => l.set(v),
            (AnyLive::Color(l), Value::Color(v)) => l.set(v),
            _ => return Err(mismatch()),
        })
    }

    /// Lands `value` at once on bound elements, skipping any smoothing spring.
    #[napi(js_name = "snap", ts_args_type = "value: number | [number, number] | [number, number, number, number] | Color")]
    pub fn snap(&self, value_: Raw) -> napi::Result<bool> {
        Ok(match (&self.inner, value(value_.0)?) {
            (AnyLive::F32(l), Value::F32(v)) => l.snap(v),
            (AnyLive::V2(l), Value::V2(v)) => l.snap(v),
            (AnyLive::V4(l), Value::V4(v)) => l.snap(v),
            (AnyLive::Color(l), Value::Color(v)) => l.snap(v),
            _ => return Err(mismatch()),
        })
    }

    /// Moves smoothed bindings to `active`, holds `hold` seconds, then moves to `rest`.
    #[napi(js_name = "pulse", ts_args_type = "active: any, rest: any, hold: number")]
    pub fn pulse(&self, active: Raw, rest: Raw, hold: f64) -> napi::Result<bool> {
        let hold = std::time::Duration::from_secs_f64(hold.max(0.0));
        Ok(match (&self.inner, value(active.0)?, value(rest.0)?) {
            (AnyLive::F32(l), Value::F32(a), Value::F32(r)) => l.pulse(a, r, hold),
            (AnyLive::V2(l), Value::V2(a), Value::V2(r)) => l.pulse(a, r, hold),
            (AnyLive::V4(l), Value::V4(a), Value::V4(r)) => l.pulse(a, r, hold),
            (AnyLive::Color(l), Value::Color(a), Value::Color(r)) => l.pulse(a, r, hold),
            _ => return Err(mismatch()),
        })
    }

    #[napi(js_name = "get", ts_return_type = "any")]
    pub fn get(&self) -> napi::Result<Raw> {
        Ok(Raw(match &self.inner {
            AnyLive::F32(l) => l.get().to_js()?,
            AnyLive::V2(l) => l.get().to_js()?,
            AnyLive::V4(l) => l.get().to_js()?,
            AnyLive::Color(l) => l.get().to_js()?,
        }))
    }

    /// A binding that follows this value on an interruptible spring.
    #[napi(js_name = "smooth", ts_args_type = "spring: Spring", ts_return_type = "Binding")]
    pub fn smooth(&self, spring: Raw) -> napi::Result<Binding> {
        let spring = rune::Spring::from_js(spring.0)?;
        Ok(Binding {
            inner: Some(match &self.inner {
                AnyLive::F32(l) => AnyBinding::F32(l.smooth(spring)),
                AnyLive::V2(l) => AnyBinding::V2(l.smooth(spring)),
                AnyLive::V4(l) => AnyBinding::V4(l.smooth(spring)),
                AnyLive::Color(l) => AnyBinding::Color(l.smooth(spring)),
            }),
        })
    }

    #[napi(js_name = "clone", ts_return_type = "Live")]
    pub fn clone_js(&self) -> Live {
        Live { inner: self.inner.clone() }
    }
}

/// How an element follows a `Live`: directly, or smoothed by a spring.
#[napi(js_name = "Binding")]
pub struct Binding {
    inner: Option<AnyBinding>,
}

#[napi]
impl Binding {
    /// Uses `leave` when returning to a pulse's resting value or moving downward.
    #[napi(js_name = "rest", ts_args_type = "leave: Spring", ts_return_type = "Binding")]
    pub fn rest(&mut self, leave: Raw) -> napi::Result<Binding> {
        let leave = rune::Spring::from_js(leave.0)?;
        let b = self.inner.take().ok_or_else(|| conv::err("this Binding was already used"))?;
        Ok(Binding {
            inner: Some(match b {
                AnyBinding::F32(b) => AnyBinding::F32(b.rest(leave)),
                AnyBinding::V2(b) => AnyBinding::V2(b.rest(leave)),
                AnyBinding::V4(b) => AnyBinding::V4(b.rest(leave)),
                AnyBinding::Color(b) => AnyBinding::Color(b.rest(leave)),
            }),
        })
    }
}

/// A value tweening linearly from one value to another over a duration.
#[napi(js_name = "Tween")]
pub struct Tween {
    inner: AnyTween,
}

#[derive(Clone)]
enum AnyTween {
    F32(RTween<f32>),
    V2(RTween<[f32; 2]>),
    V4(RTween<[f32; 4]>),
    Color(RTween<Color>),
}

#[napi]
impl Tween {
    /// From `from` to `to` over `duration` seconds.
    #[napi(js_name = "linear", ts_args_type = "from: any, to: any, duration: number", ts_return_type = "Tween")]
    pub fn linear(from: Raw, to: Raw, duration: f64) -> napi::Result<Tween> {
        let d = std::time::Duration::from_secs_f64(duration.max(0.0));
        Ok(Tween {
            inner: match (value(from.0)?, value(to.0)?) {
                (Value::F32(a), Value::F32(b)) => AnyTween::F32(RTween::linear(a, b, d)),
                (Value::V2(a), Value::V2(b)) => AnyTween::V2(RTween::linear(a, b, d)),
                (Value::V4(a), Value::V4(b)) => AnyTween::V4(RTween::linear(a, b, d)),
                (Value::Color(a), Value::Color(b)) => AnyTween::Color(RTween::linear(a, b, d)),
                _ => return Err(mismatch()),
            },
        })
    }
}

/// Text other code changes without re-running the view (`El::live_text`).
#[napi(js_name = "LiveText")]
pub struct LiveText {
    inner: RLiveText,
}

#[napi]
impl LiveText {
    #[napi(js_name = "new", ts_return_type = "LiveText")]
    pub fn new(text: String) -> LiveText {
        LiveText { inner: RLiveText::new(text) }
    }
    #[napi(js_name = "get")]
    pub fn get(&self) -> String {
        self.inner.get().to_string()
    }
    /// Publishes `text`; true when it changed.
    #[napi(js_name = "set")]
    pub fn set(&self, text: String) -> bool {
        self.inner.set(text)
    }
    #[napi(js_name = "clone", ts_return_type = "LiveText")]
    pub fn clone_js(&self) -> LiveText {
        LiveText { inner: self.inner.clone() }
    }
}

/// A `Live`, `Binding` or `Tween` from JavaScript, as a binding of the kind `pick` selects.
fn binding<T>(v: conv::Value, pick: impl Fn(AnyBinding) -> Option<RBinding<T>>) -> conv::Result<RBinding<T>>
where
    T: rune::live::LiveValue,
{
    let any = if let Ok(live) = conv::instance_plain::<Live>(v) {
        match &live.inner {
            AnyLive::F32(l) => AnyBinding::F32(l.into()),
            AnyLive::V2(l) => AnyBinding::V2(l.into()),
            AnyLive::V4(l) => AnyBinding::V4(l.into()),
            AnyLive::Color(l) => AnyBinding::Color(l.into()),
        }
    } else if let Ok(mut b) = conv::instance_plain::<Binding>(v) {
        b.inner.take().ok_or_else(|| conv::err("this Binding was already used"))?
    } else if let Ok(t) = conv::instance_plain::<Tween>(v) {
        match &t.inner {
            AnyTween::F32(t) => AnyBinding::F32(t.into()),
            AnyTween::V2(t) => AnyBinding::V2(t.into()),
            AnyTween::V4(t) => AnyBinding::V4(t.into()),
            AnyTween::Color(t) => AnyBinding::Color(t.into()),
        }
    } else {
        return Err(conv::err("expected a Live, Binding or Tween"));
    };
    pick(any).ok_or_else(mismatch)
}

macro_rules! live_methods {
    ($($js:literal $name:ident $kind:ident;)*) => {
        #[napi]
        impl W_El {
            $(
                #[napi(js_name = $js, ts_args_type = "value: Live | Binding | Tween", ts_return_type = "this")]
                pub fn $name<'t>(&mut self, this: This<'t>, value_: Raw) -> napi::Result<This<'t>> {
                    conv::guard(move || {
                        let b = binding(value_.0, |b| if let AnyBinding::$kind(b) = b { Some(b) } else { None })?;
                        let me = self.slot.take("El")?;
                        self.slot.put(me.$name(b));
                        Ok(this)
                    })
                }
            )*
        }
    };
}

live_methods! {
    "live_opacity" live_opacity F32;
    "live_blur" live_blur F32;
    "live_scale" live_scale F32;
    "live_offset" live_offset V2;
    "live_trim" live_trim V2;
    "live_fill" live_fill Color;
    "live_rect" live_rect V4;
}

#[napi]
impl W_El {
    /// Draws `value`'s text, updated without re-running the view.
    #[napi(js_name = "live_text", ts_args_type = "value: LiveText", ts_return_type = "this")]
    pub fn live_text<'t>(&mut self, this: This<'t>, value_: Raw) -> napi::Result<This<'t>> {
        conv::guard(move || {
            let text = conv::instance_plain::<LiveText>(value_.0)?;
            let me = self.slot.take("El")?;
            self.slot.put(me.live_text(&text.inner));
            Ok(this)
        })
    }
}
