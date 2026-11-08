//! Conversions between JavaScript values and Rust values, for the generated bindings
//! (`src/gen`). Every argument arrives as a raw `napi_value` and converts through `FromJs`;
//! every result leaves through `ToJs`. The mapping follows Rust's shapes:
//!
//! - numbers ↔ every Rust number type; `bool`; `char` and strings ↔ strings;
//! - `Option<T>` ↔ `T | null` (`undefined` reads as `None` too);
//! - `Vec<T>`, slices and `[T; N]` ↔ arrays; tuples ↔ arrays;
//! - `Duration` ↔ seconds; paths ↔ strings;
//! - records (structs whose fields are all public) ↔ objects with those fields;
//! - enums ↔ strings for unit variants, `{ Variant: payload }` otherwise;
//! - everything else ↔ instances of its class, which own (or lend) the Rust value.

use std::ffi::CString;
use std::path::PathBuf;
use std::ptr;
use std::time::Duration;

use napi::bindgen_prelude::{ClassInstance, FromNapiValue, MaybeTypeTag, ToNapiValue};
use napi::sys;

use crate::js;

pub type Result<T> = napi::Result<T>;
pub type Value = sys::napi_value;

pub fn err(message: impl Into<String>) -> napi::Error {
    napi::Error::from_reason(message.into())
}

fn env() -> sys::napi_env {
    js::env()
}

pub fn kind(v: Value) -> sys::napi_valuetype {
    let mut t = 0;
    unsafe { sys::napi_typeof(env(), v, &mut t) };
    t
}

pub fn is_nullish(v: Value) -> bool {
    v.is_null() || matches!(kind(v), sys::ValueType::napi_undefined | sys::ValueType::napi_null)
}

pub fn null() -> Value {
    let mut v = ptr::null_mut();
    unsafe { sys::napi_get_null(env(), &mut v) };
    v
}

pub fn undefined() -> Value {
    js::undefined()
}

pub fn object() -> Value {
    let mut o = ptr::null_mut();
    unsafe { sys::napi_create_object(env(), &mut o) };
    o
}

/// Runs `f` with `name` as a C string, on the stack for the short names fields have.
fn with_cname<R>(name: &str, f: impl FnOnce(*const std::ffi::c_char) -> R) -> R {
    let mut buf = [0u8; 64];
    if name.len() < buf.len() && !name.as_bytes().contains(&0) {
        buf[..name.len()].copy_from_slice(name.as_bytes());
        return f(buf.as_ptr().cast());
    }
    let owned = CString::new(name).unwrap_or_default();
    f(owned.as_ptr())
}

pub fn get(o: Value, name: &str) -> Value {
    let mut v = ptr::null_mut();
    with_cname(name, |n| unsafe { sys::napi_get_named_property(env(), o, n, &mut v) });
    v
}

pub fn has(o: Value, name: &str) -> bool {
    let mut out = false;
    with_cname(name, |n| unsafe { sys::napi_has_named_property(env(), o, n, &mut out) });
    out
}

pub fn set(o: Value, name: &str, v: Value) {
    with_cname(name, |n| unsafe { sys::napi_set_named_property(env(), o, n, v) });
}

/// Reads field `name` of record `ty`, naming both in the error.
pub fn field<T: FromJs>(o: Value, ty: &str, name: &str) -> Result<T> {
    T::from_js(get(o, name)).map_err(|e| err(format!("{ty}.{name}: {}", e.reason)))
}

/// Reads field `name`, or `default` when the object lacks it.
pub fn field_or<T: FromJs>(o: Value, ty: &str, name: &str, default: impl FnOnce() -> T) -> Result<T> {
    if !has(o, name) || kind(get(o, name)) == sys::ValueType::napi_undefined {
        return Ok(default());
    }
    field(o, ty, name)
}

fn array_len(v: Value) -> Result<u32> {
    let mut is = false;
    unsafe { sys::napi_is_array(env(), v, &mut is) };
    if !is {
        // Typed arrays and Buffers (bytes from readFileSync) index like arrays.
        let mut typed = false;
        unsafe { sys::napi_is_typedarray(env(), v, &mut typed) };
        if typed {
            let (mut kind, mut len, mut data, mut buf, mut off) = (0, 0usize, ptr::null_mut(), ptr::null_mut(), 0usize);
            unsafe { sys::napi_get_typedarray_info(env(), v, &mut kind, &mut len, &mut data, &mut buf, &mut off) };
            return Ok(len as u32);
        }
        return Err(err("expected an array"));
    }
    let mut len = 0;
    unsafe { sys::napi_get_array_length(env(), v, &mut len) };
    Ok(len)
}

