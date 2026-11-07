//! The performance overlay (`--perf`, `RUNEX_PERF`, `App.perf()`): frame rate, timings and where
//! each frame's time went, drawn in the window's top-right corner, logged once a second, and/or
//! handed to a JavaScript callback once a second.
//!
//! Everything is measured and aggregated in Rust, and nothing crosses into JavaScript per frame:
//!
//! - Rune's `App::on_frame_encoded` reports each frame: drawn, unchanged or skipped, when, its
//!   update time (events, `poll`, the view, layout, paint) and encode time (uploads, the draw's
//!   submission, a compositor);
//! - `App::on_frame_drawn` gives the surface's counts (presents, skips, pacing);
//! - `js::call_with` times every call from Rust into JavaScript (the view, handlers, `poll`, a
//!   compositor's plan), and `conv::guard` times the binding calls JavaScript makes back into
//!   Rust while it runs (building elements, conversions). A drawn frame's work (update + encode)
//!   then splits into **Rune** (Rust: layout, motion, paint, encode), **bindings** (calls from
//!   JavaScript into Rust and the Rune work they do) and **JS** (the TypeScript itself);
//! - `state::view` times the view call alone; `Pump::tick` times each turn of Rune's loop.
//!
//! The overlay draws through `LiveText` and `Live` values, which repaint without re-running the
//! app's view or calling JavaScript. It publishes at most four times a second, and only after the
//! app drew frames of its own: its own repaint is one frame, which never triggers another, so a
//! still window rests. A stats callback (`App.perf(mode, f)`) gets one object a second.
//!
//! The panel never gets in the app's way. Its numbers are inert: presses, hover, the wheel and
//! the cursor go to the app beneath them. Only its two buttons take the pointer: `?` (explain
//! mode) and `−`/`+` (fold). In explain mode the panel is a modal: a press on a number opens what
//! it measures beside the panel (under the number in a narrow window, at the top in a short one),
//! and the app gets no presses or hover until a click outside, Esc or `?` leaves the mode. A
//! window under about twice the panel's size starts folded to the headline. Each press on the
//! panel re-runs the view once; the refreshes never do, and a resize only when it changes what the
//! overlay shows: across the folding size, or where an open explanation goes.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use rune::{Align, Color, Cx, El, FrameEncoded, FrameOutcome, Live, LiveText, ScrollSpec, Side, SurfaceStats, TextStyle, Tx};

use crate::state::JsState;

/// Where the numbers go.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mode {
    pub overlay: bool,
    pub log: bool,
}

impl Mode {
    /// `"1"`, `"true"`, `"on"` or `"overlay"`: the overlay; `"log"`: stderr; `"overlay,log"` or
    /// `"all"`: both; `"none"`, `"0"`, `""`: neither (a stats callback alone).
    pub fn parse(s: &str) -> Mode {
        let mut mode = Mode::default();
        for part in s.split([',', '+', ' ']).map(str::trim).filter(|p| !p.is_empty()) {
            match part.to_ascii_lowercase().as_str() {
                "1" | "true" | "on" | "yes" | "overlay" | "hud" => mode.overlay = true,
                "log" | "stderr" | "console" => mode.log = true,
                "all" | "both" => mode = Mode { overlay: true, log: true },
                _ => {}
            }
        }
        mode
    }

    pub fn any(self) -> bool {
        self.overlay || self.log
    }
}

/// The window averages cover, and the stats callback's and log's period.
const WINDOW: Duration = Duration::from_secs(1);
/// Gaps longer than this between drawn frames are rests, not frame times.
const REST: f64 = 250.0;
/// The overlay's refresh, at most.
const PUBLISH: Duration = Duration::from_millis(250);
const BARS: usize = 60;
/// The panel's content width in points: the bars and the graph are this wide.
const W: f32 = 216.0;
/// A pressable block's inset, each side: its hover and selection highlight reach past the content.
const INSET: f32 = 3.0;
/// The panel's padding, and its width with the content, the insets and the padding.
const PAD: f32 = 5.0;
const PANEL_W: f32 = W + 2.0 * INSET + 2.0 * PAD;
/// About the unfolded panel's height. A window narrower than twice `PANEL_W` or shorter than
/// twice this starts folded.
const PANEL_H: f32 = 230.0;
/// The space between the panel and the window's edges.
const EDGE: f32 = 6.0;
/// A button's side: at least 20 points to hit.
const BUTTON: f32 = 20.0;
/// The room the buttons take in the panel's top-right corner.
const BUTTONS_W: f32 = 2.0 * BUTTON + 4.0 + 4.0;
/// An explanation's width beside the panel; in a window with no room beside the panel it may be
/// as wide as `EXPLAIN_WIDE` (less in a narrower window) to take fewer lines. Then its gap to the
/// panel, and the margin Rune keeps anchored overlays inside the window.
const EXPLAIN_W: f32 = 220.0;
const EXPLAIN_WIDE: f32 = 300.0;
const EXPLAIN_GAP: f32 = 6.0;
const MARGIN: f32 = 8.0;
/// Where an explanation at the top starts: under the panel's buttons, which stay in view, and
/// clear of the window's own buttons where its titlebar draws over the content (macOS).
const EXPLAIN_TOP: f32 = EDGE + PAD + BUTTON + 2.0;
/// A window at least this tall has room for any explanation beside or under its number; a
/// shorter one shows it at the top (`EXPLAIN_TOP`), as tall as the window allows. Beside the
/// panel the tallest is 166 points (on macOS). Under (or over) its number, one is at most
/// `UNDER_H` tall: in a window `TALL` or taller each number has at least 167 points on one side
/// (its text scrolls past that, which none needs on macOS: the tallest is 142).
const TALL: f32 = 360.0;
const UNDER_H: f32 = 160.0;
/// How far the edge of a scrolled box fades while more is hidden under it.
const FADE: f32 = 14.0;
const GRAPH_W: f32 = W;
const GRAPH_H: f32 = 26.0;
/// The graph's full heights, in ms: the smallest that holds the slowest recent frame with some
/// room is used.
const SCALES: [f64; 11] = [1.0, 2.0, 4.0, 8.0, 12.0, 20.0, 33.4, 50.0, 100.0, 250.0, 1000.0];
/// One 60 Hz frame: the line in the graph, when the scale reaches it.
const BUDGET: f64 = 16.7;
const BAR_H: f32 = 5.0;
/// The extra space between the panel's groups.
const GROUP_GAP: f32 = 4.0;

/// Characters each number keeps: `LiveText` keeps its first text's size, so every refresh pads
/// to the same width, and monospaced digits don't jitter.
const STATUS_W: usize = 22;
const FPS_W: usize = 3;
const MS_W: usize = 5;
/// The legends' numbers: ms with two decimals under 10, one under 100.
const LEGEND_W: usize = 4;
const VIEWS_W: usize = 3;
const SCALE_W: usize = 23;
const FOOT_W: usize = 42;

/// Where a frame's work ran: the graph, the work bar and their legend use these alike.
const RUNE: &str = "#4C93F0";
const BINDINGS: &str = "#DB5C90";
const JS: &str = "#D99A0E";
/// Rune's phases: the update, the view call inside it (a tint of the update's colour), the
/// encode. Apart from the work colours under the common colour-vision deficiencies too.
const UPDATE: &str = "#6CCD83";
const VIEW: &str = "#C8F6D0";
const ENCODE: &str = "#D8ADDB";

