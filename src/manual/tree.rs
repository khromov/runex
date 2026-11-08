//! `rune_kit::Tree` and `TreeModel`, whose node type is the app's (`TreeModel<T>`): in runex a
//! node is any JavaScript value, held by reference, so `get` and `get_mut` hand back the same
//! object and changes to it show on the next build. `Tree::new` takes `fn` pointers that find the
//! model in the state; as for generated `fn` parameters, each distinct JavaScript function takes
//! one of a fixed number of trampolines. ts/tree.ts adds the typed facade, `FileNode` and
//! `FileTree`, whose `build` lays files out with Rune's own `FileTree::build`.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::rc::Rc;

use napi_derive::napi;

use crate::conv::{self, Class, FromJs, Raw, Slot, ToJs};
use crate::js::{self, JsRef};
use crate::state::{AppFns, JsState};

type Model = rune_kit::TreeModel<JsRef>;

/// The tree's data (`rune_kit::TreeModel<T>`): nodes by id, their order, which are open, the
/// selection and the keyboard cursor. Nodes are JavaScript values.
#[napi(js_name = "kit_TreeModel")]
pub struct TreeModel {
    slot: Slot<Model>,
}

impl Class for TreeModel {
    type Inner = Model;
    const NAME: &'static str = "TreeModel";
    fn wrap(slot: Slot<Model>) -> Self {
        TreeModel { slot }
    }
    fn slot(&mut self) -> &mut Slot<Model> {
        &mut self.slot
    }
}

fn or_null(v: Option<&JsRef>) -> Raw {
    Raw(v.map_or_else(conv::null, JsRef::value))
}

fn tx_of(v: Raw) -> napi::Result<&'static mut rune::Tx> {
    let mut i = conv::instance::<crate::gen::rune::W_Tx>(v.0)?;
    let tx = i.slot().get_mut("Tx")? as *mut rune::Tx;
    // SAFETY: a Tx only exists lent to a handler, for the length of the call this runs in.
    Ok(unsafe { &mut *tx })
}

/// A label a JavaScript function returned, as the `&str` Rune reads at once: interned, so a
/// tree's labels leak once each, as element roles and titles do.
fn label_of(f: &crate::state::Handler, node: &JsRef) -> &'static str {
    let r = f.call(&[node.value()]);
    r.and_then(|v| String::from_js(v).ok()).map_or("", |s| crate::util::intern(&s))
}

