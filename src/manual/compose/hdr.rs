//! The `"hdr"` pipeline: the compositor draws the frame into one linear `Rgba16Float` scene and
//! resolves it into the target once, with TPDF dither.
//!
//! Per frame: route Rune's instances by `El::mark` (`Plan.routes`: the main list, a top list,
//! offscreen sources, the lighting pass's base and text), light the lit ones with rune-light
//! (`Plan.lighting`), then draw the main list with each fx layer inserted under or over the
//! marked range it's anchored to (copying the scene into the backdrop before a layer that reads
//! it), then the top list, then resolve.

use std::collections::HashMap;

use rune::compose::{Frame, is_glyph};
use rune::render::{Instance, KIND_GRADIENT, KIND_LAYER, KIND_LAYER_END, KIND_RECT};
use rune_fx::{FxFrame, FxLayer, FxOptions, FxRenderer, FxStats, MaskPyramid};
use rune_light::{Light, LightRenderer, Prim, Scene as LightScene};

use super::gpu::{HDR, Passes, Tex, Timer, pass, stamp, tex};
use super::plan::{Anchor, Background, Draw, LitAt, Lighting, Plan, Route, SourceKind};
use super::Options;
use crate::state::JsState;

enum Source {
    Layer(Tex),
    Mask(MaskPyramid),
}

impl Source {
    fn view(&self) -> &wgpu::TextureView {
        match self {
            Source::Layer(t) => &t.view,
            Source::Mask(p) => &p.view,
        }
    }
}

struct Res {
    size: (u32, u32),
    format: wgpu::TextureFormat,
    scene: Tex,
    backdrop: Tex,
    base: Tex,
    text: Tex,
    lit: Tex,
    sources: Vec<Source>,
    light: Option<LightRenderer>,
    fx: FxRenderer,
    passes: Passes,
    timer: Option<Timer>,
}

const RT: wgpu::TextureUsages = wgpu::TextureUsages::RENDER_ATTACHMENT.union(wgpu::TextureUsages::TEXTURE_BINDING);

impl Res {
    fn new(opts: &Options, f: &mut Frame<'_, JsState>) -> Res {
        use wgpu::TextureUsages as U;
        let (device, size) = (f.device, f.size);
        f.ui.add_format(device, HDR);
        let scene = tex(device, "runex compose scene", size, RT | U::COPY_SRC);
        let backdrop = tex(device, "runex compose backdrop", size, U::TEXTURE_BINDING | U::COPY_DST);
        let base = tex(device, "runex compose base", size, RT);
        let text = tex(device, "runex compose text", size, RT);
        let lit = tex(device, "runex compose lit", size, RT);
        let passes = Passes::new(device, f.format, &scene.view, &lit.view);
        let mut fx = FxRenderer::new(device, HDR, FxOptions { dither: opts.dither });
        if opts.fire_sim {
            fx.set_fire_sim(device, true);
        }
        let timer = if opts.timestamps { Timer::new(device, f.queue) } else { None };
        Res { size, format: f.format, scene, backdrop, base, text, lit, sources: Vec::new(), light: None, fx, passes, timer }
    }

    /// Makes source slot `i` the kind `kinds[i]` says; keeps slots past the plan's (and their
    /// contents) for a later plan that declares them again.
    fn ensure_sources(&mut self, device: &wgpu::Device, kinds: &[SourceKind]) {
        for (i, kind) in kinds.iter().enumerate() {
            let fits = matches!((self.sources.get(i), kind), (Some(Source::Layer(_)), SourceKind::Layer) | (Some(Source::Mask(_)), SourceKind::Mask));
            if fits {
                continue;
            }
            let made = match kind {
                SourceKind::Layer => Source::Layer(tex(device, "runex compose source", self.size, RT)),
                SourceKind::Mask => Source::Mask(MaskPyramid::new(device, self.size.0, self.size.1)),
            };
            if i < self.sources.len() {
                self.sources[i] = made;
            } else {
                self.sources.push(made);
            }
        }
    }
}

#[derive(Default)]
pub(super) struct Hdr {
    res: Option<Res>,
}

/// A rect's rune-light primitive, by the first rule its mark matches.
fn prim(l: &Lighting, ins: &Instance, mark: u32) -> Option<Prim> {
    if l.min_alpha.is_some_and(|min| ins.fill[3] < min) {
        return None;
    }
    let style = l.prims.iter().find(|r| r.m.matches(mark))?.style?;
    let a = ins.fill[3].max(1e-4);
    let albedo = [ins.fill[0] / a, ins.fill[1] / a, ins.fill[2] / a];
    Some(style.apply(Prim::from_rune(ins.rect, ins.radii).albedo(albedo), albedo))
}