/// The panel's own colours, all opaque: the panel draws the same over a light or a dark app,
/// and a compositor that blends in linear light (Rune Lab's) can't wash a translucent tint out.
const PANEL: &str = "#050608";
const PANEL_EDGE: &str = "#2C3038";
/// The panel's edge in explain mode, when its numbers take presses.
const PANEL_EDGE_ON: &str = "#AEB4BD";
const TEXT: &str = "#F2F4F7";
const TEXT_2: &str = "#D5D9DF";
const LABEL: &str = "#C3C8CF";
const MUTED: &str = "#B0B6BF";
const TRACK: &str = "#1B1E23";
const GRAPH_BG: &str = "#0F1115";
const LINE: &str = "#767D88";
const HOVER: &str = "#171A1F";
const OPEN: &str = "#1C2027";
const OPEN_EDGE: &str = "#8E95A0";
const BUTTON_FILL: &str = "#1B1E24";
const BUTTON_EDGE: &str = "#424852";
const BUTTON_HOVER: &str = "#2A2F37";
const BUTTON_ON: &str = "#E6E9ED";
const BUTTON_ON_INK: &str = "#0A0B0D";
const EXPLAIN_FILL: &str = "#0B0D10";
const EXPLAIN_EDGE: &str = "#4A515C";

fn hex(s: &str) -> Color {
    rune::color::hex(s).unwrap_or_default()
}

/// One drawn frame.
#[derive(Clone, Copy, Default)]
struct Drawn {
    at: Option<Instant>,
    update: f64,
    encode: f64,
    /// Time in JavaScript Rust called (views, handlers, poll, a compositor's plan), bindings
    /// included.
    js: f64,
    /// Time in binding calls from that JavaScript back into Rust.
    bindings: f64,
    /// Input (pointer, keys, wheel) arrived since the frame before: an input-driven frame.
    input: bool,
}

impl Drawn {
    fn work(&self) -> f64 {
        self.update + self.encode
    }
    /// Rune's own share: the frame's work less what ran in JavaScript (which is inside it).
    fn rune(&self) -> f64 {
        (self.work() - self.js).max(0.0)
    }
    fn pure_js(&self) -> f64 {
        (self.js - self.bindings).max(0.0)
    }
}

struct Tick {
    at: Instant,
    ms: f64,
    pumped: bool,
}

thread_local! {
    static DEFAULT: Cell<Mode> = const { Cell::new(Mode { overlay: false, log: false }) };
    static TICKS: RefCell<VecDeque<Tick>> = const { RefCell::new(VecDeque::new()) };
    static ALL: RefCell<Vec<Weak<Perf>>> = const { RefCell::new(Vec::new()) };
}

/// The mode windows that don't choose their own get (from `--perf` / `RUNEX_PERF`).
pub fn set_default(mode: Mode) {
    DEFAULT.with(|d| d.set(mode));
}

pub fn default_mode() -> Mode {
    DEFAULT.with(Cell::get)
}

/// One turn of `Pump::tick`: how long it took and whether it turned Rune's loop (or only peeked).
pub fn record_tick(at: Instant, ms: f64, pumped: bool) {
    if ALL.with(|all| all.borrow().is_empty()) {
        return;
    }
    TICKS.with(|t| {
        let mut t = t.borrow_mut();
        t.push_back(Tick { at, ms, pumped });
        while t.front().is_some_and(|f| at.duration_since(f.at) > WINDOW) {
            t.pop_front();
        }
    });
    // A window that went still shows "idle" once (one repaint), then rests.
    ALL.with(|all| {
        all.borrow_mut().retain(|w| match w.upgrade() {
            Some(p) => {
                p.settle(at);
                true
            }
            None => false,
        })
    });
}

/// Rune's loop over the last second: ticks/s, turns/s, average tick ms.
fn ticks() -> (usize, usize, f64) {
    TICKS.with(|t| {
        let t = t.borrow();
        let n = t.len();
        let turns = t.iter().filter(|t| t.pumped).count();
        let avg = if n == 0 { 0.0 } else { t.iter().map(|t| t.ms).sum::<f64>() / n as f64 };
        (n, turns, avg)
    })
}

/// What a press on the overlay explains (in explain mode): a group or one of its numbers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Topic {
    Frame,
    Work,
    Rune,
    Bindings,
    Js,
    Graph,
    Phases,
    Update,
    View,
    Encode,
    Presents,
    Loop,
}

impl Topic {
    /// The pressable block's key (a `--script` can tap it).
    fn key(self) -> &'static str {
        match self {
            Topic::Frame => "runex-perf-frame",
            Topic::Work => "runex-perf-work",
            Topic::Rune => "runex-perf-rune",
            Topic::Bindings => "runex-perf-bindings",
            Topic::Js => "runex-perf-js",
            Topic::Graph => "runex-perf-history",
            Topic::Phases => "runex-perf-phases",
            Topic::Update => "runex-perf-update",
            Topic::View => "runex-perf-view",
            Topic::Encode => "runex-perf-encode",
            Topic::Presents => "runex-perf-presents",
            Topic::Loop => "runex-perf-loop",
        }
    }

    /// What its explanation sits beside: the block itself, or a legend entry's whole row, so an
    /// explanation beside the panel never covers it.
    fn anchor(self) -> &'static str {
        match self {
            Topic::Rune | Topic::Bindings | Topic::Js => "runex-perf-work-legend",
            Topic::Update | Topic::View | Topic::Encode => "runex-perf-phase-legend",
            _ => self.key(),
        }
    }

    /// The legend's label, and the explanation's title.
    fn name(self) -> &'static str {
        match self {
            Topic::Frame => "frame rate",
            Topic::Work => "work per frame",
            Topic::Rune => "rune",
            Topic::Bindings => "bindings",
            Topic::Js => "js",
            Topic::Graph => "last 60 frames",
            Topic::Phases => "phases",
            Topic::Update => "update",
            Topic::View => "view",
            Topic::Encode => "encode",
            Topic::Presents => "presents, input, skipped",
            Topic::Loop => "event loop",
        }
    }

    fn color(self) -> Option<&'static str> {
        match self {
            Topic::Rune => Some(RUNE),
            Topic::Bindings => Some(BINDINGS),
            Topic::Js => Some(JS),
            Topic::Update => Some(UPDATE),
            Topic::View => Some(VIEW),
            Topic::Encode => Some(ENCODE),
            _ => None,
        }
    }

    /// What it measures; the heading for when to look at it; what a high value means.
    fn explain(self) -> (&'static str, &'static str, &'static str) {
        const HIGH: &str = "When high:";
        match self {
            Topic::Frame => (
                "Frames this window drew in the last second, and the frame interval, the time between two drawn frames: average, 95th percentile (p95) and worst. Pauses over 250\u{a0}ms are rests and left out.",
                "When frames drop:",
                "Intervals longer than the display's refresh (16.7\u{a0}ms at 60\u{a0}Hz) are dropped frames: WORK shows where the time went. Long intervals with little work only mean the app drew less often.",
            ),
            Topic::Work => (
                "Time making each drawn frame, Rune's update plus its encode, averaged over the last second (max: the slowest frame). The bar splits it by where it ran.",
                HIGH,
                "Over 16.7\u{a0}ms a 60\u{a0}Hz display drops frames. The longest colour says where to look: Rune, the bindings or your JavaScript.",
            ),
            Topic::Rune => (
                "Rust inside Rune: events, layout, motion, paint and encoding the frame's draw for the GPU.",
                HIGH,
                "Big or deep element trees, a lot of text, many effects (blur, shadows) or large images.",
            ),
            Topic::Bindings => (
                "Calls your JavaScript made into Rust while it ran: creating elements, builder methods, conversions, and the Rune work they did.",
                HIGH,
                "The view builds many elements on every frame. Build fewer, or move the values that change into Live values.",
            ),
            Topic::Js => (
                "Your TypeScript itself: views, handlers, poll and a compositor's plan, without the binding calls.",
                HIGH,
                "Heavy work in the view or a handler. Do it once when the state changes, not on every frame.",
            ),
            Topic::Graph => (
                "Each bar is one drawn frame's work, stacked rune, bindings, js. The scale fits the slowest recent frame; the caption gives its top, and the 16.7\u{a0}ms line (one 60\u{a0}Hz frame) shows once the scale reaches it.",
                HIGH,
                "Bars over the line took longer than a 60\u{a0}Hz frame. A lone spike is one slow frame: a big rebuild, garbage collection.",
            ),
            Topic::Phases => (
                "The same work per frame, split by Rune's two phases: the update (events, poll, the view, layout, paint), then the encode (sending the draw to the GPU). The header counts view calls a second and the time each call takes.",
                HIGH,
                "The bigger phase is where to look: update for app logic and layout, encode for drawing.",
            ),
            Topic::Update => (
                "Rune's first phase: input events, poll, the view when state changed, layout and paint.",
                HIGH,
                "A heavy view, deep layout or a lot of text to shape.",
            ),
            Topic::View => (
                "Your JavaScript view call, binding calls included, per frame: all its calls in the last second over the frames drawn. It runs inside update, so its light part of the bar sits in update's. The header gives the calls a second and the time each.",
                HIGH,
                "The view does too much, or re-runs on every frame because state changes on every frame: animate with Live values instead.",
            ),
            Topic::Encode => (
                "Uploading and submitting the frame's draw to the GPU, or a compositor's passes.",
                HIGH,
                "Too many draw items or heavy effects: blurs, shadows, large images, many layers.",
            ),
            Topic::Presents => (
                "Per second: frames the screen showed (-- until the platform reports them), drawn frames that followed input (pointer moves, clicks, keys: hovering redraws a window), and frames skipped (covered, minimised, no drawable in time).",
                "Watch for:",
                "Input frames on a still app are hover redraws. Skipped frames while the window shows mean the GPU or the main thread fell behind.",
            ),
            Topic::Loop => (
                "Rune's event loop as JavaScript turns it, for the whole process (every window shares it): time per tick (frames included), ticks a second, the share of the main thread they take, and the process's memory.",
                HIGH,
                "A high share leaves little of the thread for your other JavaScript (timers, network). Memory that keeps growing is a leak.",
            ),
        }
    }
}