fn element(v: Value, i: u32) -> Value {
    let mut e = ptr::null_mut();
    unsafe { sys::napi_get_element(env(), v, i, &mut e) };
    e
}

pub fn array(items: impl IntoIterator<Item = Value>) -> Value {
    let mut a = ptr::null_mut();
    unsafe { sys::napi_create_array(env(), &mut a) };
    for (i, item) in items.into_iter().enumerate() {
        unsafe { sys::napi_set_element(env(), a, i as u32, item) };
    }
    a
}

pub trait FromJs: Sized {
    fn from_js(v: Value) -> Result<Self>;
}

pub trait ToJs {
    fn to_js(self) -> Result<Value>;
}

/// Wraps a JS→Rust conversion error with the parameter's name.
pub fn arg<T: FromJs>(v: Value, name: &str) -> Result<T> {
    T::from_js(v).map_err(|e| err(format!("{name}: {}", e.reason)))
}

macro_rules! via_napi {
    ($($t:ty),*) => {$(
        impl FromJs for $t {
            fn from_js(v: Value) -> Result<Self> {
                unsafe { <$t as FromNapiValue>::from_napi_value(env(), v) }
            }
        }
        impl ToJs for $t {
            fn to_js(self) -> Result<Value> {
                unsafe { <$t as ToNapiValue>::to_napi_value(env(), self) }
            }
        }
    )*};
}
via_napi!(bool, String);

fn number(v: Value) -> Result<f64> {
    if kind(v) != sys::ValueType::napi_number {
        return Err(err("expected a number"));
    }
    let mut out = 0.0;
    unsafe { sys::napi_get_value_double(env(), v, &mut out) };
    Ok(out)
}

fn make_number(n: f64) -> Value {
    let mut v = ptr::null_mut();
    unsafe { sys::napi_create_double(env(), n, &mut v) };
    v
}

macro_rules! numbers {
    ($($t:ty),*) => {$(
        impl FromJs for $t {
            fn from_js(v: Value) -> Result<Self> {
                Ok(number(v)? as $t)
            }
        }
        impl ToJs for $t {
            fn to_js(self) -> Result<Value> {
                Ok(make_number(self as f64))
            }
        }
    )*};
}
numbers!(f32, f64, i8, i16, i32, i64, isize);

// Unsigned integers: a negative whole number wraps, as JavaScript's `x >>> 0` reads an int32's
// bits (bit flags built with `<<` and `|` come out negative), instead of saturating to 0.
macro_rules! unsigned {
    ($($t:ty),*) => {$(
        impl FromJs for $t {
            fn from_js(v: Value) -> Result<Self> {
                let n = number(v)?;
                Ok(if n < 0.0 && n.fract() == 0.0 && n >= i64::MIN as f64 { (n as i64) as $t } else { n as $t })
            }
        }
        impl ToJs for $t {
            fn to_js(self) -> Result<Value> {
                Ok(make_number(self as f64))
            }
        }
    )*};
}
unsigned!(u8, u16, u32, u64, usize);

impl FromJs for char {
    fn from_js(v: Value) -> Result<Self> {
        String::from_js(v)?.chars().next().ok_or_else(|| err("expected a one-character string"))
    }
}
impl ToJs for char {
    fn to_js(self) -> Result<Value> {
        self.to_string().to_js()
    }
}

impl ToJs for &str {
    fn to_js(self) -> Result<Value> {
        self.to_owned().to_js()
    }
}

impl ToJs for () {
    fn to_js(self) -> Result<Value> {
        Ok(undefined())
    }
}

/// `&'static str` from JavaScript, interned (`util::intern`).
impl FromJs for &'static str {
    fn from_js(v: Value) -> Result<Self> {
        Ok(crate::util::intern(&String::from_js(v)?))
    }
}