#[napi]
impl TreeModel {
    /// An empty tree.
    #[napi(js_name = "new", ts_return_type = "TreeModel")]
    pub fn new() -> TreeModel {
        TreeModel { slot: Slot::Owned(Model::new()) }
    }
    #[napi(js_name = "default", ts_return_type = "TreeModel")]
    pub fn default() -> TreeModel {
        TreeModel::new()
    }
    /// The key prefix of the tree's rows (`"tree"` by default).
    #[napi(js_name = "key", ts_return_type = "this")]
    pub fn key<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, key: String) -> napi::Result<napi::bindgen_prelude::This<'t>> {
        let m = self.slot.take(Self::NAME)?;
        self.slot = Slot::Owned(m.key(key));
        Ok(this)
    }
    /// Shift extends and Cmd toggles the selection on a click (off: a click selects one row).
    #[napi(js_name = "multi_select", ts_return_type = "this")]
    pub fn multi_select<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, on: bool) -> napi::Result<napi::bindgen_prelude::This<'t>> {
        let m = self.slot.take(Self::NAME)?;
        self.slot = Slot::Owned(m.multi_select(on));
        Ok(this)
    }
    /// Adds `data` as `id` under `parent` (`null`: at the top), after its siblings. False when
    /// `id` is taken or `parent` doesn't exist.
    #[napi(js_name = "insert", ts_args_type = "parent: string | null, id: string, data: any")]
    pub fn insert(&mut self, parent: Option<String>, id: String, data: Raw) -> napi::Result<bool> {
        Ok(self.slot.get_mut(Self::NAME)?.insert(parent.as_deref(), id, JsRef::new(data.0)))
    }
    #[napi(js_name = "clear")]
    pub fn clear(&mut self) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.clear();
        Ok(())
    }
    #[napi(js_name = "len")]
    pub fn len(&self) -> napi::Result<u32> {
        Ok(self.slot.get(Self::NAME)?.len() as u32)
    }
    #[napi(js_name = "is_empty")]
    pub fn is_empty(&self) -> napi::Result<bool> {
        Ok(self.slot.get(Self::NAME)?.is_empty())
    }
    #[napi(js_name = "contains")]
    pub fn contains(&self, id: String) -> napi::Result<bool> {
        Ok(self.slot.get(Self::NAME)?.contains(&id))
    }
    /// The node `id`, or `null`.
    #[napi(js_name = "get", ts_return_type = "any")]
    pub fn get(&self, id: String) -> napi::Result<Raw> {
        Ok(or_null(self.slot.get(Self::NAME)?.get(&id)))
    }
    /// The node `id`, or `null`: the same object `get` returns, which JavaScript changes in place.
    #[napi(js_name = "get_mut", ts_return_type = "any")]
    pub fn get_mut(&mut self, id: String) -> napi::Result<Raw> {
        Ok(or_null(self.slot.get_mut(Self::NAME)?.get_mut(&id).map(|v| &*v)))
    }
    #[napi(js_name = "parent")]
    pub fn parent(&self, id: String) -> napi::Result<Option<String>> {
        Ok(self.slot.get(Self::NAME)?.parent(&id).map(str::to_owned))
    }
    /// The ids under `id` (`null`: the top level), in order.
    #[napi(js_name = "children")]
    pub fn children(&self, id: Option<String>) -> napi::Result<Vec<String>> {
        Ok(self.slot.get(Self::NAME)?.children(id.as_deref()).map(str::to_owned).collect())
    }
    #[napi(js_name = "has_children")]
    pub fn has_children(&self, id: String) -> napi::Result<bool> {
        Ok(self.slot.get(Self::NAME)?.has_children(&id))
    }
    /// 0 at the top level; `null` for an unknown id.
    #[napi(js_name = "depth")]
    pub fn depth(&self, id: String) -> napi::Result<Option<u32>> {
        Ok(self.slot.get(Self::NAME)?.depth(&id))
    }
    /// `id`'s node and every node under it.
    #[napi(js_name = "subtree", ts_return_type = "any[]")]
    pub fn subtree(&self, id: String) -> napi::Result<Raw> {
        Ok(Raw(conv::array(self.slot.get(Self::NAME)?.subtree(&id).map(JsRef::value))))
    }
    /// Orders every node's children (and the top level) by `cmp`, which returns a negative
    /// number, 0 or a positive one, as a sort comparator does.
    #[napi(js_name = "sort_by", ts_args_type = "cmp: (a: any, b: any) => number")]
    pub fn sort_by(&mut self, cmp: conv::Raw) -> napi::Result<()> {
        let f = conv::arg::<conv::JsFn>(cmp.0, "cmp")?.0;
        let m = self.slot.get_mut(Self::NAME)?;
        m.sort_by(|a, b| {
            let r = f.call(&[a.value(), b.value()]).and_then(|v| f64::from_js(v).ok()).unwrap_or(0.0);
            r.partial_cmp(&0.0).unwrap_or(Ordering::Equal)
        });
        Ok(())
    }
    /// Whether `id` shows its children.
    #[napi(js_name = "is_expanded")]
    pub fn is_expanded(&self, id: String) -> napi::Result<bool> {
        Ok(self.slot.get(Self::NAME)?.is_expanded(&id))
    }
    #[napi(js_name = "set_expanded")]
    pub fn set_expanded(&mut self, id: String, open: bool) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.set_expanded(&id, open);
        Ok(())
    }
    #[napi(js_name = "toggle")]
    pub fn toggle(&mut self, id: String) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.toggle(&id);
        Ok(())
    }
    #[napi(js_name = "expand_all")]
    pub fn expand_all(&mut self) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.expand_all();
        Ok(())
    }
    #[napi(js_name = "collapse_all")]
    pub fn collapse_all(&mut self) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.collapse_all();
        Ok(())
    }
    /// Opens every folder above `id`, so its row shows.
    #[napi(js_name = "expand_to")]
    pub fn expand_to(&mut self, id: String) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.expand_to(&id);
        Ok(())
    }
    /// The selected ids, in tree order.
    #[napi(js_name = "selected")]
    pub fn selected(&self) -> napi::Result<Vec<String>> {
        Ok(self.slot.get(Self::NAME)?.selected().map(str::to_owned).collect())
    }
    #[napi(js_name = "is_selected")]
    pub fn is_selected(&self, id: String) -> napi::Result<bool> {
        Ok(self.slot.get(Self::NAME)?.is_selected(&id))
    }
    /// The row the keyboard cursor is on.
    #[napi(js_name = "cursor")]
    pub fn cursor(&self) -> napi::Result<Option<String>> {
        Ok(self.slot.get(Self::NAME)?.cursor().map(str::to_owned))
    }
    #[napi(js_name = "clear_selection")]
    pub fn clear_selection(&mut self) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.clear_selection();
        Ok(())
    }
    /// Selects `id` alone and puts the cursor on it.
    #[napi(js_name = "select")]
    pub fn select(&mut self, id: String) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.select(&id);
        Ok(())
    }
    #[napi(js_name = "set_selected")]
    pub fn set_selected(&mut self, id: String, on: bool) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.set_selected(&id, on);
        Ok(())
    }
    #[napi(js_name = "select_range")]
    pub fn select_range(&mut self, id: String) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.select_range(&id);
        Ok(())
    }
    /// A click on `id` with `mods` held; true for a plain click (one that selects `id` alone).
    #[napi(js_name = "click", ts_args_type = "id: string, mods: Mods")]
    pub fn click(&mut self, id: String, mods: Raw) -> napi::Result<bool> {
        let mods = conv::arg::<rune::Mods>(mods.0, "mods")?;
        Ok(self.slot.get_mut(Self::NAME)?.click(&id, mods))
    }
    /// Opens the folders above `id`, moves the cursor to it and scrolls its row into view.
    #[napi(js_name = "reveal", ts_args_type = "id: string, tx: Tx")]
    pub fn reveal(&mut self, id: String, tx: Raw) -> napi::Result<bool> {
        let tx = tx_of(tx)?;
        Ok(self.slot.get_mut(Self::NAME)?.reveal(&id, tx))
    }
    /// Shows only the nodes `keep` accepts and the folders leading to them, open.
    #[napi(js_name = "filter", ts_args_type = "keep: (node: any) => boolean")]
    pub fn filter(&mut self, keep: Raw) -> napi::Result<()> {
        let f = conv::arg::<conv::JsFn>(keep.0, "keep")?.0;
        self.slot.get_mut(Self::NAME)?.filter(|n| f.call(&[n.value()]).is_some_and(js::is_truthy));
        Ok(())
    }
    #[napi(js_name = "clear_filter")]
    pub fn clear_filter(&mut self) -> napi::Result<()> {
        self.slot.get_mut(Self::NAME)?.clear_filter();
        Ok(())
    }
    #[napi(js_name = "is_filtering")]
    pub fn is_filtering(&self) -> napi::Result<bool> {
        Ok(self.slot.get(Self::NAME)?.is_filtering())
    }
    #[napi(js_name = "is_match")]
    pub fn is_match(&self, id: String) -> napi::Result<bool> {
        Ok(self.slot.get(Self::NAME)?.is_match(&id))
    }
    /// How many rows show (open folders' children, under the filter).
    #[napi(js_name = "visible_len")]
    pub fn visible_len(&self) -> napi::Result<u32> {
        Ok(self.slot.get(Self::NAME)?.visible_len() as u32)
    }
    #[napi(js_name = "visible_id")]
    pub fn visible_id(&self, row: u32) -> napi::Result<Option<String>> {
        Ok(self.slot.get(Self::NAME)?.visible_id(row as usize).map(str::to_owned))
    }
    #[napi(js_name = "visible_row")]
    pub fn visible_row(&self, id: String) -> napi::Result<Option<u32>> {
        Ok(self.slot.get(Self::NAME)?.visible_row(&id).map(|r| r as u32))
    }
    /// Shown row `row`: its node and its state, or `null`.
    #[napi(js_name = "row", ts_return_type = "[any, TreeRow] | null")]
    pub fn row(&self, row: u32) -> napi::Result<Raw> {
        let Some((data, r)) = self.slot.get(Self::NAME)?.row(row as usize) else { return Ok(Raw(conv::null())) };
        let id = crate::util::intern(r.id);
        // SAFETY: only the id borrows the model, and it's replaced by an interned copy.
        let mut owned: rune_kit::TreeRow<'static> = unsafe { std::mem::transmute::<rune_kit::TreeRow<'_>, rune_kit::TreeRow<'static>>(r) };
        owned.id = id;
        let row = conv::owned::<crate::gen::kit::W_kit_TreeRow>(owned)?;
        Ok(Raw(conv::array([data.value(), row])))
    }
    /// Arrow keys move the cursor and open or close folders, Return opens, typing jumps by
    /// `label`; what the key did.
    #[napi(js_name = "handle_key", ts_args_type = "ev: KeyEvent, label: (node: any) => string, tx: Tx", ts_return_type = "TreeKey")]
    pub fn handle_key(&mut self, ev: Raw, label: Raw, tx: Raw) -> napi::Result<Raw> {
        let ev = conv::arg::<rune::KeyEvent>(ev.0, "ev")?;
        let f = conv::arg::<conv::JsFn>(label.0, "label")?.0;
        let tx = tx_of(tx)?;
        let key = self.slot.get_mut(Self::NAME)?.handle_key(&ev, |n| label_of(&f, n), tx);
        Ok(Raw(key.to_js()?))
    }
}