/// The overlay's numbers, each kept as wide as its first text.
struct Texts {
    status: LiveText,
    fps: LiveText,
    frame: LiveText,
    p95: LiveText,
    max: LiveText,
    work: LiveText,
    work_max: LiveText,
    rune: LiveText,
    bindings: LiveText,
    js: LiveText,
    scale: LiveText,
    update: LiveText,
    /// The view's time per drawn frame (the legend, like the bar).
    view: LiveText,
    /// View calls a second, and the time each took.
    views: LiveText,
    view_call: LiveText,
    encode: LiveText,
    presents: LiveText,
    looped: LiveText,
}

impl Texts {
    /// Dashes until the first frames.
    fn new() -> Texts {
        let dash = |w: usize| LiveText::new(fit(None, w, 0));
        Texts {
            status: LiveText::new(right("waiting for frames", STATUS_W)),
            fps: dash(FPS_W),
            frame: dash(LEGEND_W),
            p95: dash(MS_W),
            max: dash(MS_W),
            work: dash(MS_W),
            work_max: dash(MS_W),
            rune: dash(LEGEND_W),
            bindings: dash(LEGEND_W),
            js: dash(LEGEND_W),
            scale: LiveText::new(right(&scale_caption(SCALES[5]), SCALE_W)),
            update: dash(LEGEND_W),
            view: dash(LEGEND_W),
            views: dash(VIEWS_W),
            view_call: dash(LEGEND_W),
            encode: dash(LEGEND_W),
            presents: LiveText::new(left(&presents_line(None, None), FOOT_W)),
            looped: LiveText::new(left(&loop_line(None), FOOT_W)),
        }
    }
}

/// What the panel looks like: rebuilt only when one of these changes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct Shape {
    /// Explain mode: the numbers take presses, and the panel is a modal.
    explain: bool,
    /// Folded to the headline.
    folded: bool,
    /// The explanation that shows, and where.
    open: Option<(Topic, Place)>,
}

/// Where an explanation goes in a window of a size: beside the panel, level with its number,
/// when there's room on the panel's left; else under the number (or over it, whichever side has
/// room); at the top, under the panel's buttons and as tall as the window allows, when the
/// window is too short for either (or too narrow for `EXPLAIN_WIDE`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Place {
    Beside,
    Under,
    /// Left of the panel when `beside`, else over it; `w` points wide.
    Top { beside: bool, w: i32 },
}

impl Place {
    /// The place in a window whose bottom-right corner is at `[x, y]`. It changes only at a few
    /// sizes (and per point of width in a window under 316 points), so a view that reads it
    /// through `Cx::layout_with` re-runs only then.
    fn of([x, y, _, _]: [f32; 4]) -> Place {
        let beside = x - EDGE - PANEL_W - EXPLAIN_GAP - MARGIN >= EXPLAIN_W;
        let w = EXPLAIN_WIDE.min(x - 2.0 * MARGIN).max(120.0).round() as i32;
        match (beside, y >= TALL) {
            (true, true) => Place::Beside,
            (false, true) if w == EXPLAIN_WIDE as i32 => Place::Under,
            (true, false) => Place::Top { beside: true, w: EXPLAIN_W as i32 },
            (false, _) => Place::Top { beside: false, w },
        }
    }

    fn width(self) -> f32 {
        match self {
            Place::Beside => EXPLAIN_W,
            Place::Under => EXPLAIN_WIDE,
            Place::Top { w, .. } => w as f32,
        }
    }
}

/// Whether a window whose bottom-right corner is at `[x, y]` is under about twice the unfolded
/// panel's size, so the panel starts folded.
fn small_window([x, y, _, _]: [f32; 4]) -> bool {
    x < 2.0 * PANEL_W || y < 2.0 * PANEL_H
}

/// A column with no width down the window, `right` points in from its right edge, from `top` to
/// `EDGE` above its bottom. It holds `child` at its top, right-aligned and at most as tall as the
/// column (when `child` has `.shrink().min_h(0.0)`), so a short window caps the child's height
/// through layout and a resize re-runs no view. Having no width, it covers nothing of the app,
/// for the pointer or accessibility.
fn column(key: &'static str, right: f32, top: f32, child: El) -> El {
    rune::col().key(key).pin(None, Some(top), Some(right), Some(EDGE)).w(0.0).items_end().child(child)
}

/// The key of an empty element pinned to the root's bottom-right corner: where it is gives the
/// window's size. It has no size, so it never covers the app (nor its accessibility).
const CORNER: &str = "runex-perf-corner";

/// One window's samples and its overlay's live values.
pub struct Perf {
    mode: Mode,
    name: RefCell<String>,
    drawn: RefCell<VecDeque<Drawn>>,
    /// The last `BARS` drawn frames, for the graph.
    recent: RefCell<VecDeque<Drawn>>,
    unchanged: RefCell<VecDeque<Instant>>,
    skipped: RefCell<VecDeque<Instant>>,
    views: RefCell<VecDeque<(Instant, f64)>>,
    surface: RefCell<Option<SurfaceStats>>,
    /// The surface's presents so far, after each drawn frame: the footer's presents a second,
    /// counted over the same second as the rest (Rune's own rate rolls over once a second).
    presents: RefCell<VecDeque<(Instant, u64)>>,
    last_drawn: Cell<Option<Instant>>,
    last_publish: Cell<Option<Instant>>,
    drawn_since_publish: Cell<u32>,
    shows_idle: Cell<bool>,
    last_report: Cell<Option<Instant>>,
    /// `rune::last_input()` at the last drawn frame.
    last_input: Cell<Option<Instant>>,
    /// A JavaScript function given the summary once a second (`App.perf(mode, f)`).
    on_stats: RefCell<Option<crate::js::JsRef>>,
    /// Explain mode is on.
    explain: Cell<bool>,
    /// The explanation that shows, in explain mode.
    open: Cell<Option<Topic>>,
    /// Folded or not, once the `−`/`+` button chose; until then the window's size decides.
    fold: Cell<Option<bool>>,
    /// Whether the last view drew the panel folded.
    folded: Cell<bool>,
    texts: Texts,
    /// The work bar: Rune, bindings, JS, left to right.
    work_bar: [Live<[f32; 4]>; 3],
    /// The phase bar: update, the view at the end of it, encode.
    phase_bar: [Live<[f32; 4]>; 3],
    /// Per graph bar: the Rune, bindings and JS segments, bottom to top.
    bars: Vec<[Live<[f32; 4]>; 3]>,
    /// The graph's 16.7 ms line: empty when the scale doesn't reach it.
    budget: Live<[f32; 4]>,
}

