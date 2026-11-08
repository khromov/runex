// runex-js/notify: Rust's `rune_notify` crate (generated, tools/bindgen), system notifications:
// toasts on Windows, `UNUserNotificationCenter` on macOS (only for a bundled, signed app, so a
// script run by `bun` or `node` posts nothing there; `available()` says so).
export * from "./gen/notify/index.js"
export { on_click } from "./notify-click.js"
