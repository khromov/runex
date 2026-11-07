//! Tuple structs the generator binds as classes without their constructor or field: Rust's
//! `Rgb([r, g, b])` is `new Rgb([r, g, b])` in JavaScript, and its `.0` is `._0` (an index-like
//! name such as `[0]` crashes Bun on a Node-API object).

use napi_derive::napi;

use crate::conv::{self, Raw, Slot, ToJs};
use crate::gen::fx::W_fx_Rgb;

#[napi]
impl W_fx_Rgb {
    /// `Rgb([r, g, b])`: linear-light RGB.
    #[napi(constructor, ts_args_type = "rgb: [number, number, number]")]
    pub fn new(rgb: Raw) -> napi::Result<W_fx_Rgb> {
        let rgb: [f32; 3] = conv::arg(rgb.0, "rgb")?;
        Ok(W_fx_Rgb { slot: Slot::Owned(rune_fx::Rgb(rgb)) })
    }

    /// `rgb.0`: the linear-light channels.
    #[napi(getter, js_name = "_0", ts_return_type = "[number, number, number]")]
    pub fn channels(&self) -> napi::Result<Raw> {
        Ok(Raw(self.slot.get("Rgb")?.0.to_js()?))
    }
}