impl Perf {
    pub fn new(mode: Mode) -> Rc<Perf> {
        crate::js::set_timing(true);
        let perf = Rc::new(Perf {
            mode,
            name: RefCell::new(String::from("main")),
            drawn: RefCell::default(),
            recent: RefCell::default(),
            unchanged: RefCell::default(),
            skipped: RefCell::default(),
            views: RefCell::default(),
            surface: RefCell::default(),
            presents: RefCell::default(),
            last_drawn: Cell::new(None),
            last_publish: Cell::new(None),
            drawn_since_publish: Cell::new(0),
            shows_idle: Cell::new(false),
            last_report: Cell::new(None),
            last_input: Cell::new(None),
            on_stats: RefCell::new(None),
            explain: Cell::new(false),
            open: Cell::new(None),
            fold: Cell::new(None),
            folded: Cell::new(false),
            texts: Texts::new(),
            work_bar: std::array::from_fn(|_| Live::new([0.0, 0.0, 0.0, BAR_H])),
            phase_bar: std::array::from_fn(|_| Live::new([0.0, 0.0, 0.0, BAR_H])),
            bars: (0..BARS).map(|i| bar_rects(i, &Drawn::default(), SCALES[5]).map(Live::new)).collect(),
            budget: Live::new(budget_rect(SCALES[5])),
        });
        ALL.with(|all| all.borrow_mut().push(Rc::downgrade(&perf)));
        perf
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Hands the summary to `f` once a second while the window draws.
    pub fn set_on_stats(&self, f: Option<crate::js::JsRef>) {
        *self.on_stats.borrow_mut() = f;
    }

    /// A JavaScript view call took `ms`.
    pub fn view_ms(&self, ms: f64) {
        let now = Instant::now();
        let mut views = self.views.borrow_mut();
        views.push_back((now, ms));
        trim(&mut views, now, |v| v.0);
    }

    /// The surface's counts, sampled after a drawn frame.
    pub fn surface(&self, stats: Option<SurfaceStats>) {
        if let Some(st) = &stats {
            let now = Instant::now();
            let mut presents = self.presents.borrow_mut();
            presents.push_back((now, st.totals.presents));
            trim(&mut presents, now, |p| p.0);
        }
        if stats.is_some() {
            *self.surface.borrow_mut() = stats;
        }
    }

    /// Presents over the last second, from the totals sampled after each drawn frame; `None`
    /// before the platform reported any.
    fn presents_per_s(&self, now: Instant) -> Option<usize> {
        let presents = self.presents.borrow();
        let last = presents.back()?;
        if now.duration_since(last.0) > WINDOW {
            return Some(0);
        }
        let base = presents.iter().rev().find(|p| now.duration_since(p.0) >= WINDOW).or(presents.front())?;
        Some(last.1.saturating_sub(base.1) as usize)
    }

    /// `App::on_frame_encoded`.
    pub fn frame(&self, f: &FrameEncoded) {
        let now = f.at();
        // JavaScript time since the last report belongs to this frame (its update ran the view
        // and the queued handlers; its encode, a compositor's plan).
        let (js_ns, bindings_ns) = crate::js::take_timing();
        if let Some(window) = f.window() {
            if *self.name.borrow() != window {
                *self.name.borrow_mut() = window.to_owned();
            }
        }
        match f.outcome() {
            FrameOutcome::Drawn => {
                let input = rune::last_input();
                let after_input = input.is_some() && input != self.last_input.replace(input);
                let d = Drawn {
                    at: Some(now),
                    update: f.update_ms().unwrap_or(0.0),
                    encode: f.encode_ms().unwrap_or(0.0),
                    js: js_ns as f64 / 1e6,
                    bindings: bindings_ns as f64 / 1e6,
                    input: after_input,
                };
                self.last_drawn.set(Some(now));
                let mut drawn = self.drawn.borrow_mut();
                drawn.push_back(d);
                trim(&mut drawn, now, |d| d.at.unwrap_or(now));
                let mut recent = self.recent.borrow_mut();
                recent.push_back(d);
                while recent.len() > BARS {
                    recent.pop_front();
                }
                self.drawn_since_publish.set(self.drawn_since_publish.get() + 1);
            }
            FrameOutcome::Skipped => {
                let mut skipped = self.skipped.borrow_mut();
                skipped.push_back(now);
                trim(&mut skipped, now, |t| *t);
            }
            _ => {
                let mut unchanged = self.unchanged.borrow_mut();
                unchanged.push_back(now);
                trim(&mut unchanged, now, |t| *t);
            }
        }
        // The overlay's own repaint is one drawn frame: publish only after more than that, so
        // it never keeps a still window drawing.
        let due = self.last_publish.get().is_none_or(|at| now.duration_since(at) >= PUBLISH);
        if due && (self.last_publish.get().is_none() || self.drawn_since_publish.get() >= 2) {
            self.publish(now);
        }
        if f.outcome() == FrameOutcome::Drawn && self.last_report.get().is_none_or(|at| now.duration_since(at) >= WINDOW) {
            self.last_report.set(Some(now));
            self.report(now);
        }
    }

    /// Once a second: the log line and the JavaScript callback.
    fn report(&self, now: Instant) {
        if self.mode.log {
            eprintln!("{}", self.summary(now));
        }
        let f = self.on_stats.borrow().as_ref().map(crate::js::JsRef::value);
        if let Some(f) = f {
            crate::js::scope(|| {
                let stats = self.stats(now).to_js(&self.name.borrow(), self.surface.borrow().as_ref());
                // Not timed as the app's JavaScript: this is the overlay's own call.
                crate::js::untimed(|| crate::js::call(f, &[stats]));
            });
        }
    }

    /// Called every pump tick: once the window has been still for a second, show it as idle.
    fn settle(&self, now: Instant) {
        if self.shows_idle.get() || !self.mode.overlay {
            return;
        }
        if self.last_drawn.get().is_some_and(|at| now.duration_since(at) > WINDOW) {
            self.publish(now);
        }
    }

    /// A press on `topic` in explain mode: show its explanation, or close it when it's the one
    /// showing.
    fn toggle(&self, topic: Topic) {
        self.open.set(if self.open.get() == Some(topic) { None } else { Some(topic) });
    }

    /// The `?` button: explain mode on (unfolding the panel while it lasts) or off.
    fn toggle_explain(&self) {
        self.explain.set(!self.explain.get());
        self.open.set(None);
    }

    /// A click outside the panel or Esc in explain mode: back to click-through.
    fn leave_explain(&self) {
        self.explain.set(false);
        self.open.set(None);
    }

    /// The `−`/`+` button: fold or unfold, and leave explain mode.
    fn toggle_fold(&self) {
        self.fold.set(Some(!self.folded.get()));
        self.leave_explain();
    }

    fn stats(&self, now: Instant) -> Stats {
        let drawn: Vec<Drawn> = self.drawn.borrow().iter().copied().filter(|d| d.at.is_some_and(|at| now.duration_since(at) <= WINDOW)).collect();
        let mut gaps: Vec<f64> = drawn
            .windows(2)
            .filter_map(|w| Some(w[1].at?.duration_since(w[0].at?).as_secs_f64() * 1000.0))
            .filter(|g| *g < REST)
            .collect();
        gaps.sort_by(f64::total_cmp);
        let recent = |t: &Instant| now.duration_since(*t) <= WINDOW;
        let views: Vec<f64> = self.views.borrow().iter().filter(|v| recent(&v.0)).map(|v| v.1).collect();
        let mean = |f: fn(&Drawn) -> f64| avg(&drawn.iter().map(f).collect::<Vec<_>>());
        let (ticks, turns, tick_avg) = ticks();
        Stats {
            fps: drawn.len(),
            input: drawn.iter().filter(|d| d.input).count(),
            gaps: gaps.len(),
            frame_avg: avg(&gaps),
            frame_p95: percentile(&gaps, 0.95),
            frame_max: gaps.last().copied().unwrap_or(0.0),
            work: mean(Drawn::work),
            work_max: drawn.iter().map(Drawn::work).fold(0.0, f64::max),
            rune: mean(Drawn::rune),
            js: mean(Drawn::pure_js),
            bindings: mean(|d| d.bindings),
            update: mean(|d| d.update),
            encode: mean(|d| d.encode),
            view: avg(&views),
            view_total: views.iter().sum(),
            views: views.len(),
            unchanged: self.unchanged.borrow().iter().filter(|t| recent(t)).count(),
            skipped: self.skipped.borrow().iter().filter(|t| recent(t)).count(),
            ticks,
            turns,
            tick_avg,
        }
    }

    fn summary(&self, now: Instant) -> String {
        let s = self.stats(now);
        let surface = self.surface.borrow();
        let presents = surface.as_ref().map_or(String::new(), |st| format!(", {} presents/s, pacing {}", st.per_second.presents, st.pacing));
        format!(
            "runex perf [{}]: {} fps ({} after input), frame {:.1} ms (p95 {:.1}, max {:.1}); work {:.2} ms (max {:.2}) = rune {:.2} + bindings {:.2} + js {:.2}; update {:.2}, encode {:.2}, view {:.2} ms × {}/s; {} unchanged/s, {} skipped/s{presents}; loop {:.2} ms × {} ticks/s ({} turns/s, {:.0}% of the thread); {}",
            self.name.borrow(), s.fps, s.input, s.frame_avg, s.frame_p95, s.frame_max, s.work, s.work_max, s.rune, s.bindings, s.js,
            s.update, s.encode, s.view, s.views, s.unchanged, s.skipped, s.tick_avg, s.ticks, s.turns, s.busy(), memory(),
        )
    }

    fn publish(&self, now: Instant) {
        self.last_publish.set(Some(now));
        self.drawn_since_publish.set(0);
        let idle = self.last_drawn.get().is_none_or(|at| now.duration_since(at) > WINDOW);
        self.shows_idle.set(idle);
        if !self.mode.overlay {
            return;
        }
        let s = self.stats(now);
        let t = &self.texts;
        let name = self.name.borrow();
        // A long window name is cut, never the "idle" in front of it.
        let name: String = name.chars().take(if idle { STATUS_W - 7 } else { STATUS_W }).collect();
        t.status.set(right(&if idle { format!("idle · {name}") } else { name }, STATUS_W));
        // Averages over no frames are dashes, not zeros.
        let drew = |v: f64| (s.fps > 0).then_some(v);
        let gap = |v: f64| (s.gaps > 0).then_some(v);
        // The view's time per drawn frame, as the phase bar draws it.
        let view_frame = if s.fps > 0 { s.view_total / s.fps as f64 } else { 0.0 };
        t.fps.set(fit(Some(s.fps as f64), FPS_W, 0));
        t.frame.set(fit(gap(s.frame_avg), LEGEND_W, 1));
        t.p95.set(fit(gap(s.frame_p95), MS_W, 1));
        t.max.set(fit(gap(s.frame_max), MS_W, 1));
        t.work.set(fit(drew(s.work), MS_W, 2));
        t.work_max.set(fit(drew(s.work_max), MS_W, 2));
        t.rune.set(fit(drew(s.rune), LEGEND_W, 2));
        t.bindings.set(fit(drew(s.bindings), LEGEND_W, 2));
        t.js.set(fit(drew(s.js), LEGEND_W, 2));
        t.update.set(fit(drew(s.update), LEGEND_W, 2));
        t.view.set(fit(drew(view_frame), LEGEND_W, 2));
        t.encode.set(fit(drew(s.encode), LEGEND_W, 2));
        t.views.set(fit(Some(s.views as f64), VIEWS_W, 0));
        t.view_call.set(fit((s.views > 0).then_some(s.view), LEGEND_W, 2));
        t.presents.set(left(&presents_line(Some(&s), self.presents_per_s(now)), FOOT_W));
        t.looped.set(left(&loop_line(Some(&s)), FOOT_W));
        for (live, rect) in self.work_bar.iter().zip(split([s.rune, s.bindings, s.js])) {
            live.set(rect);
        }
        // The view's share of an average frame, at the end of the update's segment.
        let [update, encode] = split([s.update, s.encode]);
        let view = if s.update > 0.0 { (view_frame / s.update).min(1.0) as f32 } else { 0.0 };
        let view_w = update[2] * view;
        let view_rect = [update[0] + update[2] - view_w, 0.0, view_w, BAR_H];
        for (live, rect) in self.phase_bar.iter().zip([update, view_rect, encode]) {
            live.set(rect);
        }
        let recent = self.recent.borrow();
        let peak = recent.iter().map(Drawn::work).fold(0.0, f64::max);
        let top = graph_top(peak);
        t.scale.set(right(&scale_caption(top), SCALE_W));
        self.budget.set(budget_rect(top));
        let start = BARS - recent.len();
        for (i, bar) in self.bars.iter().enumerate() {
            let d = if i < start { Drawn::default() } else { recent[i - start] };
            for (live, rect) in bar.iter().zip(bar_rects(i, &d, top)) {
                live.set(rect);
            }
        }
    }

    /// The overlay, added to the view's root: the panel in the top-right corner and, in explain
    /// mode, the open explanation. Outside its two buttons it takes no input unless explain mode
    /// is on.
    pub fn attach(self: &Rc<Self>, root: El, cx: &Cx<JsState>) -> El {
        // The corner's place is the window's size. It is read only while it decides something,
        // and only for what it decides, so a resize re-runs the view only when that changes:
        // whether a small window folds the panel (until the `−`/`+` button chooses, and outside
        // explain mode), and where an open explanation goes. The panel's height fits a short
        // window through layout, without a read. A read of nothing keeps the corner's place at
        // hand, so a read that starts later (an explanation opening) needs no run of its own.
        cx.layout_with(CORNER, |_: [f32; 4]| ());
        let explain = self.explain.get();
        let folded = !explain && self.fold.get().unwrap_or_else(|| cx.layout_with(CORNER, small_window).unwrap_or(false));
        self.folded.set(folded);
        let open = self.open.get().filter(|_| explain).and_then(|topic| Some((topic, cx.layout_with(CORNER, Place::of)?)));
        let shape = Shape { explain, folded, open };
        let me = Rc::downgrade(self);
        let mut root = root.child(rune::el().key(CORNER).pin(None, None, Some(0.0), Some(0.0)).size(0.0, 0.0));
        if explain {
            // Explain mode is a modal: Rune makes what comes after it in the tree (the panel and
            // the explanation) the modal's, so the app gets no presses or hover, a click outside
            // or Esc leaves, and the app's focus comes back when this element goes. Focus moves
            // to it, so it says what the mode is.
            let leave = me.clone();
            root = root.child(
                rune::el()
                    .key("runex-perf-modal")
                    .pin(None, Some(0.0), Some(0.0), None)
                    .size(0.0, 0.0)
                    .no_focus_ring()
                    .modal(true, move |_: &mut JsState| {
                        if let Some(perf) = leave.upgrade() {
                            perf.leave_explain();
                        }
                    })
                    .label("runex performance overlay, explain mode: press a number to see what it measures. Esc leaves."),
            );
        }
        // Built once per shape, not per view run: everything else in it is a live value or a
        // handler that reads `Perf` itself. A change of shape lands at once: a fold that faded
        // the numbers out would keep their elements a moment, and Rune runs the view on every
        // resize step while any are leaving.
        let panel = rune::memo("runex-perf", shape, || self.panel(shape));
        let root = root.child(column("runex-perf-column", EDGE, EDGE, panel).instant_changes());
        let Some((topic, place)) = open else { return root };
        let explanation = rune::memo("runex-perf-explanation", (topic, place), || explanation(&me, topic, place));
        root.child(match place {
            // Beside the panel or over it (its title says what it explains).
            Place::Top { beside, .. } => column("runex-perf-explanation-column", if beside { EDGE + PANEL_W + EXPLAIN_GAP } else { EDGE }, EXPLAIN_TOP, explanation),
            Place::Beside | Place::Under => explanation,
        })
    }

    fn panel(self: &Rc<Self>, shape: Shape) -> El {
        let me = Rc::downgrade(self);
        let content = if shape.folded {
            self.headline()
        } else {
            // In a window too short for them the numbers scroll (in explain mode; otherwise the
            // wheel is the app's), and the edge with more under it fades.
            self.details(&me, shape).scroll(ScrollSpec { stick_bottom: false }).scroll_edge_fade(FADE).shrink().min_h(0.0)
        };
        // The numbers let the pointer through unless explain mode is on.
        let content = if shape.explain { content } else { content.inert() };
        let mut panel = rune::col()
            .key("runex-perf")
            .padding(PAD)
            .radius(8.0)
            .fill(hex(PANEL))
            .border(1.0, hex(if shape.explain { PANEL_EDGE_ON } else { PANEL_EDGE }))
            .child(content)
            .child(buttons(&me, shape).pin(None, Some(PAD), Some(PAD), None))
            .keeps_text_selection()
            .role("group")
            .label("runex performance overlay")
            .shrink()
            .min_h(0.0);
        if !shape.folded {
            panel = panel.w(PANEL_W);
        }
        if shape.explain {
            // A press between the numbers is the panel's: it changes nothing and leaves explain
            // mode on.
            panel = panel.on_press_tx(|_: &mut JsState, tx: &mut Tx| tx.live_only());
        }
        panel
    }

    /// The folded panel: the frame rate and the frame interval.
    fn headline(&self) -> El {
        let t = &self.texts;
        rune::row()
            .h(BUTTON)
            .center_y()
            .pl(INSET)
            .pr(BUTTONS_W)
            .child(live(&t.fps, MONO_L, hex(TEXT)))
            .child(unit(" fps   every "))
            .child(live(&t.frame, MONO, hex(TEXT)))
            .child(unit(" ms"))
    }

    /// The unfolded panel's groups.
    fn details(&self, me: &Weak<Perf>, shape: Shape) -> El {
        let t = &self.texts;
        let open = shape.open.map(|(topic, _)| topic);
        let block = |topic: Topic, el: El| pressable(me, open, topic, el);
        let row = || rune::row().w(W).center_y();

        // The top line sits beside the buttons, so the frame's pressable block starts under them.
        let header = rune::row()
            .w(W + 2.0 * INSET)
            .h(BUTTON)
            .pl(INSET)
            .pr(BUTTONS_W)
            .center_y()
            .justify_between()
            .child(caps("FRAME"))
            .child(live(&t.status, MONO_XS, hex(MUTED)));
        let frame = block(
            Topic::Frame,
            rune::col().child(
                rune::row()
                    .w(W)
                    .items_end()
                    .child(live(&t.fps, MONO_XL, hex(TEXT)))
                    .child(unit(" fps    every "))
                    .child(live(&t.frame, MONO_L, hex(TEXT)))
                    .child(unit(" ms"))
                    .child(rune::spacer())
                    .child(
                        rune::col()
                            .items_end()
                            .child(rune::row().center_y().gap(4.0).child(unit("p95")).child(live(&t.p95, MONO, hex(TEXT_2))))
                            .child(rune::row().center_y().gap(4.0).child(unit("max")).child(live(&t.max, MONO, hex(TEXT_2)))),
                    ),
            ),
        );

        let work = block(
            Topic::Work,
            rune::col()
                .gap(4.0)
                .child(
                    row()
                        .gap(4.0)
                        .child(caps("WORK"))
                        .child(unit("per frame"))
                        .child(rune::spacer())
                        .child(live(&t.work, MONO, hex(TEXT)))
                        .child(unit("ms   max"))
                        .child(live(&t.work_max, MONO, hex(TEXT_2))),
                )
                .child(bar(&self.work_bar, [RUNE, BINDINGS, JS])),
        );
        let work_legend = legend(me, open, [(Topic::Rune, &t.rune), (Topic::Bindings, &t.bindings), (Topic::Js, &t.js)]);

        let segments: Vec<El> = self
            .bars
            .iter()
            .flat_map(|bar| bar.iter().zip([RUNE, BINDINGS, JS]).map(|(live, color)| rune::el().absolute(0.0, 0.0).size(0.0, 0.0).fill(hex(color)).live_rect(live)))
            .collect();
        let graph = block(
            Topic::Graph,
            rune::col()
                .gap(2.0)
                .child(
                    rune::el()
                        .key("runex-perf-graph")
                        .size(GRAPH_W, GRAPH_H)
                        .fill(hex(GRAPH_BG))
                        .children(segments)
                        .child(rune::el().absolute(0.0, 0.0).size(0.0, 0.0).fill(hex(LINE)).live_rect(&self.budget)),
                )
                .child(row().justify_between().child(unit("last 60 frames")).child(live(&t.scale, MONO_XS, hex(MUTED)))),
        );

        let phases = block(
            Topic::Phases,
            rune::col()
                .gap(4.0)
                .child(
                    row()
                        .child(caps("PHASES"))
                        .child(unit("  per frame"))
                        .child(rune::spacer())
                        .child(unit("view "))
                        .child(live(&t.views, MONO, hex(TEXT_2)))
                        .child(unit("/s × "))
                        .child(live(&t.view_call, MONO, hex(TEXT_2)))
                        .child(unit(" ms each")),
                )
                .child(bar(&self.phase_bar, [UPDATE, VIEW, ENCODE])),
        );
        let phase_legend = legend(me, open, [(Topic::Update, &t.update), (Topic::View, &t.view), (Topic::Encode, &t.encode)]);

        let footer = |topic: Topic, text: &LiveText| block(topic, rune::col().child(live(text, MONO_S, hex(LABEL))));

        // The groups sit a little further apart than their lines.
        let mut details = rune::col()
            .gap(2.0)
            .child(header)
            .child(frame)
            .child(work.mt(GROUP_GAP))
            .child(work_legend)
            .child(graph)
            .child(phases.mt(GROUP_GAP))
            .child(phase_legend)
            .child(footer(Topic::Presents, &t.presents).mt(GROUP_GAP))
            .child(footer(Topic::Loop, &t.looped));
        if shape.explain {
            details = details.child(
                rune::text("Explain mode: press a number, bar or line to see what it measures. A click outside the panel, Esc or ? leaves.")
                    .key("runex-perf-hint")
                    .font(BODY)
                    .color(hex(LABEL))
                    .w(W)
                    .wrap()
                    .mx(INSET)
                    .mt(4.0),
            );
        }
        details
    }
}

const MONO_XS: TextStyle = TextStyle::new(8.5, 500.0).family(rune::Family::SystemMono).lh(10.5);
const MONO_S: TextStyle = TextStyle::new(8.5, 500.0).family(rune::Family::SystemMono).lh(11.0);
const MONO: TextStyle = TextStyle::new(9.0, 500.0).family(rune::Family::SystemMono).lh(11.0);
const MONO_L: TextStyle = TextStyle::new(12.0, 600.0).family(rune::Family::SystemMono).lh(15.0);
const MONO_XL: TextStyle = TextStyle::new(17.0, 650.0).family(rune::Family::SystemMono).lh(19.0);
const LABEL_FONT: TextStyle = TextStyle::new(8.5, 500.0).lh(11.0);
const UNIT: TextStyle = TextStyle::new(8.5, 500.0).lh(10.0);
const CAPS: TextStyle = TextStyle::new(8.0, 700.0).tracking(0.8).lh(10.5);
const BODY: TextStyle = TextStyle::new(9.0, 400.0).lh(12.0);
const BODY_BOLD: TextStyle = TextStyle::new(9.0, 650.0).lh(12.0);
const TITLE: TextStyle = TextStyle::new(10.0, 650.0).lh(13.0);
const GLYPH: TextStyle = TextStyle::new(12.0, 650.0).lh(14.0);

/// A `LiveText` number in a box as wide as its text. The element's own text only sizes the box
/// (every value is padded to that width) and stays the same, so a rebuild changes nothing.
fn live(text: &LiveText, font: TextStyle, color: Color) -> El {
    rune::text("0".repeat(text.get().chars().count())).font(font).color(color).live_text(text)
}

fn caps(label: &'static str) -> El {
    rune::text(label).font(CAPS).color(hex(MUTED))
}

fn unit(label: &'static str) -> El {
    rune::text(label).font(UNIT).color(hex(MUTED))
}

fn swatch(color: &str) -> El {
    rune::el().size(6.0, 6.0).radius(1.5).fill(hex(color))
}

/// The panel's two buttons, the only parts of it that take the pointer outside explain mode:
/// `?` turns explain mode on and off, `−`/`+` folds the panel to the headline and back.
fn buttons(perf: &Weak<Perf>, shape: Shape) -> El {
    let explain = perf.clone();
    let fold = perf.clone();
    rune::row()
        .gap(4.0)
        .child(
            button(if shape.explain { "stop explaining the numbers" } else { "explain the numbers" }, "?", shape.explain, move || {
                if let Some(perf) = explain.upgrade() {
                    perf.toggle_explain();
                }
            })
            .key("runex-perf-explain"),
        )
        .child(
            button(if shape.folded { "show the performance details" } else { "hide the performance details" }, if shape.folded { "+" } else { "−" }, false, move || {
                if let Some(perf) = fold.upgrade() {
                    perf.toggle_fold();
                }
            })
            .key("runex-perf-collapse"),
        )
}

fn button(label: &'static str, glyph: &'static str, on: bool, f: impl Fn() + 'static) -> El {
    rune::el()
        .size(BUTTON, BUTTON)
        .center()
        .radius(5.0)
        .fill(hex(if on { BUTTON_ON } else { BUTTON_FILL }))
        .border(1.0, hex(if on { BUTTON_ON } else { BUTTON_EDGE }))
        .hover(if on { Color::default() } else { hex(BUTTON_HOVER) })
        .cursor(rune::Cursor::Pointer)
        .child(rune::text(glyph).font(GLYPH).color(hex(if on { BUTTON_ON_INK } else { TEXT })))
        .on_press_tx(move |_: &mut JsState, _: &mut Tx| f())
        .role("button")
        .label(label)
}

/// A group or a number a press explains in explain mode: it lights under the pointer, and is
/// outlined while its explanation shows.
fn pressable(perf: &Weak<Perf>, open: Option<Topic>, topic: Topic, el: El) -> El {
    let perf = perf.clone();
    let el = el
        .key(topic.key())
        .px(INSET)
        .py(2.0)
        .radius(4.0)
        .cursor(rune::Cursor::Pointer)
        .hover(hex(HOVER))
        .on_press_tx(move |_: &mut JsState, _: &mut Tx| {
            if let Some(perf) = perf.upgrade() {
                perf.toggle(topic);
            }
        })
        .label(topic.name());
    if open == Some(topic) { el.fill(hex(OPEN)).border(1.0, hex(OPEN_EDGE)) } else { el }
}

/// A bar's three segments over a faint track, each a live rect `split` places.
fn bar(segments: &[Live<[f32; 4]>; 3], colors: [&str; 3]) -> El {
    rune::el()
        .size(W, BAR_H)
        .radius(1.5)
        .fill(hex(TRACK))
        .children(segments.iter().zip(colors).map(|(live, color)| rune::el().absolute(0.0, 0.0).size(0.0, 0.0).fill(hex(color)).live_rect(live)))
}

/// Three numbers under a bar, in its colours, each pressable: the value right after its label,
/// the room between the entries.
fn legend(perf: &Weak<Perf>, open: Option<Topic>, items: [(Topic, &LiveText); 3]) -> El {
    let mut row = rune::row().key(items[0].0.anchor()).w(W + 2.0 * INSET).center_y().justify_between();
    for (topic, value) in items {
        let entry = rune::row()
            .center_y()
            .gap(3.0)
            .child(swatch(topic.color().unwrap_or(RUNE)))
            .child(rune::text(topic.name()).font(LABEL_FONT).color(hex(LABEL)))
            .child(live(value, MONO_S, hex(TEXT)));
        row = row.child(pressable(perf, open, topic, entry));
    }
    row
}

/// What `topic` measures and what a high value means, where `place` says, inside the window; if
/// the window is still too short for it, its text scrolls and the edge with more under it fades.
/// A press closes it.
fn explanation(perf: &Weak<Perf>, topic: Topic, place: Place) -> El {
    let (what, when, high) = topic.explain();
    let w = place.width();
    let text_w = w - 2.0 * 8.0;
    let mut title = rune::row().w(text_w).center_y().gap(5.0);
    if let Some(color) = topic.color() {
        title = title.child(swatch(color));
    }
    let title = title.child(rune::text(topic.name()).font(TITLE).color(hex(TEXT))).child(rune::spacer()).child(unit("close ×"));
    let body = rune::col()
        .gap(3.0)
        .child(rune::text(what).font(BODY).color(hex(TEXT_2)).w(text_w).wrap())
        .child(rune::el().h(2.0))
        .child(rune::text(when).font(BODY_BOLD).color(hex(TEXT)))
        .child(rune::text(high).font(BODY).color(hex(TEXT_2)).w(text_w).wrap())
        .scroll(ScrollSpec { stick_bottom: false })
        .scroll_edge_fade(FADE)
        .shrink()
        .min_h(0.0);
    let perf = perf.clone();
    let el = rune::col()
        .key("runex-perf-explanation")
        .w(w)
        .padding(8.0)
        .gap(6.0)
        .radius(8.0)
        .fill(hex(EXPLAIN_FILL))
        .border(1.0, hex(EXPLAIN_EDGE))
        .shadow(4.0, 16.0, Color { r: 0.0, g: 0.0, b: 0.0, a: 0.35 })
        .cursor(rune::Cursor::Pointer)
        .on_press_tx(move |_: &mut JsState, _: &mut Tx| {
            if let Some(perf) = perf.upgrade() {
                perf.open.set(None);
            }
        })
        .child(title)
        .child(body)
        .label(topic.name());
    match place {
        // The anchor's left edge is the panel's padding in from the panel's.
        Place::Beside => el.anchored(topic.anchor(), Side::Left, Align::Start, EXPLAIN_GAP + PAD + 1.0),
        // Not `anchored_fit`: Rune runs the view on every resize step while one shows.
        Place::Under => el.max_h(UNDER_H).anchored(topic.anchor(), Side::Bottom, Align::End, 4.0),
        // In a `column`.
        Place::Top { .. } => el.shrink().min_h(0.0),
    }
}

struct Stats {
    fps: usize,
    /// Drawn frames that followed input.
    input: usize,
    /// Frame times (gaps between drawn frames, rests left out) the averages cover.
    gaps: usize,
    frame_avg: f64,
    frame_p95: f64,
    frame_max: f64,
    work: f64,
    work_max: f64,
    rune: f64,
    js: f64,
    bindings: f64,
    update: f64,
    encode: f64,
    view: f64,
    /// All the view calls' time over the window.
    view_total: f64,
    views: usize,
    unchanged: usize,
    skipped: usize,
    ticks: usize,
    turns: usize,
    tick_avg: f64,
}

impl Stats {
    /// The share of the main thread spent turning Rune's loop (frames included), in percent.
    fn busy(&self) -> f64 {
        (self.tick_avg * self.ticks as f64 / 10.0).min(100.0)
    }

