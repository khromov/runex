//! runex: Node.js and Bun bindings for Rune. See README.md.
//!
//! `gen` is generated from Rune's rustdoc JSON by tools/bindgen; the rest is written by hand:
//! the JavaScript bridge (`js`, `conv`), the state type (`state`) and apps (`app`).
#![allow(clippy::new_without_default, clippy::too_many_arguments)]

mod app;
mod conv;
mod gen;
mod idle;
mod js;
mod manual;
mod perf;
mod state;
mod util;

/// Registers the TypeScript class whose instances stand for record `name` (`ts/gen/types.ts`).
#[napi_derive::napi(js_name = "__register_record", skip_typescript)]
pub fn register_record(name: String, ctor: conv::Raw) {
    conv::records::register(&name, ctor.0);
}

/// The performance overlay windows get unless they choose their own (`--perf`, `RUNEX_PERF`):
/// `"overlay"`, `"log"`, `"overlay,log"`, or `""` for off.
#[napi_derive::napi(js_name = "set_perf_default")]
pub fn set_perf_default(mode: String) {
    perf::set_default(perf::Mode::parse(&mode));
}

/// Whether apps and windows created from now on are standard titled windows unless they choose
/// their own frame (`--titlebar`, `RUNEX_TITLEBAR=native`). False keeps Rune's default.
#[napi_derive::napi(js_name = "set_titlebar_default")]
pub fn set_titlebar_default(native: bool) {
    app::set_titlebar_default(native);
}
