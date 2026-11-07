//! The `"ui"` pipeline: Rune draws the frame (its isolated layers, clips and transforms), and
//! each fx layer draws at the `El::effect` slot it's anchored to, in the slot's own pass. Slots
//! that ask for a backdrop (`El::effect_backdrop`) get a copy of what's beneath them, blurred
//! for frosted layers.

use rune::compose::Frame;
use rune::render::{EffectPhase, EffectSite};
use rune_fx::{FxFrame, FxLayer, FxOptions, FxRenderer, FxSlot, FxStats};

use super::plan::{Anchor, Plan};
use super::Options;
use crate::state::JsState;

#[derive(Default)]
pub(super) struct Ui {
    fx: Option<FxRenderer>,
}

impl Ui {
    pub fn render(&mut self, opts: &Options, f: &mut Frame<'_, JsState>, plan: Plan) -> FxStats {
        let (device, queue, size) = (f.device, f.queue, f.size);
        let mut at: Vec<u32> = Vec::with_capacity(plan.layers.len());
        let mut layers: Vec<FxLayer> = Vec::with_capacity(plan.layers.len());
        let mut placements: Vec<FxSlot> = Vec::with_capacity(plan.layers.len());
        for l in plan.layers {
            let Anchor::Slot(index) = l.at else { continue };
            // A slot index that isn't an effect this frame draws nowhere.
            let Some(i) = f.rt.instances.get(index as usize) else { continue };
            let placement = l.slot.unwrap_or_else(|| FxSlot::default().scale(i.params[3]).clip(i.clip, i.fade));
            at.push(index);
            layers.push(l.layer);
            placements.push(placement);
        }
        let fx = self.fx.get_or_insert_with(|| {
            let mut fx = FxRenderer::new(device, f.format, FxOptions { dither: opts.dither });
            if opts.fire_sim {
                fx.set_fire_sim(device, true);
            }
            fx
        });
        fx.set_srgb_blend(f.srgb_blend());
        fx.add_format(device, wgpu::TextureFormat::Rgba16Float);
        let scale = f.rt.env.scale;
        let stats = fx.prepare_with_slots(device, queue, &FxFrame { viewport: [size.0, size.1], scale, layers: &layers, backdrop: None, sources: &[] }, &placements);
        // Records nothing unless a simulated fire planned steps this frame.
        fx.simulate(queue, f.encoder, None);
        let clear = f.rt.clear_color();
        f.ui.prepare(device, queue, &mut f.rt.text.atlas, &f.rt.instances, size);
        let blur = opts.blur_backdrop;
        f.ui.draw_with_backdrop(f.encoder, f.target, clear, &mut |phase, s: &EffectSite<'_>| {
            match phase {
                EffectPhase::Backdrop(enc) => {
                    let Some(bd) = s.backdrop else { return };
                    for k in (0..at.len()).filter(|&k| at[k] == s.index) {
                        if blur {
                            fx.blur_backdrop(device, queue, enc, bd, k);
                        } else {
                            fx.set_layer_backdrop(device, bd, k);
                        }
                    }
                }
                EffectPhase::Draw(pass) => {
                    for k in (0..at.len()).filter(|&k| at[k] == s.index) {
                        fx.draw_layer_in(pass, s.format, s.origin, k);
                    }
                }
            }
        });
        stats
    }
}