impl FromJs for PathBuf {
    fn from_js(v: Value) -> Result<Self> {
        Ok(PathBuf::from(String::from_js(v)?))
    }
}
impl ToJs for PathBuf {
    fn to_js(self) -> Result<Value> {
        self.to_string_lossy().into_owned().to_js()
    }
}
impl ToJs for &std::path::Path {
    fn to_js(self) -> Result<Value> {
        self.to_string_lossy().into_owned().to_js()
    }
}

/// Seconds.
impl FromJs for Duration {
    fn from_js(v: Value) -> Result<Self> {
        let s = number(v)?;
        Duration::try_from_secs_f64(s.max(0.0)).map_err(|e| err(e.to_string()))
    }
}
impl ToJs for Duration {
    fn to_js(self) -> Result<Value> {
        Ok(make_number(self.as_secs_f64()))
    }
}

impl<T: FromJs> FromJs for Option<T> {
    fn from_js(v: Value) -> Result<Self> {
        if is_nullish(v) {
            Ok(None)
        } else {
            T::from_js(v).map(Some)
        }
    }
}
impl<T: ToJs> ToJs for Option<T> {
    fn to_js(self) -> Result<Value> {
        match self {
            Some(v) => v.to_js(),
            None => Ok(null()),
        }
    }
}

/// Bytes as a `Uint8Array` (fonts, images): one copy instead of an element per byte.
fn bytes_to_js(bytes: &[u8]) -> Result<Value> {
    let mut data = ptr::null_mut();
    let mut buffer = ptr::null_mut();
    unsafe { sys::napi_create_buffer_copy(env(), bytes.len(), bytes.as_ptr().cast(), &mut data, &mut buffer) };
    Ok(buffer)
}

/// The bytes of a typed array or Buffer, if `v` is one.
fn bytes_from_js(v: Value) -> Option<Vec<u8>> {
    let mut typed = false;
    unsafe { sys::napi_is_typedarray(env(), v, &mut typed) };
    if typed {
        let (mut kind, mut len, mut data, mut buf, mut off) = (0, 0usize, ptr::null_mut(), ptr::null_mut(), 0usize);
        unsafe { sys::napi_get_typedarray_info(env(), v, &mut kind, &mut len, &mut data, &mut buf, &mut off) };
        if kind == sys::TypedarrayType::uint8_array || kind == sys::TypedarrayType::uint8_clamped_array || kind == sys::TypedarrayType::int8_array {
            return Some(if len == 0 { Vec::new() } else { unsafe { std::slice::from_raw_parts(data as *const u8, len) }.to_vec() });
        }
    }
    None
}

fn is_u8<T: 'static>() -> bool {
    std::any::TypeId::of::<T>() == std::any::TypeId::of::<u8>()
}

impl<T: FromJs + 'static> FromJs for Vec<T> {
    fn from_js(v: Value) -> Result<Self> {
        if is_u8::<T>() {
            if let Some(bytes) = bytes_from_js(v) {
                // SAFETY: T is u8 (checked above), so Vec<u8> and Vec<T> are the same type.
                return Ok(unsafe { std::mem::transmute::<Vec<u8>, Vec<T>>(bytes) });
            }
        }
        let len = array_len(v)?;
        (0..len).map(|i| T::from_js(element(v, i)).map_err(|e| err(format!("[{i}]: {}", e.reason)))).collect()
    }
}
impl<T: ToJs + 'static> ToJs for Vec<T> {
    fn to_js(self) -> Result<Value> {
        if is_u8::<T>() {
            // SAFETY: T is u8.
            let bytes = unsafe { std::mem::transmute::<Vec<T>, Vec<u8>>(self) };
            return bytes_to_js(&bytes);
        }
        let items: Result<Vec<Value>> = self.into_iter().map(ToJs::to_js).collect();
        Ok(array(items?))
    }
}
impl<T: ToJs + Clone + 'static> ToJs for &[T] {
    fn to_js(self) -> Result<Value> {
        if is_u8::<T>() {
            // SAFETY: T is u8.
            return bytes_to_js(unsafe { std::slice::from_raw_parts(self.as_ptr() as *const u8, self.len()) });
        }
        self.to_vec().to_js()
    }
}

/// A slice leaked for an array, remembered on the array (`napi_wrap`) so the same array (a
/// module-level constant, as Rust's statics are) is leaked once, not on every call.
struct LeakedSlice {
    type_id: std::any::TypeId,
    ptr: *const (),
    len: usize,
}