/// The model inside the `TreeModel` a JavaScript getter returned, for `Tree`'s `fn` pointers.
/// A failed getter throws (after the call) and stands in an empty model.
fn model_in(v: Option<conv::Value>) -> *mut Model {
    if let Some(v) = v {
        match conv::instance::<TreeModel>(v).and_then(|mut i| i.slot().get_mut("TreeModel").map(|m| m as *mut Model)) {
            Ok(m) => return m,
            Err(e) => js::throw_error(&format!("a Tree's getter must return its TreeModel: {}", e.reason)),
        }
    }
    Box::leak(Box::new(Model::new()))
}

thread_local! {
    static GETS: RefCell<Vec<JsRef>> = const { RefCell::new(Vec::new()) };
    static GET_MUTS: RefCell<Vec<JsRef>> = const { RefCell::new(Vec::new()) };
    static LABELS: RefCell<Vec<JsRef>> = const { RefCell::new(Vec::new()) };
}

fn call_in(reg: &'static std::thread::LocalKey<RefCell<Vec<JsRef>>>, i: usize, args: &[conv::Value]) -> Option<conv::Value> {
    let f = reg.with(|r| r.borrow().get(i).map(JsRef::value));
    f.and_then(|f| js::call(f, args))
}

fn get<const I: usize>(s: &JsState) -> &Model {
    // SAFETY: the state holds the model's instance for the synchronous use Rune makes of it.
    js::scope(|| unsafe { &*model_in(call_in(&GETS, I, &[s.value()])) })
}

