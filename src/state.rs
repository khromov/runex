//! The state type every runex window runs with: a JavaScript value, plus the app's JavaScript
//! functions. Rune's `AppSpec` takes plain `fn` pointers; these adapters reach the JavaScript
//! functions through the state they are handed, so one set of pointers serves every app, and a
//! hot reload swaps the functions without touching the running window.

use std::cell::RefCell;
use std::rc::Rc;

use napi::sys;
use rune::{Cx, El, KeyEvent, Tx, Waker};

use crate::js::{self, JsRef};

/// `S` for every `rune::AppSpec<S>` runex builds.
pub struct JsState {
    /// The app's state: what views and handlers receive and mutate in place.
    pub value: JsRef,
    pub fns: Rc<AppFns>,
}

impl JsState {
    pub fn value(&self) -> sys::napi_value {
        self.value.value()
    }

    /// A state with no app functions of its own: a story's or overlay's, made by a callback
    /// (`Story::new`'s `init`). `None` (the callback threw) gives `{}`.
    pub fn detached(v: Option<sys::napi_value>) -> JsState {
        let value = JsRef::new(v.filter(|v| !crate::conv::is_nullish(*v)).unwrap_or_else(empty_object));
        JsState { value, fns: Rc::new(AppFns::default()) }
    }
}

/// An app's JavaScript functions. Hot reload replaces them in place.
#[derive(Default)]
pub struct AppFns {
    pub init: RefCell<Option<JsRef>>,
    pub view: RefCell<Option<JsRef>>,
    pub poll: RefCell<Option<JsRef>>,
    pub on_key: RefCell<Option<JsRef>>,
    pub setup: RefCell<Option<JsRef>>,
    pub on_close: RefCell<Option<JsRef>>,
    pub on_focus: RefCell<Option<JsRef>>,
    pub on_ime: RefCell<Option<JsRef>>,
    pub on_reopen: RefCell<Option<JsRef>>,
    pub on_open_url: RefCell<Option<JsRef>>,
    pub scenes: RefCell<Vec<(String, JsRef)>>,
    /// `AppHandle::update` callbacks queued from JavaScript, run on the next frame.
    pub updates: RefCell<Vec<JsRef>>,
    /// The index this app has in `APPS` (for `init::<A>`).
    pub index: std::cell::Cell<usize>,
    /// The performance overlay's samples, when it's on for this window (`--perf`).
    pub perf: RefCell<Option<Rc<crate::perf::Perf>>>,
}

impl AppFns {
    /// Takes `other`'s functions (a hot reload of a window): every hook but `init`, which ran.
    pub fn copy_from(&self, other: &AppFns) {
        fn take(to: &RefCell<Option<JsRef>>, from: &RefCell<Option<JsRef>>) {
            if let Some(f) = from.borrow_mut().take() {
                *to.borrow_mut() = Some(f);
            }
        }
        take(&self.view, &other.view);
        take(&self.poll, &other.poll);
        take(&self.on_key, &other.on_key);
        take(&self.on_close, &other.on_close);
        take(&self.on_focus, &other.on_focus);
        take(&self.on_ime, &other.on_ime);
        take(&self.on_reopen, &other.on_reopen);
        take(&self.on_open_url, &other.on_open_url);
        let scenes = std::mem::take(&mut *other.scenes.borrow_mut());
        if !scenes.is_empty() {
            *self.scenes.borrow_mut() = scenes;
        }
    }

    pub fn get(slot: &RefCell<Option<JsRef>>) -> Option<sys::napi_value> {
        slot.borrow().as_ref().map(JsRef::value)
    }

    /// Calls the app's `init`, or `{}` without one.
    pub fn initial(self: &Rc<Self>) -> JsState {
        let value = js::scope(|| {
            let made = AppFns::get(&self.init).and_then(|f| js::call(f, &[]));
            JsRef::new(made.unwrap_or_else(empty_object))
        });
        JsState { value, fns: self.clone() }
    }
}

fn empty_object() -> sys::napi_value {
    let mut object = std::ptr::null_mut();
    unsafe { sys::napi_create_object(js::env(), &mut object) };
    object
}

