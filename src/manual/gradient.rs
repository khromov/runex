//! `El::linear_gradient` and `El::radial_gradient`, which take `impl AsRef<[(f32, Color)]>` (a
//! shape the generator skips): stops are `[position, color]` arrays in JavaScript.

use napi::bindgen_prelude::This;
use napi_derive::napi;
use rune::{Color, RadialRadius};

use crate::conv::{self, FromJs, Raw};
use crate::gen::rune::W_El;

/// `impl Into<RadialRadius>`: a number (a circle), `[rx, ry]` (an ellipse) or a `RadialRadius`.
fn radius(v: conv::Value) -> conv::Result<RadialRadius> {
    if conv::kind(v) == napi::sys::ValueType::napi_number {
        return Ok(f32::from_js(v)?.into());
    }
    if let Ok(r) = <[f32; 2]>::from_js(v) {
        return Ok(r.into());
    }
    RadialRadius::from_js(v).map_err(|_| conv::err("radius: a number, [rx, ry] or a RadialRadius"))
}

#[napi]
impl W_El {
    /// A linear gradient at `angle` radians (CSS convention: `0.0` is bottom-to-top, `PI / 2` is
    /// left-to-right, `PI` is top-to-bottom like `El::gradient`) with up to 8 `[position, color]`
    /// stops, painted over the fill.
    #[napi(js_name = "linear_gradient", ts_args_type = "angle: number, stops: [number, Color][]", ts_return_type = "this")]
    pub fn linear_gradient<'t>(&mut self, this: This<'t>, angle: f64, stops: Raw) -> napi::Result<Raw> {
        conv::guard(move || {
            let stops: Vec<(f32, Color)> = conv::arg(stops.0, "stops")?;
            // A shared constant stays as it is: the builder works on a copy.
            if let conv::Slot::Shared(v) = &self.slot {
                return Ok(Raw(conv::owned::<W_El>(v.clone().linear_gradient(angle as f32, stops))?));
            }
            let me = self.slot.take("El")?;
            self.slot.put(me.linear_gradient(angle as f32, stops));
            Ok(Raw(napi::JsValue::value(&this).value))
        })
    }

    /// A radial gradient from `center` (normalized element coordinates) out to `radius` points (a
    /// number, or `[rx, ry]` for an ellipse) with up to 8 `[position, color]` stops, over the fill.
    #[napi(js_name = "radial_gradient", ts_args_type = "center: [number, number], radius: number | [number, number] | RadialRadius, stops: [number, Color][]", ts_return_type = "this")]
    pub fn radial_gradient<'t>(&mut self, this: This<'t>, center: Raw, radius_: Raw, stops: Raw) -> napi::Result<Raw> {
        conv::guard(move || {
            let center: [f32; 2] = conv::arg(center.0, "center")?;
            let radius = radius(radius_.0)?;
            let stops: Vec<(f32, Color)> = conv::arg(stops.0, "stops")?;
            if let conv::Slot::Shared(v) = &self.slot {
                return Ok(Raw(conv::owned::<W_El>(v.clone().radial_gradient(center, radius, stops))?));
            }
            let me = self.slot.take("El")?;
            self.slot.put(me.radial_gradient(center, radius, stops));
            Ok(Raw(napi::JsValue::value(&this).value))
        })
    }
}
