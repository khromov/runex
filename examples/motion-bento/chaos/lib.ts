// The motion bento's shared parts, used by its Rune build and its GPUI build alike: the command
// line, a seeded RNG, the chaos schedule, the tiles' logical state (`Model`), the springs and
// colours both builds animate with, and the frame meter that writes `metrics.json`.
//
// Nothing here draws. Each framework turns a `Model` into its own view and animates the change
// from the last one with its own springs, using the durations and bounces in `look`.
//
// Port of vendor/rune/examples/motion-bento/chaos/src/lib.rs (the `motion-bento-chaos` crate).
// fmt.ts has no Rust counterpart: it is the part of Rust's std formatting and parsing that
// JavaScript's differs from. The crate has a module and a function both called `schedule`; as in
// runex's own bindings, the function wins at that name (import the module's items from
// ./schedule.ts).

export * as config from "./config.ts"
export * as hud from "./hud.ts"
export * as look from "./look.ts"
export * as meter from "./meter.ts"
export * as model from "./model.ts"
export * as rng from "./rng.ts"
export * as stress from "./stress.ts"

export { Config } from "./config.ts"
export { Meter } from "./meter.ts"
export { Action, Model } from "./model.ts"
export { Rng } from "./rng.ts"
export { type Event, Player, schedule, script_json } from "./schedule.ts"