thread_local! {
    static APPS: RefCell<Vec<Rc<AppFns>>> = const { RefCell::new(Vec::new()) };
}

/// Registers an app's functions and returns the `init` pointer that finds them.
pub fn register(fns: &Rc<AppFns>) -> fn() -> JsState {
    let index = APPS.with(|apps| {
        let mut apps = apps.borrow_mut();
        apps.push(fns.clone());
        apps.len() - 1
    });
    fns.index.set(index);
    INITS.get(index).copied().unwrap_or(init::<0>)
}

fn init<const A: usize>() -> JsState {
    let fns = APPS.with(|apps| apps.borrow().get(A).cloned()).expect("runex: app registered");
    fns.initial()
}

macro_rules! table {
    ($f:ident; $($i:literal)*) => { [$($f::<$i>),*] };
}

/// One `init` per registered app (windows and overlays each register one).
static INITS: [fn() -> JsState; 64] = table!(init; 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63);

fn scene<const I: usize>(s: &mut JsState) {
    js::scope(|| {
        let f = s.fns.scenes.borrow().get(I).map(|(_, f)| f.value());
        if let Some(f) = f {
            js::call(f, &[s.value()]);
        }
    });
}

static SCENES: [fn(&mut JsState); 256] = table!(scene; 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96 97 98 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115 116 117 118 119 120 121 122 123 124 125 126 127 128 129 130 131 132 133 134 135 136 137 138 139 140 141 142 143 144 145 146 147 148 149 150 151 152 153 154 155 156 157 158 159 160 161 162 163 164 165 166 167 168 169 170 171 172 173 174 175 176 177 178 179 180 181 182 183 184 185 186 187 188 189 190 191 192 193 194 195 196 197 198 199 200 201 202 203 204 205 206 207 208 209 210 211 212 213 214 215 216 217 218 219 220 221 222 223 224 225 226 227 228 229 230 231 232 233 234 235 236 237 238 239 240 241 242 243 244 245 246 247 248 249 250 251 252 253 254 255);