/// `&'static [T]` from JavaScript: leaked, as Rust code would pass a static.
impl<T: FromJs + 'static> FromJs for &'static [T] {
    fn from_js(v: Value) -> Result<Self> {
        let mut held = ptr::null_mut();
        if kind(v) == sys::ValueType::napi_object && unsafe { sys::napi_unwrap(env(), v, &mut held) } == sys::Status::napi_ok && !held.is_null() {
            // SAFETY: only this impl wraps arrays, always with a `LeakedSlice`.
            let leaked = unsafe { &*(held as *const LeakedSlice) };
            if leaked.type_id == std::any::TypeId::of::<T>() {
                return Ok(unsafe { std::slice::from_raw_parts(leaked.ptr as *const T, leaked.len) });
            }
        }
        let slice: &'static [T] = Box::leak(Vec::<T>::from_js(v)?.into_boxed_slice());
        let info = Box::into_raw(Box::new(LeakedSlice { type_id: std::any::TypeId::of::<T>(), ptr: slice.as_ptr() as *const (), len: slice.len() }));
        let status = unsafe { sys::napi_wrap(env(), v, info.cast(), None, ptr::null_mut(), ptr::null_mut()) };
        if status != sys::Status::napi_ok {
            // Already wrapped by something else: keep the copy, forget the note.
            drop(unsafe { Box::from_raw(info) });
        }
        Ok(slice)
    }
}

impl<T: FromJs> FromJs for Box<T> {
    fn from_js(v: Value) -> Result<Self> {
        T::from_js(v).map(Box::new)
    }
}
impl<T: ToJs> ToJs for Box<T> {
    fn to_js(self) -> Result<Value> {
        (*self).to_js()
    }
}

impl<T: FromJs + 'static, const N: usize> FromJs for [T; N] {
    fn from_js(v: Value) -> Result<Self> {
        let items = Vec::<T>::from_js(v)?;
        let len = items.len();
        items.try_into().map_err(|_| err(format!("expected {N} items, got {len}")))
    }
}
impl<T: ToJs + 'static, const N: usize> ToJs for [T; N] {
    fn to_js(self) -> Result<Value> {
        let items: Result<Vec<Value>> = self.into_iter().map(ToJs::to_js).collect();
        Ok(array(items?))
    }
}

macro_rules! tuples {
    ($( ($($n:tt $t:ident),*) )*) => {$(
        impl<$($t: FromJs),*> FromJs for ($($t,)*) {
            fn from_js(v: Value) -> Result<Self> {
                let len = array_len(v)?;
                let want = [$($n),*].len() as u32;
                if len != want {
                    return Err(err(format!("expected a {want}-item array, got {len}")));
                }
                Ok(($($t::from_js(element(v, $n))?,)*))
            }
        }
        impl<$($t: ToJs),*> ToJs for ($($t,)*) {
            fn to_js(self) -> Result<Value> {
                Ok(array([$(self.$n.to_js()?),*]))
            }
        }
    )*};
}
tuples!((0 A, 1 B) (0 A, 1 B, 2 C) (0 A, 1 B, 2 C, 3 D));

/// A raw JavaScript value, passed through unconverted.
pub struct Js(pub Value);
impl FromJs for Js {
    fn from_js(v: Value) -> Result<Self> {
        Ok(Js(v))
    }
}
impl ToJs for Js {
    fn to_js(self) -> Result<Value> {
        Ok(self.0)
    }
}

/// A JavaScript function, kept for a handler.
pub struct JsFn(pub std::rc::Rc<crate::state::Handler>);
impl FromJs for JsFn {
    fn from_js(v: Value) -> Result<Self> {
        if kind(v) != sys::ValueType::napi_function {
            return Err(err("expected a function"));
        }
        Ok(JsFn(crate::state::Handler::new(v)))
    }
}

/// Where a class instance's Rust value lives.
pub enum Slot<T: 'static> {
    /// The instance owns it.
    Owned(T),
    /// Moved out (into a parent element, or consumed by a method that takes `self`).
    Moved,
    /// Lent by Rust for the length of a callback.
    Lent(*mut T),
    /// Leaked once for an API that wants `&'static T`.
    Static(&'static T),
    /// A lent value whose callback has returned.
    Expired,
    /// A constant (`Transition::NONE`, a kit glyph): every use takes a copy, none moves it.
    Shared(T),
}