    /// The once-a-second object a stats callback gets (`PerfStats` in ts/perf.ts).
    fn to_js(&self, window: &str, surface: Option<&SurfaceStats>) -> napi::sys::napi_value {
        use crate::conv::{object, set, ToJs};
        let o = object();
        let num = |v: f64| v.to_js().unwrap_or_else(|_| crate::js::undefined());
        set(o, "window", window.to_js().unwrap_or_else(|_| crate::js::undefined()));
        set(o, "fps", num(self.fps as f64));
        set(o, "input_frames_per_s", num(self.input as f64));
        set(o, "frame_ms", num(self.frame_avg));
        set(o, "frame_p95_ms", num(self.frame_p95));
        set(o, "frame_max_ms", num(self.frame_max));
        set(o, "work_ms", num(self.work));
        set(o, "work_max_ms", num(self.work_max));
        set(o, "rune_ms", num(self.rune));
        set(o, "bindings_ms", num(self.bindings));
        set(o, "js_ms", num(self.js));
        set(o, "update_ms", num(self.update));
        set(o, "encode_ms", num(self.encode));
        set(o, "view_ms", num(self.view));
        set(o, "views_per_s", num(self.views as f64));
        set(o, "unchanged_per_s", num(self.unchanged as f64));
        set(o, "skipped_per_s", num(self.skipped as f64));
        set(o, "presents_per_s", surface.map_or_else(crate::conv::null, |s| num(s.per_second.presents as f64)));
        set(o, "pacing", surface.map_or_else(crate::conv::null, |s| s.pacing.to_string().to_js().unwrap_or_else(|_| crate::js::undefined())));
        set(o, "loop_ms", num(self.tick_avg));
        set(o, "ticks_per_s", num(self.ticks as f64));
        set(o, "turns_per_s", num(self.turns as f64));
        set(o, "loop_busy_pct", num(self.busy()));
        set(o, "memory_mb", procwatch::snapshot().map_or_else(crate::conv::null, |s| num((s.footprint >> 20) as f64)));
        o
    }
}

fn trim<T>(q: &mut VecDeque<T>, now: Instant, at: impl Fn(&T) -> Instant) {
    while q.front().is_some_and(|f| now.duration_since(at(f)) > WINDOW * 2) {
        q.pop_front();
    }
}

fn avg(v: &[f64]) -> f64 {
    if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

/// `v` right-aligned in `w` characters, with as many of `decimals` as fit; dashes for none.
fn fit(v: Option<f64>, w: usize, decimals: usize) -> String {
    let Some(v) = v.filter(|v| v.is_finite()) else { return right("--", w) };
    for d in (0..=decimals).rev() {
        let s = format!("{v:.d$}");
        if s.chars().count() <= w {
            return right(&s, w);
        }
    }
    right(&"9".repeat(w), w)
}

/// `s` padded on the left to `w` characters (cut from the left past it).
fn right(s: &str, w: usize) -> String {
    let n = s.chars().count();
    if n >= w { s.chars().skip(n - w).collect() } else { format!("{}{s}", " ".repeat(w - n)) }
}

/// `s` padded on the right to `w` characters (cut past it).
fn left(s: &str, w: usize) -> String {
    let mut s: String = s.chars().take(w).collect();
    while s.chars().count() < w {
        s.push(' ');
    }
    s
}

/// The footer's first line: presented, input-driven and skipped frames a second, always in that
/// order (presents are dashes until the platform reports them). The first count is left-aligned
/// in its three characters, so the line starts where the loop line under it does.
fn presents_line(s: Option<&Stats>, presents: Option<usize>) -> String {
    let n = |v: Option<usize>| fit(v.map(|v| v as f64), 3, 0);
    format!("{} presents {} input {} skipped/s", left(n(presents).trim_start(), 3), n(s.map(|s| s.input)), n(s.map(|s| s.skipped)))
}

/// The footer's second line: the loop's tick time, ticks a second, share of the thread, memory.
fn loop_line(s: Option<&Stats>) -> String {
    format!(
        "loop {} ms ×{}/s {}% busy  {}",
        fit(s.map(|s| s.tick_avg), 4, 1),
        fit(s.map(|s| s.ticks as f64), 3, 0),
        fit(s.map(Stats::busy), 3, 0),
        if s.is_some() { memory() } else { String::new() },
    )
}

fn memory() -> String {
    match procwatch::snapshot() {
        Some(s) => format!("{} MB", s.footprint >> 20),
        None => String::new(),
    }
}

/// A 100% bar: each value's share of `W`, left to right, a point apart.
fn split<const N: usize>(values: [f64; N]) -> [[f32; 4]; N] {
    let values = values.map(|v| if v.is_finite() { v.max(0.0) } else { 0.0 });
    let total: f64 = values.iter().sum();
    let last = values.iter().rposition(|v| *v > 0.0);
    let mut x = 0.0;
    let mut i = 0;
    values.map(|v| {
        let w = if total > 0.0 { (v / total) as f32 * W } else { 0.0 };
        let gap = if Some(i) == last || w <= 2.0 { 0.0 } else { 1.0 };
        let rect = [x, 0.0, w - gap, BAR_H];
        x += w;
        i += 1;
        rect
    })
}

/// The graph's full height in ms: the first scale with room over the slowest recent frame.
fn graph_top(peak: f64) -> f64 {
    SCALES.iter().copied().find(|s| *s >= peak * 1.15).unwrap_or(SCALES[SCALES.len() - 1])
}

/// The graph's caption: its top, and the 16.7 ms line when the scale reaches it.
fn scale_caption(top: f64) -> String {
    let line = if top >= BUDGET { "── 16.7\u{a0}ms  " } else { "" };
    format!("{line}top {}\u{a0}ms", top.floor())
}

/// The 16.7 ms line's rect, or nothing when the graph's top is under it.
fn budget_rect(top: f64) -> [f32; 4] {
    if top < BUDGET {
        return [0.0; 4];
    }
    [0.0, GRAPH_H - (BUDGET / top) as f32 * GRAPH_H, GRAPH_W, 1.0]
}

/// A frame's bar: Rune, bindings and JS stacked from the bottom, scaled so the graph's height is
/// `top` ms.
fn bar_rects(i: usize, d: &Drawn, top: f64) -> [[f32; 4]; 3] {
    let w = GRAPH_W / BARS as f32;
    let px = |ms: f64| (ms / top) as f32 * GRAPH_H;
    let mut bottom = GRAPH_H;
    [d.rune(), d.bindings, d.pure_js()].map(|ms| {
        let h = px(ms).min(bottom.max(0.0));
        bottom -= h;
        [i as f32 * w, bottom, (w - 1.0).max(1.0), h]
    })
}

/// Turns the overlay on for an app: its hooks report frames to it, and its view draws it.
pub fn install_app(app: rune::App<crate::state::JsState>, fns: &crate::state::AppFns, mode: Mode, on_stats: Option<crate::js::JsRef>) -> rune::App<crate::state::JsState> {
    let perf = Perf::new(mode);
    perf.set_on_stats(on_stats);
    *fns.perf.borrow_mut() = Some(perf.clone());
    let drawn = perf.clone();
    app.on_frame_encoded(move |f| perf.frame(f)).on_frame_drawn(move |rt| drawn.surface(rt.surface_stats()))
}

/// `install_app` for one window of a multi-window app.
pub fn install_window(mut spec: rune::WindowSpec<crate::state::JsState>, fns: &crate::state::AppFns, mode: Mode, on_stats: Option<crate::js::JsRef>) -> rune::WindowSpec<crate::state::JsState> {
    spec.app = install_app(spec.app, fns, mode, on_stats);
    spec
}