/// `AppSpec::scenes` for these scene names: each entry runs the JavaScript scene at its index.
pub fn scenes(names: &[String]) -> &'static [(&'static str, fn(&mut JsState))] {
    let list: Vec<(&'static str, fn(&mut JsState))> =
        names.iter().take(SCENES.len()).enumerate().map(|(i, name)| (crate::util::intern(name), SCENES[i])).collect();
    Box::leak(list.into_boxed_slice())
}

pub fn view(s: &JsState, cx: &mut Cx<JsState>) -> El {
    js::scope(|| {
        let Some(view) = AppFns::get(&s.fns.view) else {
            return rune::text("runex: the app has no view");
        };
        let perf = s.fns.perf.borrow().clone();
        let started = perf.as_ref().map(|_| std::time::Instant::now());
        let result = crate::conv::lend::<crate::gen::rune::W_Cx, _>(cx, |cx| js::call(view, &[s.value(), cx]));
        let el = match result.map(crate::conv::take::<crate::gen::rune::W_El>) {
            Some(Ok(el)) => el,
            Some(Err(e)) => {
                js::throw_error(&format!("the view returned something that isn't an El: {}", e.reason));
                error_view("the view returned something that isn't an El")
            }
            None => error_view("the view threw"),
        };
        match (perf, started) {
            (Some(perf), Some(started)) => {
                perf.view_ms(started.elapsed().as_secs_f64() * 1000.0);
                if perf.mode().overlay { perf.attach(el, cx) } else { el }
            }
            _ => el,
        }
    })
}

/// What a window shows while its view throws: the message, on red, until the next good view.
pub fn error_view(message: &str) -> El {
    let t = rune::tok::theme(true);
    rune::col()
        .w_full()
        .h_full()
        .center()
        .gap(8.0)
        .padding(24.0)
        .fill(rune::color::oklch(0.32, 0.09, 25.0))
        .child(rune::text("runex").font(rune::tok::type_::TITLE).color(t.text))
        .child(rune::text(format!("{message} (see the console)")).color(t.text_secondary))
}

pub fn poll(s: &mut JsState, t: f64, tx: &mut Tx) -> bool {
    js::scope(|| {
        let mut changed = drain_updates(s, tx);
        if let Some(poll) = AppFns::get(&s.fns.poll) {
            let r = lend_tx(tx, |tx| js::call(poll, &[s.value(), js::to_js(t), tx]));
            changed |= r.is_some_and(js::is_truthy);
        }
        changed
    })
}

/// Runs the updates JavaScript queued through the app's handle.
pub fn drain_updates(s: &mut JsState, tx: &mut Tx) -> bool {
    let updates = std::mem::take(&mut *s.fns.updates.borrow_mut());
    let any = !updates.is_empty();
    for f in updates {
        let f = f.value();
        let r = lend_tx(tx, |tx| js::call(f, &[s.value(), tx]));
        replace_from(s, r);
    }
    any
}

pub fn on_key(s: &mut JsState, event: &KeyEvent, tx: &mut Tx) -> bool {
    js::scope(|| {
        let Some(f) = AppFns::get(&s.fns.on_key) else { return false };
        let event = crate::conv::arg_js(event.clone());
        lend_tx(tx, |tx| js::call(f, &[s.value(), event, tx])).is_some_and(js::is_truthy)
    })
}

pub fn setup(s: &mut JsState, waker: Waker) {
    js::scope(|| {
        if let Some(f) = AppFns::get(&s.fns.setup) {
            let waker = js::to_js(crate::app::Waker { waker });
            js::call(f, &[s.value(), waker]);
        }
    });
}

pub fn on_close(s: &mut JsState, tx: &mut Tx) {
    js::scope(|| {
        if let Some(f) = AppFns::get(&s.fns.on_close) {
            lend_tx(tx, |tx| js::call(f, &[s.value(), tx]));
        }
    });
}

pub fn on_focus(s: &mut JsState, focused: bool, tx: &mut Tx) {
    js::scope(|| {
        if let Some(f) = AppFns::get(&s.fns.on_focus) {
            lend_tx(tx, |tx| js::call(f, &[s.value(), js::to_js(focused), tx]));
        }
    });
}

pub fn lend_tx<R>(tx: &mut Tx, f: impl FnOnce(sys::napi_value) -> R) -> R {
    crate::conv::lend::<crate::gen::rune::W_Tx, _>(tx, f)
}

/// A JavaScript handler an element holds. Calls run on the main thread inside a pump.
pub struct Handler(pub JsRef);

impl Handler {
    pub fn new(f: sys::napi_value) -> Rc<Handler> {
        Rc::new(Handler(JsRef::new(f)))
    }

    /// Calls the handler with `args`; whatever it returns, or `None` when it threw.
    pub fn call(&self, args: &[sys::napi_value]) -> Option<sys::napi_value> {
        js::call(self.0.value(), args)
    }
}

/// After a handler of `&mut S`: a returned value other than `undefined` becomes the state, so
/// a primitive state (`0`) can change (`(s) => s + 1`).
pub fn replace_from(s: &mut JsState, r: Option<sys::napi_value>) {
    if let Some(r) = r {
        if crate::conv::kind(r) != sys::ValueType::napi_undefined {
            s.value = JsRef::new(r);
        }
    }
}

pub fn on_ime(s: &mut JsState, ime: &rune::Ime, tx: &mut Tx) -> bool {
    js::scope(|| {
        let Some(f) = AppFns::get(&s.fns.on_ime) else { return false };
        let ime = crate::conv::arg_js(ime.clone());
        lend_tx(tx, |tx| js::call(f, &[s.value(), ime, tx])).is_some_and(js::is_truthy)
    })
}

pub fn on_reopen(s: &mut JsState, has_visible: bool, tx: &mut Tx) -> bool {
    js::scope(|| {
        let Some(f) = AppFns::get(&s.fns.on_reopen) else { return false };
        lend_tx(tx, |tx| js::call(f, &[s.value(), js::to_js(has_visible), tx])).is_some_and(js::is_truthy)
    })
}

pub fn on_open_url(s: &mut JsState, url: &str, tx: &mut Tx) {
    js::scope(|| {
        if let Some(f) = AppFns::get(&s.fns.on_open_url) {
            lend_tx(tx, |tx| js::call(f, &[s.value(), js::to_js(url), tx]));
        }
    });
}