fn shifted(mut ins: Instance, offset: Option<[f32; 2]>) -> Instance {
    if let Some([dx, dy]) = offset {
        ins.rect[0] += dx;
        ins.rect[1] += dy;
    }
    ins
}

enum Op {
    Blit,
    Fx(usize),
}

impl Hdr {
    /// Draws `plan`; returns the effects' stats and a GPU frame time when one was read back.
    pub fn render(&mut self, opts: &Options, f: &mut Frame<'_, JsState>, plan: Plan) -> (FxStats, Option<f32>) {
        if self.res.as_ref().is_none_or(|r| r.size != f.size || r.format != f.format) {
            self.res = Some(Res::new(opts, f));
        }
        let _ = f.device.poll(wgpu::PollType::Poll);
        let res = self.res.as_mut().unwrap();
        res.ensure_sources(f.device, &plan.sources);
        let gpu_ms = res.timer.as_mut().and_then(|t| t.begin(f.encoder));
        let (device, queue) = (f.device, f.queue);
        let rt = &mut *f.rt;
        let scale = rt.env.scale;
        let (w, h) = f.size;
        let lighting = plan.lighting.as_ref();

        // ---- route Rune's instances
        let inst = &rt.instances;
        let marks = &rt.marks;
        let mut main: Vec<Instance> = Vec::with_capacity(inst.len());
        let (mut base, mut text, mut top) = (Vec::new(), Vec::new(), Vec::new());
        let mut srcs: Vec<Vec<Instance>> = (0..plan.sources.len()).map(|_| Vec::new()).collect();
        let mut prims: Vec<Prim> = Vec::new();
        let mut first_lit: Option<usize> = None;
        // Per mark: the main list's length before its first instance and after its last.
        let mut spans: HashMap<u32, (usize, usize)> = HashMap::new();
        let mut bg_fill = [0.0, 0.0, 0.0, 1.0];
        let bg_mark = match lighting.map(|l| l.background) {
            Some(Background::Mark(m)) => Some(m),
            _ => None,
        };
        // A source no layer reads this frame gets nothing: its pass would be wasted.
        let read: Vec<bool> = (0..plan.sources.len()).map(|n| plan.layers.iter().any(|l| l.layer.source.is_some_and(|s| s.slot as usize == n))).collect();
        let mut opacity = 1.0f32;
        let mut opacity_stack = Vec::new();
        for (i, ins) in inst.iter().enumerate() {
            let mut ins = *ins;
            if plan.flatten_layers {
                if ins.params[1] == KIND_LAYER {
                    opacity_stack.push(opacity);
                    opacity *= ins.fill[3];
                    continue;
                }
                if ins.params[1] == KIND_LAYER_END {
                    opacity = opacity_stack.pop().unwrap_or(1.0);
                    continue;
                }
                ins.fill = ins.fill.map(|v| v * opacity);
                ins.border = ins.border.map(|v| v * opacity);
                if ins.params[1] == KIND_GRADIENT {
                    ins.uv = ins.uv.map(|v| v * opacity);
                }
            }
            let m = marks.get(i).copied().unwrap_or(0);
            if bg_mark.is_some_and(|b| b.matches(m)) && ins.params[1] == KIND_RECT {
                bg_fill = ins.fill;
            }
            let route = plan.routes.iter().find(|r| r.m.matches(m)).unwrap_or(&Route::MAIN);
            if route.draw == Draw::Top {
                top.push(shifted(ins, route.offset));
                continue;
            }
            spans.entry(m).or_insert((main.len(), main.len()));
            if let Some(l) = lighting.filter(|_| route.lit) {
                first_lit.get_or_insert(main.len());
                if is_glyph(&ins) {
                    text.push(ins);
                } else {
                    base.push(ins);
                    if ins.params[1] == KIND_RECT {
                        prims.extend(prim(l, &ins, m));
                    }
                }
            }
            match route.draw {
                Draw::Main => main.push(shifted(ins, route.offset)),
                Draw::Source(n) if read[n] => srcs[n].push(shifted(ins, route.offset)),
                Draw::Source(_) | Draw::None | Draw::Top => {}
            }
            if let Some(n) = route.also.filter(|&n| read[n]) {
                srcs[n].push(ins);
            }
            if let Some(span) = spans.get_mut(&m) {
                span.1 = main.len();
            }
        }

        // ---- where the lit image and each effect layer go in the main list
        let end = main.len();
        let resolve = |a: Anchor| -> Option<usize> {
            match a {
                Anchor::Top => Some(end),
                Anchor::Under(mm) => spans.iter().filter(|(k, _)| mm.matches(**k)).map(|(_, s)| s.0).min(),
                Anchor::Over(mm) => spans.iter().filter(|(k, _)| mm.matches(**k)).map(|(_, s)| s.1).max(),
                Anchor::Slot(_) => None,
            }
        };
        let lit_on = lighting.is_some() && !base.is_empty();
        let lit_pos = match lighting.filter(|_| lit_on).map(|l| l.at) {
            Some(LitAt::First) => first_lit,
            Some(LitAt::Anchor(a)) => resolve(a),
            None => None,
        };
        let mut ops: Vec<(usize, Op)> = Vec::new();
        if let Some(p) = lit_pos {
            ops.push((p, Op::Blit));
        }
        let lift = lit_on && lighting.is_some_and(|l| l.effects_on_top);
        let mut layers: Vec<FxLayer> = Vec::with_capacity(plan.layers.len());
        let mut needs_bd: Vec<bool> = Vec::with_capacity(plan.layers.len());
        for l in plan.layers {
            let Some(pos) = resolve(l.at) else { continue };
            let pos = if lift { lit_pos.unwrap_or(pos) } else { pos };
            needs_bd.push(l.layer.fx.needs_backdrop());
            ops.push((pos, Op::Fx(layers.len())));
            layers.push(l.layer);
        }
        // Rune draws an isolated layer (`KIND_LAYER` .. `KIND_LAYER_END`, an element fading, say) in
        // one piece: a position inside one moves to just after it, where Rust's `draw_range`
        // would panic ("must not split a layer scope").
        let mut depth = 0i32;
        let mut whole: Vec<bool> = Vec::with_capacity(end + 1);
        for ins in &main {
            whole.push(depth == 0);
            depth += i32::from(ins.params[1] == KIND_LAYER) - i32::from(ins.params[1] == KIND_LAYER_END);
        }
        whole.push(true);
        for (pos, _) in &mut ops {
            while !whole[*pos] {
                *pos += 1;
            }
        }
        ops.sort_by_key(|o| o.0);

        // ---- upload
        let clear = rt.clear_color();
        let mut lists: Vec<&[Instance]> = vec![&main, &base, &text];
        lists.extend(srcs.iter().map(Vec::as_slice));
        lists.push(&top);
        let ranges = f.ui.prepare_lists(device, queue, &mut rt.text.atlas, &lists, f.size);
        let top_range = ranges[ranges.len() - 1].clone();
        let views: Vec<&wgpu::TextureView> = res.sources.iter().take(plan.sources.len()).map(Source::view).collect();
        let stats = res.fx.prepare(device, queue, &FxFrame { viewport: [w, h], scale, layers: &layers, backdrop: Some(&res.backdrop.view), sources: &views });

        // ---- offscreen passes: sources, then lighting
        let enc = &mut *f.encoder;
        let query = res.timer.as_ref().and_then(Timer::query);
        let mut began = false;
        for (k, source) in res.sources.iter().take(plan.sources.len()).enumerate() {
            if srcs[k].is_empty() {
                continue;
            }
            let range = ranges[3 + k].clone();
            match source {
                Source::Mask(p) => {
                    {
                        let mut rp = pass(enc, &p.levels[0], Some([0.0; 4]), stamp(&query, &mut began, false));
                        f.ui.draw_range(&mut rp, HDR, range);
                    }
                    res.fx.build_mips(device, enc, p);
                }
                Source::Layer(t) => {
                    let mut rp = pass(enc, &t.view, Some([0.0; 4]), stamp(&query, &mut began, false));
                    f.ui.draw_range(&mut rp, HDR, range);
                }
            }
        }
        let mut lit_drawn = false;
        if let Some(l) = lighting.filter(|_| lit_on) {
            let bg = match l.background {
                Background::Clear => clear,
                Background::Mark(_) => bg_fill,
            };
            let a = bg[3].max(1e-4);
            {
                let mut rp = pass(enc, &res.base.view, Some([bg[0] / a, bg[1] / a, bg[2] / a, 1.0]), stamp(&query, &mut began, false));
                f.ui.draw_range(&mut rp, HDR, ranges[1].clone());
            }
            {
                let mut rp = pass(enc, &res.text.view, Some([0.0; 4]), None);
                f.ui.draw_range(&mut rp, HDR, ranges[2].clone());
            }
            let mut lights: Vec<Light> = l.lights.clone();
            if lights.is_empty() {
                // Ambient only: one dark light keeps the pass running.
                lights.push(Light::point(0.0, 0.0, 1.0).intensity(0.0));
            }
            let light = res.light.get_or_insert_with(|| LightRenderer::new(device, queue, w, h, HDR));
            lit_drawn = light.render(device, queue, enc, &LightScene { prims: &prims, lights: &lights, settings: l.settings.clone(), emission: None }, &res.base.view, &res.text.view, &res.lit.view);
            queue.write_buffer(&res.passes.blit_alpha, 0, bytemuck::cast_slice(&[l.alpha, 0.0, 0.0, 0.0]));
        }
        // The clip in device pixels: the scissor for effects and the lit image.
        let clip = plan.clip.map(|r| {
            let px = |v: f32| (v * scale).round().max(0.0) as u32;
            let (sx, sy) = (px(r[0]).min(w), px(r[1]).min(h));
            [sx, sy, px(r[0] + r[2]).min(w).saturating_sub(sx), px(r[1] + r[3]).min(h).saturating_sub(sy)]
        });
        let clipped_away = clip.is_some_and(|c| c[2] == 0 || c[3] == 0);
        if res.fx.simulate_pending() {
            let ts = stamp(&query, &mut began, false).map(|w| wgpu::ComputePassTimestampWrites {
                query_set: w.query_set,
                beginning_of_pass_write_index: w.beginning_of_pass_write_index,
                end_of_pass_write_index: w.end_of_pass_write_index,
            });
            res.fx.simulate(queue, enc, ts);
        }

        // ---- the scene: the main list with the lit image and effect layers in place, then the top list
        let main_range = ranges[0].clone();
        let mut cursor = 0usize;
        let mut rp = pass(enc, &res.scene.view, Some(clear), stamp(&query, &mut began, false)).forget_lifetime();
        for (pos, op) in ops {
            if pos > cursor {
                if clip.is_some() {
                    rp.set_scissor_rect(0, 0, w, h);
                }
                f.ui.draw_range(&mut rp, HDR, main_range.start + cursor as u32..main_range.start + pos as u32);
                cursor = pos;
            }
            match op {
                Op::Blit => {
                    if lit_drawn && !clipped_away {
                        if let Some([sx, sy, sw, sh]) = clip {
                            rp.set_scissor_rect(sx, sy, sw, sh);
                        }
                        rp.set_pipeline(&res.passes.blit.pipeline);
                        rp.set_bind_group(0, &res.passes.blit_bg, &[]);
                        rp.draw(0..3, 0..1);
                    }
                }
                Op::Fx(i) => {
                    if clipped_away {
                        continue;
                    }
                    if needs_bd[i] {
                        drop(rp);
                        let [x, y, cw, ch] = clip.unwrap_or([0, 0, w, h]);
                        let origin = wgpu::Origin3d { x, y, z: 0 };
                        enc.copy_texture_to_texture(
                            wgpu::TexelCopyTextureInfo { texture: &res.scene.tex, mip_level: 0, origin, aspect: wgpu::TextureAspect::All },
                            wgpu::TexelCopyTextureInfo { texture: &res.backdrop.tex, mip_level: 0, origin, aspect: wgpu::TextureAspect::All },
                            wgpu::Extent3d { width: cw, height: ch, depth_or_array_layers: 1 },
                        );
                        if opts.blur_backdrop {
                            res.fx.blur_backdrop(device, queue, enc, &res.backdrop.view, i);
                        }
                        rp = pass(enc, &res.scene.view, None, None).forget_lifetime();
                    }
                    if let Some([sx, sy, sw, sh]) = clip {
                        rp.set_scissor_rect(sx, sy, sw, sh);
                    }
                    res.fx.draw_layer(&mut rp, i);
                }
            }
        }
        if cursor < end {
            if clip.is_some() {
                rp.set_scissor_rect(0, 0, w, h);
            }
            f.ui.draw_range(&mut rp, HDR, main_range.start + cursor as u32..main_range.end);
        }
        if !top_range.is_empty() {
            if clip.is_some() {
                rp.set_scissor_rect(0, 0, w, h);
            }
            f.ui.draw_range(&mut rp, HDR, top_range);
        }
        drop(rp);

        // ---- resolve
        {
            let mut rp = pass(enc, f.target, Some([0.0, 0.0, 0.0, 1.0]), stamp(&query, &mut began, true));
            rp.set_pipeline(&res.passes.resolve.pipeline);
            rp.set_bind_group(0, &res.passes.resolve_bg, &[]);
            rp.draw(0..3, 0..1);
        }
        if let Some(tm) = res.timer.as_mut() {
            tm.end();
        }
        (stats, gpu_ms)
    }
}