fn get_mut<const I: usize>(s: &mut JsState) -> &mut Model {
    // SAFETY: as for `get`.
    js::scope(|| unsafe { &mut *model_in(call_in(&GET_MUTS, I, &[s.value()])) })
}

fn label<const I: usize>(n: &JsRef) -> &str {
    js::scope(|| {
        let r = call_in(&LABELS, I, &[n.value()]);
        r.and_then(|v| String::from_js(v).ok()).map_or("", |s| crate::util::intern(&s))
    })
}

macro_rules! table {
    ($f:ident; $($i:literal)*) => { [$($f::<$i>),*] };
}

const SLOTS: usize = 32;
static GET: [fn(&JsState) -> &Model; SLOTS] = table!(get; 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31);
static GET_MUT: [fn(&mut JsState) -> &mut Model; SLOTS] = table!(get_mut; 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31);
static LABEL: [fn(&JsRef) -> &str; SLOTS] = table!(label; 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31);

fn slot_in(reg: &'static std::thread::LocalKey<RefCell<Vec<JsRef>>>, f: conv::Value, what: &str) -> napi::Result<usize> {
    reg.with(|r| conv::register_fn(&mut r.borrow_mut(), f, SLOTS)).map_err(|e| conv::err(format!("{what}: {}", e.reason)))
}

