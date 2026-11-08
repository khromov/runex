//! `rune::tooling::headless_run`: what a headless run (`--snap`, `--tree`, `--script`,
//! `--video`) was asked to do, for an app to read: its script, timing and output.

use napi_derive::napi;

use crate::conv::{self, Raw, ToJs};

/// The headless run this process is rendering (`rune::tooling::HeadlessRun`). One per run,
/// shared by every window.
#[napi(js_name = "HeadlessRun")]
pub struct HeadlessRun {
    run: &'static rune::tooling::HeadlessRun,
}

/// The headless run this process is rendering, or `null` in a window. Set before the app's state
/// is created, so `init`, views and handlers can read it; a `run_windows` factory runs too early
/// to see it.
#[napi(js_name = "headless_run")]
pub fn headless_run() -> Option<HeadlessRun> {
    rune::tooling::headless_run().map(|run| HeadlessRun { run })
}

fn frame_js(f: rune::tooling::WindowFrame) -> conv::Result<conv::Value> {
    let o = conv::object();
    conv::set(o, "t", f.t.to_js()?);
    conv::set(o, "key", f.key.to_js()?);
    conv::set(o, "frame", f.frame.to_js()?);
    conv::set(o, "visible", f.visible.to_js()?);
    conv::set(o, "focused", f.focused.to_js()?);
    Ok(o)
}

#[napi]
impl HeadlessRun {
    /// The `--script` file.
    #[napi(js_name = "script")]
    pub fn script(&self) -> Option<String> {
        self.run.script().map(|p| p.to_string_lossy().into_owned())
    }
    /// The `--desktop` backdrop, when the run composites every window over it.
    #[napi(js_name = "desktop")]
    pub fn desktop(&self) -> Option<String> {
        self.run.desktop().map(|p| p.to_string_lossy().into_owned())
    }
    /// The script's `mark` events, in time order: (name, seconds).
    #[napi(js_name = "marks", ts_return_type = "[string, number][]")]
    pub fn marks(&self) -> napi::Result<Raw> {
        let marks: Vec<(String, f64)> = self.run.marks().map(|(n, t)| (n.to_owned(), t)).collect();
        Ok(Raw(marks.to_js()?))
    }
    /// The time of the first mark called `name`.
    #[napi(js_name = "mark")]
    pub fn mark(&self, name: String) -> Option<f64> {
        self.run.mark(&name)
    }
    /// The time of the script's last event (marks included), or 0 without one.
    #[napi(js_name = "script_end")]
    pub fn script_end(&self) -> f64 {
        self.run.script_end()
    }
    /// Device pixels per point (`--scale`, default 2).
    #[napi(js_name = "scale")]
    pub fn scale(&self) -> f64 {
        f64::from(self.run.scale())
    }
    /// Frames per virtual second (`--fps`, default 60).
    #[napi(js_name = "fps")]
    pub fn fps(&self) -> f64 {
        self.run.fps()
    }
    /// The rendered window's viewport in points (`--size`, or the window's own size); the whole
    /// output with `--desktop`.
    #[napi(js_name = "size", ts_return_type = "[number, number]")]
    pub fn size(&self) -> napi::Result<Raw> {
        Ok(Raw(self.run.size().to_js()?))
    }
    /// Seconds of virtual time at the first dumped frame (`--start`, marks resolved).
    #[napi(js_name = "start")]
    pub fn start(&self) -> f64 {
        self.run.start()
    }
    /// Frames written to `--video` or `--out` (0 for a `--snap` or `--tree` run).
    #[napi(js_name = "frames")]
    pub fn frames(&self) -> f64 {
        self.run.frames() as f64
    }
    /// Seconds of virtual time at the last frame the run renders.
    #[napi(js_name = "end")]
    pub fn end(&self) -> f64 {
        self.run.end()
    }
    /// A `--desktop` run's window frames so far: each window at the start, then one entry
    /// whenever one moves, resizes, shows, hides or takes keys. Empty otherwise.
    #[napi(js_name = "window_frames", ts_return_type = "WindowFrame[]")]
    pub fn window_frames(&self) -> napi::Result<Raw> {
        let frames = self.run.window_frames().into_iter().map(frame_js).collect::<conv::Result<Vec<_>>>()?;
        Ok(Raw(conv::array(frames)))
    }
    /// Each window as it stands at time `t` in a `--desktop` run, in the order the app made them.
    #[napi(js_name = "windows_at", ts_return_type = "WindowFrame[]")]
    pub fn windows_at(&self, t: f64) -> napi::Result<Raw> {
        let frames = self.run.windows_at(t).into_iter().map(frame_js).collect::<conv::Result<Vec<_>>>()?;
        Ok(Raw(conv::array(frames)))
    }
}
