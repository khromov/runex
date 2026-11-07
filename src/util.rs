//! Small conversions shared by the bindings.

use std::collections::HashSet;
use std::sync::Mutex;

/// A `&'static str` for `s`, leaked once per distinct string: Rune takes some names (roles,
/// titles) as `&'static str`, and views rebuild them every frame.
pub fn intern(s: &str) -> &'static str {
    static STRINGS: Mutex<Option<HashSet<&'static str>>> = Mutex::new(None);
    let mut strings = STRINGS.lock().unwrap_or_else(|e| e.into_inner());
    let set = strings.get_or_insert_with(HashSet::new);
    if let Some(&found) = set.get(s) {
        return found;
    }
    let leaked: &'static str = Box::leak(s.to_owned().into_boxed_str());
    set.insert(leaked);
    leaked
}

/// A `&'static [u8]` for font or image bytes an `AppSpec` keeps for the process's life.
pub fn leak_bytes(bytes: Vec<u8>) -> &'static [u8] {
    Box::leak(bytes.into_boxed_slice())
}

pub fn pair(v: &[f64]) -> napi::Result<(f32, f32)> {
    match v {
        [a, b] => Ok((*a as f32, *b as f32)),
        _ => Err(napi::Error::from_reason(format!("expected [number, number], got {} numbers", v.len()))),
    }
}