/// A virtualised tree over a `TreeModel` in the app's state (`rune_kit::Tree`).
#[napi(js_name = "kit_Tree")]
pub struct Tree {
    inner: Option<rune_kit::Tree<JsState, JsRef>>,
}

impl Tree {
    fn map(&mut self, f: impl FnOnce(rune_kit::Tree<JsState, JsRef>) -> rune_kit::Tree<JsState, JsRef>) -> napi::Result<()> {
        let t = self.inner.take().ok_or_else(|| conv::err("this Tree was already built"))?;
        self.inner = Some(f(t));
        Ok(())
    }
}

fn state_handler(f: Rc<crate::state::Handler>) -> impl Fn(&mut JsState, &str, &mut rune::Tx) + 'static {
    move |s: &mut JsState, id: &str, tx: &mut rune::Tx| {
        js::scope(|| {
            let v = s.value();
            let r = crate::state::lend_tx(tx, |tx| f.call(&[v, conv::arg_js(id.to_owned()), tx]));
            crate::state::replace_from(s, r);
        })
    }
}

#[napi]
impl Tree {
    /// `get` and `get_mut` find the model in the state; `label` names a node (rows show it, and
    /// typing jumps by it). Each takes one of a fixed number of slots per distinct function, so
    /// pass the same functions (or functions with the same source) every build.
    #[napi(js_name = "new", ts_args_type = "get: (s: any) => TreeModel, get_mut: (s: any) => TreeModel, label: (node: any) => string", ts_return_type = "Tree")]
    pub fn new(get: Raw, get_mut: Raw, label: Raw) -> napi::Result<Tree> {
        let g = GET[slot_in(&GETS, get.0, "get")?];
        let gm = GET_MUT[slot_in(&GET_MUTS, get_mut.0, "get_mut")?];
        let l = LABEL[slot_in(&LABELS, label.0, "label")?];
        Ok(Tree { inner: Some(rune_kit::Tree::new(g, gm, l)) })
    }
    /// What each row shows (`f(node, row)` returns a `TreeItem`); by default its label alone.
    #[napi(js_name = "row", ts_args_type = "f: (node: any, row: TreeRow) => TreeItem", ts_return_type = "this")]
    pub fn row<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
        let f = conv::arg::<conv::JsFn>(f.0, "f")?.0;
        self.map(move |t| {
            t.row(move |n: &JsRef, r: &rune_kit::TreeRow<'_>| -> rune_kit::TreeItem {
                js::scope(|| {
                    // SAFETY: lent for the length of the call; the instance expires after it.
                    let r: &rune_kit::TreeRow<'static> = unsafe { std::mem::transmute::<&rune_kit::TreeRow<'_>, &rune_kit::TreeRow<'static>>(r) };
                    let out = conv::lend_ref::<crate::gen::kit::W_kit_TreeRow, _>(r, |rv| f.call(&[n.value(), rv]));
                    match out.map(conv::take::<crate::gen::kit::W_kit_TreeItem>) {
                        Some(Ok(item)) => item,
                        Some(Err(e)) => {
                            js::throw_error(&format!("a Tree's row must return a TreeItem: {}", e.reason));
                            rune_kit::TreeItem::new(r.id)
                        }
                        None => rune_kit::TreeItem::new(r.id),
                    }
                })
            })
        })?;
        Ok(this)
    }
    /// The cursor moved to `id`, by click or key.
    #[napi(js_name = "on_select", ts_args_type = "f: (s: any, id: string, tx: Tx) => void", ts_return_type = "this")]
    pub fn on_select<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
        let f = conv::arg::<conv::JsFn>(f.0, "f")?.0;
        self.map(move |t| t.on_select(state_handler(f)))?;
        Ok(this)
    }
    /// A row without children was double-clicked, or Return or Space pressed on it.
    #[napi(js_name = "on_open", ts_args_type = "f: (s: any, id: string, tx: Tx) => void", ts_return_type = "this")]
    pub fn on_open<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, f: Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
        let f = conv::arg::<conv::JsFn>(f.0, "f")?.0;
        self.map(move |t| t.on_open(state_handler(f)))?;
        Ok(this)
    }
    #[napi(js_name = "style", ts_args_type = "s: TreeStyle", ts_return_type = "this")]
    pub fn style<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, s: Raw) -> napi::Result<napi::bindgen_prelude::This<'t>> {
        let s = conv::take_or_clone::<crate::gen::kit::W_kit_TreeStyle>(s.0)?;
        self.map(move |t| t.style(s))?;
        Ok(this)
    }
    /// The tree's accessibility label ("Files").
    #[napi(js_name = "name", ts_return_type = "this")]
    pub fn name<'t>(&mut self, this: napi::bindgen_prelude::This<'t>, n: String) -> napi::Result<napi::bindgen_prelude::This<'t>> {
        self.map(move |t| t.name(n))?;
        Ok(this)
    }
    /// The tree, filling the height its parent gives it (set one with `.h(..)` or `.grow(..)`).
    #[napi(js_name = "build", ts_args_type = "s: any, k: Kit", ts_return_type = "El")]
    pub fn build(&mut self, s: Raw, k: Raw) -> napi::Result<Raw> {
        let t = self.inner.take().ok_or_else(|| conv::err("this Tree was already built"))?;
        conv::guard(|| {
            let mut ki = conv::instance::<crate::gen::kit::W_kit_Kit>(k.0)?;
            let k = ki.slot().get("Kit")?;
            let state = JsState { value: JsRef::new(s.0), fns: Rc::new(AppFns::default()) };
            Ok(Raw(conv::owned::<crate::gen::rune::W_El>(t.build(&state, k))?))
        })
    }
}