impl<T: 'static> Slot<T> {
    fn gone(&self, ty: &str) -> napi::Error {
        match self {
            Slot::Moved => err(format!("this {ty} was moved (into a parent, or by a method that consumes it) and can't be used again")),
            Slot::Expired => err(format!("this {ty} was lent to a callback that has returned")),
            _ => err(format!("this {ty} can't be changed")),
        }
    }

    pub fn get(&self, ty: &str) -> Result<&T> {
        match self {
            Slot::Owned(v) => Ok(v),
            // SAFETY: lent pointers are live until `expire` runs after the callback.
            Slot::Lent(p) => Ok(unsafe { &**p }),
            Slot::Static(v) => Ok(v),
            Slot::Shared(v) => Ok(v),
            _ => Err(self.gone(ty)),
        }
    }

    pub fn get_mut(&mut self, ty: &str) -> Result<&mut T> {
        match self {
            Slot::Owned(v) => Ok(v),
            // SAFETY: lent pointers are live and exclusive until `expire`.
            Slot::Lent(p) => Ok(unsafe { &mut **p }),
            _ => Err(self.gone(ty)),
        }
    }

    pub fn take(&mut self, ty: &str) -> Result<T> {
        match std::mem::replace(self, Slot::Moved) {
            Slot::Owned(v) => Ok(v),
            other => {
                let e = other.gone(ty);
                *self = other;
                Err(if matches!(self, Slot::Lent(_) | Slot::Static(_)) { err(format!("this {ty} is borrowed and can't be moved")) } else { e })
            }
        }
    }

    /// `take`, but a shared constant gives a copy.
    pub fn take_or_clone(&mut self, ty: &str) -> Result<T>
    where
        T: Clone,
    {
        if let Slot::Shared(v) = self {
            return Ok(v.clone());
        }
        self.take(ty)
    }

    pub fn put(&mut self, v: T) {
        *self = Slot::Owned(v);
    }

    /// `&'static T`: leaks an owned value once and keeps pointing at it.
    pub fn leak(&mut self, ty: &str) -> Result<&'static T> {
        if let Slot::Static(v) = self {
            return Ok(v);
        }
        let v: &'static T = Box::leak(Box::new(self.take(ty)?));
        *self = Slot::Static(v);
        Ok(v)
    }

    pub fn expire(&mut self) {
        if matches!(self, Slot::Lent(_)) {
            *self = Slot::Expired;
        }
    }
}

/// A class wrapping a Rust value in a `Slot`; implemented by every generated class.
pub trait Class: Sized + 'static + MaybeTypeTag + ToNapiValue {
    type Inner: 'static;
    const NAME: &'static str;
    fn wrap(slot: Slot<Self::Inner>) -> Self;
    fn slot(&mut self) -> &mut Slot<Self::Inner>;
}

/// The class instance behind `v`.
pub fn instance<C: Class>(v: Value) -> Result<ClassInstance<'static, C>> {
    if is_nullish(v) || kind(v) != sys::ValueType::napi_object {
        return Err(err(format!("expected a {}", C::NAME)));
    }
    unsafe { ClassInstance::<C>::from_napi_value(env(), v) }.map_err(|_| err(format!("expected a {}", C::NAME)))
}

/// The instance behind `v` of a hand-written class (not a `Slot` wrapper).
pub fn instance_plain<C: 'static + MaybeTypeTag>(v: Value) -> Result<ClassInstance<'static, C>> {
    if is_nullish(v) || kind(v) != sys::ValueType::napi_object {
        return Err(err(format!("expected a {}", std::any::type_name::<C>().rsplit("::").next().unwrap_or("class instance"))));
    }
    unsafe { ClassInstance::<C>::from_napi_value(env(), v) }
}

/// Takes the value out of the class instance `v` (a move).
pub fn take<C: Class>(v: Value) -> Result<C::Inner> {
    instance::<C>(v)?.slot().take(C::NAME)
}

/// Moves the value out of `v`, or copies it when `v` is a shared constant.
pub fn take_or_clone<C: Class>(v: Value) -> Result<C::Inner>
where
    C::Inner: Clone,
{
    let mut i = instance::<C>(v)?;
    if let Slot::Shared(inner) = i.slot() {
        return Ok(inner.clone());
    }
    i.slot().take(C::NAME)
}

