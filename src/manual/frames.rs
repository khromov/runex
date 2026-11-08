//! `App::on_frame_encoded`'s reports (`rune::FrameEncoded`), and the clock their instants are
//! read on. JavaScript has no `Instant`: an instant is a number of seconds on one monotonic
//! clock, whose zero is when the addon loaded. `instant_now()` reads the same clock, so a meter
//! ported from Rust subtracts instants as Rust does.

use std::sync::OnceLock;
use std::time::Instant;

use napi_derive::napi;

use crate::conv::{self, Class, Slot};

static EPOCH: OnceLock<Instant> = OnceLock::new();

fn epoch() -> Instant {
    *EPOCH.get_or_init(Instant::now)
}

/// Seconds from the clock's zero to `at` (negative for an instant before it).
pub fn secs(at: Instant) -> f64 {
    let zero = epoch();
    match at.checked_duration_since(zero) {
        Some(d) => d.as_secs_f64(),
        None => -zero.duration_since(at).as_secs_f64(),
    }
}

/// The current instant (`Instant::now()`), in seconds on the clock `FrameEncoded`'s instants use.
#[napi(js_name = "instant_now")]
pub fn instant_now() -> f64 {
    secs(Instant::now())
}

/// One frame a window ran, as `App.on_frame_encoded` reports it (`rune::FrameEncoded`).
/// Instants are seconds on `instant_now()`'s clock.
#[napi(js_name = "FrameEncoded")]
pub struct FrameEncoded {
    slot: Slot<rune::FrameEncoded>,
}

impl Class for FrameEncoded {
    type Inner = rune::FrameEncoded;
    const NAME: &'static str = "FrameEncoded";
    fn wrap(slot: Slot<rune::FrameEncoded>) -> Self {
        FrameEncoded { slot }
    }
    fn slot(&mut self) -> &mut Slot<rune::FrameEncoded> {
        &mut self.slot
    }
}

impl FrameEncoded {
    fn get(&self) -> napi::Result<&rune::FrameEncoded> {
        self.slot.get(Self::NAME)
    }
}

#[napi]
impl FrameEncoded {
    /// For `Drawn`, when encoding finished: right after the frame's commands were submitted,
    /// before it was presented. Otherwise, when the window decided to draw nothing.
    #[napi(js_name = "at")]
    pub fn at(&self) -> napi::Result<f64> {
        Ok(secs(self.get()?.at()))
    }
    /// What the frame came to.
    #[napi(js_name = "outcome", ts_return_type = "FrameOutcome")]
    pub fn outcome(&self) -> napi::Result<String> {
        Ok(match self.get()?.outcome() {
            rune::FrameOutcome::Drawn => "Drawn",
            rune::FrameOutcome::Unchanged => "Unchanged",
            rune::FrameOutcome::Skipped => "Skipped",
            _ => "Unknown",
        }
        .to_owned())
    }
    /// The window's key, in a multi-window app or headless run; `null` for an app's one window.
    #[napi(js_name = "window")]
    pub fn window(&self) -> napi::Result<Option<String>> {
        Ok(self.get()?.window().map(str::to_owned))
    }
    /// The window's frame counter: one more for every frame it ran.
    #[napi(js_name = "seq")]
    pub fn seq(&self) -> napi::Result<f64> {
        Ok(self.get()?.seq() as f64)
    }
    /// When the display showed it, where the platform reports that (macOS); `null` otherwise.
    #[napi(js_name = "presents_at")]
    pub fn presents_at(&self) -> napi::Result<Option<f64>> {
        Ok(self.get()?.presents_at().map(secs))
    }
    /// When the frame's work began.
    #[napi(js_name = "started")]
    pub fn started(&self) -> napi::Result<Option<f64>> {
        Ok(self.get()?.started().map(secs))
    }
    /// The display's refresh rate, in hertz, where known.
    #[napi(js_name = "refresh_hz")]
    pub fn refresh_hz(&self) -> napi::Result<Option<f64>> {
        Ok(self.get()?.refresh_hz())
    }
    /// The frame's update: events, `poll`, the view, layout and paint, in milliseconds.
    #[napi(js_name = "update_ms")]
    pub fn update_ms(&self) -> napi::Result<Option<f64>> {
        Ok(self.get()?.update_ms())
    }
    /// The frame's encode: uploads, the draw and its submission, in milliseconds.
    #[napi(js_name = "encode_ms")]
    pub fn encode_ms(&self) -> napi::Result<Option<f64>> {
        Ok(self.get()?.encode_ms())
    }
}

/// `conv::owned` for a report, for `state::frame_hook`.
pub fn to_js(f: &rune::FrameEncoded) -> conv::Result<conv::Value> {
    conv::owned::<FrameEncoded>(f.clone())
}