/// `rune_kit::FileTree::build`'s layout of `paths`, for ts/tree.ts's `FileTree.build`: each node in
/// tree order as `[parent, path, name, dir, file]`, where `file` is the index of the path a file
/// came from (-1 for a folder).
#[napi(js_name = "__kit_file_tree_layout", ts_return_type = "[string | null, string, string, boolean, number][]")]
pub fn file_tree_layout(paths: Vec<String>, compact: bool, dirs_first: bool, key: String) -> napi::Result<Raw> {
    let model = rune_kit::FileTree::new().compact_folders(compact).dirs_first(dirs_first).key(key).build(paths.iter().enumerate().map(|(i, p)| (p.as_str(), i)));
    fn walk(m: &rune_kit::TreeModel<rune_kit::FileNode<usize>>, parent: Option<&str>, out: &mut Vec<conv::Value>) -> conv::Result<()> {
        let ids: Vec<String> = m.children(parent).map(str::to_owned).collect();
        for id in ids {
            let Some(n) = m.get(&id) else { continue };
            let file = n.data.map_or(-1.0, |i| i as f64);
            out.push(conv::array([parent.map(str::to_owned).to_js()?, n.path.clone().to_js()?, n.name.clone().to_js()?, n.dir.to_js()?, file.to_js()?]));
            walk(m, Some(&id), out)?;
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(&model, None, &mut out)?;
    Ok(Raw(conv::array(out)))
}