/// A `&'static` value (a static, a leaked constant) as an instance that borrows it.
pub fn static_ref<C: Class>(value: &'static C::Inner) -> Result<Value> {
    unsafe { C::to_napi_value(env(), C::wrap(Slot::Static(value))) }
}

/// For a callback returning `&mut T`: the value inside the instance JavaScript returned. When the
/// callback threw or returned something else, the error is kept and a fresh default stands in.
pub fn ret_mut<C: Class>(v: Option<Value>) -> &'static mut C::Inner
where
    C::Inner: Default,
{
    if let Some(v) = v {
        match instance::<C>(v).and_then(|mut i| i.slot().get_mut(C::NAME).map(|r| r as *mut C::Inner)) {
            // SAFETY: the instance is alive (the app's state holds it) for the synchronous use Rune
            // makes of the reference inside the handler.
            Ok(r) => return unsafe { &mut *r },
            Err(e) => js::throw_error(&format!("a callback returned the wrong value: {}", e.reason)),
        }
    }
    Box::leak(Box::new(C::Inner::default()))
}

/// Gives a closure returning `&'static mut T` the higher-ranked signature APIs such as
/// `El::on_edit` ask for (`for<'a> Fn(&'a mut S) -> &'a mut T`), which closures don't infer.
pub fn hr_mut<S: 'static, T: 'static>(f: impl Fn(&mut S) -> &'static mut T + 'static) -> impl for<'a> Fn(&'a mut S) -> &'a mut T + 'static {
    move |s| f(s)
}

/// Replaces the contents of JavaScript array `array` with `items` (after a `&mut Vec<T>` call).
pub fn write_array<T: ToJs>(array: Value, items: Vec<T>) -> Result<()> {
    let n = items.len();
    for (i, item) in items.into_iter().enumerate() {
        let v = item.to_js()?;
        unsafe { sys::napi_set_element(env(), array, i as u32, v) };
    }
    set(array, "length", make_number(n as f64));
    Ok(())
}

/// A shared constant: uses copy it, so it can't be moved away.
#[allow(dead_code, reason = "tools/bindgen emits it for a constant of a Clone, non-Copy class (emit.ts); Rune's API has none at this pin")]
pub fn shared<C: Class>(value: C::Inner) -> Result<Value> {
    unsafe { C::to_napi_value(env(), C::wrap(Slot::Shared(value))) }
}

/// `&'static` values (a catalog slice) as an array of `C`s that refer to them.
pub fn static_refs<C: Class>(values: impl IntoIterator<Item = &'static C::Inner>) -> Result<Value> {
    let items = values.into_iter().map(static_ref::<C>).collect::<Result<Vec<_>>>()?;
    Ok(array(items))
}

/// A clone of the value inside class instance `v`.
pub fn cloned<C: Class>(v: Value) -> Result<C::Inner>
where
    C::Inner: Clone,
{
    instance::<C>(v)?.slot().get(C::NAME).cloned()
}

/// A new instance owning `value`.
pub fn owned<C: Class>(value: C::Inner) -> Result<Value> {
    unsafe { C::to_napi_value(env(), C::wrap(Slot::Owned(value))) }
}

/// Lends `value` to JavaScript as a `C` for the length of `f`; the instance expires after.
pub fn lend<C: Class, R>(value: &mut C::Inner, f: impl FnOnce(Value) -> R) -> R {
    lend_ptr::<C, R>(value, f)
}

/// Lends a shared reference. The generated bindings offer only `&self` methods through a
/// value lent this way: JavaScript reads it, never changes it.
pub fn lend_ref<C: Class, R>(value: &C::Inner, f: impl FnOnce(Value) -> R) -> R {
    lend_ptr::<C, R>(value as *const C::Inner as *mut C::Inner, f)
}

fn lend_ptr<C: Class, R>(ptr: *mut C::Inner, f: impl FnOnce(Value) -> R) -> R {
    let v = unsafe { C::to_napi_value(env(), C::wrap(Slot::Lent(ptr))) }.unwrap_or_else(|_| undefined());
    let r = f(v);
    if let Ok(mut i) = instance::<C>(v) {
        i.slot().expire();
    }
    r
}

