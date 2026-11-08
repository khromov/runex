//! `rune::text::set_icon_swap`: an alternative icon set (Desktop's New icons) that draws in
//! place of each icon a JavaScript function names. Rune takes a `fn` pointer, so, as for the
//! generated `fn` parameters, each distinct function takes one of a fixed number of trampolines.

use std::cell::RefCell;

use napi_derive::napi;

use crate::conv::{self, Class, Raw};
use crate::gen::rune::W_Icon;
use crate::js::{self, JsRef};

thread_local! {
    static SWAPS: RefCell<Vec<JsRef>> = const { RefCell::new(Vec::new()) };
}

fn swap<const I: usize>(icon: &rune::Icon) -> Option<&'static rune::Icon> {
    // Rune draws icons on the thread JavaScript runs on, inside a call from it; anywhere else
    // there's no JavaScript to ask.
    if js::env().is_null() {
        return None;
    }
    // SAFETY: the icons Rune swaps are its `&'static` ones (`text::icon::swapped`).
    let icon: &'static rune::Icon = unsafe { &*(icon as *const rune::Icon) };
    js::scope(|| {
        let f = SWAPS.with(|r| r.borrow().get(I).map(JsRef::value))?;
        let v = conv::static_ref::<W_Icon>(icon).ok()?;
        let r = js::call(f, &[v])?;
        if conv::is_nullish(r) {
            return None;
        }
        match conv::instance::<W_Icon>(r).and_then(|mut i| i.slot().leak("Icon")) {
            Ok(swapped) => Some(swapped),
            Err(e) => {
                js::throw_error(&format!("an icon swap must return an Icon or null: {}", e.reason));
                None
            }
        }
    })
}

macro_rules! table {
    ($f:ident; $($i:literal)*) => { [$($f::<$i>),*] };
}

const SLOTS: usize = 16;
static SWAP: [fn(&rune::Icon) -> Option<&'static rune::Icon>; SLOTS] = table!(swap; 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15);

/// Draws each icon `swap` gives another for as that one, and every icon as itself with `null`
/// (`rune::text::set_icon_swap`): an alternative icon set an app's setting turns on, such as
/// Desktop's New icons. Every window draws its next frame with it; an icon keeps its element's
/// size either way. Each distinct function takes one of 16 slots.
#[napi(js_name = "set_icon_swap", ts_args_type = "swap: ((icon: Icon) => Icon | null) | null")]
pub fn set_icon_swap(swap: Raw) -> napi::Result<()> {
    if conv::is_nullish(swap.0) {
        rune::text::set_icon_swap(None);
        return Ok(());
    }
    let i = SWAPS.with(|r| conv::register_fn(&mut r.borrow_mut(), swap.0, SLOTS)).map_err(|e| conv::err(format!("swap: {}", e.reason)))?;
    rune::text::set_icon_swap(Some(SWAP[i]));
    Ok(())
}