/// Records: objects created through the class runex's TypeScript layer registers for them, so
/// they carry the record's methods.
pub mod records {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use super::*;

    thread_local! {
        static CTORS: RefCell<HashMap<&'static str, js::JsRef>> = RefCell::new(HashMap::new());
    }

    pub fn register(name: &str, ctor: Value) {
        let name = crate::util::intern(name);
        CTORS.with(|c| c.borrow_mut().insert(name, js::JsRef::new(ctor)));
    }

    /// A new, empty instance of record `name` (a plain object if none is registered).
    pub fn new(name: &str) -> Value {
        let ctor = CTORS.with(|c| c.borrow().get(name).map(js::JsRef::value));
        match ctor {
            Some(ctor) => {
                let mut v = ptr::null_mut();
                let status = unsafe { sys::napi_new_instance(env(), ctor, 0, ptr::null(), &mut v) };
                if status == sys::Status::napi_ok { v } else { object() }
            }
            None => object(),
        }
    }
}

/// Reads an enum's tag: a string for a unit variant, else the single key of `{ Variant: .. }`.
pub fn enum_tag(v: Value, ty: &str) -> Result<(String, Option<Value>)> {
    match kind(v) {
        sys::ValueType::napi_string => Ok((String::from_js(v)?, None)),
        sys::ValueType::napi_object => {
            let mut keys = ptr::null_mut();
            unsafe { sys::napi_get_property_names(env(), v, &mut keys) };
            let len = array_len(keys)?;
            if len != 1 {
                return Err(err(format!("a {ty} object has exactly one key, its variant")));
            }
            let key = String::from_js(element(keys, 0))?;
            let payload = get(v, &key);
            Ok((key, Some(payload)))
        }
        _ => Err(err(format!("expected a {ty} (a variant name, or {{ Variant: value }})"))),
    }
}

pub fn tagged(tag: &str, payload: Value) -> Value {
    let o = object();
    set(o, tag, payload);
    o
}

pub fn element_at(v: Value, i: u32) -> Value {
    element(v, i)
}

/// For a closure argument: converts a JavaScript return value, or `default` when the call threw.
pub fn ret_or<T: FromJs>(v: Option<Value>, default: impl FnOnce() -> T) -> T {
    match v {
        Some(v) => T::from_js(v).unwrap_or_else(|e| {
            js::throw_error(&format!("a callback returned the wrong type: {}", e.reason));
            default()
        }),
        None => default(),
    }
}

/// Converts a value for a callback argument; on failure the error is kept and `undefined` sent.
pub fn arg_js<T: ToJs>(v: T) -> Value {
    v.to_js().unwrap_or_else(|e| {
        js::throw_error(&e.reason);
        undefined()
    })
}

/// A raw argument or result of a generated binding: conversions happen in the body.
#[derive(Clone, Copy)]
pub struct Raw(pub Value);

impl FromNapiValue for Raw {
    unsafe fn from_napi_value(_env: sys::napi_env, v: sys::napi_value) -> napi::Result<Self> {
        Ok(Raw(v))
    }
}
impl ToNapiValue for Raw {
    unsafe fn to_napi_value(_env: sys::napi_env, v: Self) -> napi::Result<sys::napi_value> {
        Ok(v.0)
    }
}
impl napi::bindgen_prelude::TypeName for Raw {
    fn type_name() -> &'static str {
        "unknown"
    }
    fn value_type() -> napi::ValueType {
        napi::ValueType::Unknown
    }
}
impl napi::bindgen_prelude::ValidateNapiValue for Raw {}

/// Runs a generated binding's body with this thread's env, turning a panic into an error.
pub fn guard<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    match js::binding(|| std::panic::catch_unwind(std::panic::AssertUnwindSafe(f))) {
        Ok(r) => r,
        Err(panic) => {
            let msg = panic.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| panic.downcast_ref::<String>().cloned()).unwrap_or_else(|| "a Rune call panicked".into());
            Err(err(msg))
        }
    }
}

/// A record whose fields can be written back into the JavaScript object it came from (after a
/// `&mut self` method).
pub trait Record: ToJs + Sized {
    fn write_back(self, obj: Value) -> Result<()>;
}

/// The element a closure returned, or the error view when it threw or returned something else.
pub fn ret_el(v: Option<Value>) -> rune::El {
    match v.map(|v| take::<crate::gen::rune::W_El>(v)) {
        Some(Ok(el)) => el,
        Some(Err(e)) => {
            js::throw_error(&e.reason);
            crate::state::error_view("a callback returned something that isn't an El")
        }
        None => crate::state::error_view("a callback threw"),
    }
}

/// A slot in a trampoline registry for JavaScript function `f`: the slot already holding it (or
/// a function with the same source, as a view re-creating `(s) => s.knobs` each run does), or a
/// new one. Errors once `max` functions are held.
pub fn register_fn(reg: &mut Vec<js::JsRef>, f: Value, max: usize) -> Result<usize> {
    if kind(f) != sys::ValueType::napi_function {
        return Err(err("expected a function"));
    }
    for (i, held) in reg.iter().enumerate() {
        let mut same = false;
        unsafe { sys::napi_strict_equals(env(), held.value(), f, &mut same) };
        if same {
            return Ok(i);
        }
    }
    let source = |v: Value| -> Option<String> {
        let mut s = ptr::null_mut();
        unsafe { sys::napi_coerce_to_string(env(), v, &mut s) };
        String::from_js(s).ok()
    };
    if let Some(src) = source(f) {
        for (i, held) in reg.iter_mut().enumerate() {
            if source(held.value()).as_deref() == Some(src.as_str()) {
                *held = js::JsRef::new(f);
                return Ok(i);
            }
        }
    }
    if reg.len() >= max {
        return Err(err(format!("more than {max} distinct functions passed where Rust takes a fn pointer")));
    }
    reg.push(js::JsRef::new(f));
    Ok(reg.len() - 1)
}

/// `Result<T, E>` as Rust's enum reads: `{ Ok: value }` or `{ Err: error }`.
impl<T: FromJs, E: FromJs> FromJs for std::result::Result<T, E> {
    fn from_js(v: Value) -> Result<Self> {
        match enum_tag(v, "Result")? {
            (tag, Some(p)) if tag == "Ok" => Ok(Ok(T::from_js(p)?)),
            (tag, Some(p)) if tag == "Err" => Ok(Err(E::from_js(p)?)),
            (tag, _) => Err(err(format!("{tag:?} isn't Ok or Err"))),
        }
    }
}
impl<T: ToJs, E: ToJs> ToJs for std::result::Result<T, E> {
    fn to_js(self) -> Result<Value> {
        Ok(match self {
            Ok(v) => tagged("Ok", v.to_js()?),
            Err(e) => tagged("Err", e.to_js()?),
        })
    }
}

/// `Range<T>` as Rust's fields: `{ start, end }`.
impl<T: FromJs> FromJs for std::ops::Range<T> {
    fn from_js(v: Value) -> Result<Self> {
        Ok(field::<T>(v, "Range", "start")?..field::<T>(v, "Range", "end")?)
    }
}
impl<T: ToJs> ToJs for std::ops::Range<T> {
    fn to_js(self) -> Result<Value> {
        let o = object();
        set(o, "start", self.start.to_js()?);
        set(o, "end", self.end.to_js()?);
        Ok(o)
    }
}

/// A shared string (a hover group's name, a text run's): a JavaScript string.
impl FromJs for std::rc::Rc<str> {
    fn from_js(v: Value) -> Result<Self> {
        Ok(String::from_js(v)?.into())
    }
}
impl ToJs for std::rc::Rc<str> {
    fn to_js(self) -> Result<Value> {
        self.to_string().to_js()
    }
}
impl FromJs for std::sync::Arc<str> {
    fn from_js(v: Value) -> Result<Self> {
        Ok(String::from_js(v)?.into())
    }
}
impl ToJs for std::sync::Arc<str> {
    fn to_js(self) -> Result<Value> {
        self.to_string().to_js()
    }
}

/// Shared bytes (an image's encoded data).
impl FromJs for std::sync::Arc<[u8]> {
    fn from_js(v: Value) -> Result<Self> {
        Ok(Vec::<u8>::from_js(v)?.into())
    }
}
impl ToJs for std::sync::Arc<[u8]> {
    fn to_js(self) -> Result<Value> {
        bytes_to_js(&self)
    }
}
