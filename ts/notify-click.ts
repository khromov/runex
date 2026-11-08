// `rune_notify::on_click` (src/manual/notify.rs): its handler runs on another thread in Rust, so
// the click crosses as a flat list and becomes a `Click` here.
import native from "./native.js"
import { notify_Click as Click } from "./gen/types.js"

/**
 * Calls `f` with each click on a notification this app posted (`rune_notify::on_click`):
 * the notification's id and the info it was posted with. On Windows a click on a toast after the
 * app quit starts the app again through its activation scheme instead (`click_from_url`).
 */
export function on_click(f: (click: Click) => void): void {
  ;(native as any).__notify_on_click((flat: string[]) => {
    const info: [string, string][] = []
    for (let i = 1; i + 1 < flat.length; i += 2) info.push([flat[i]!, flat[i + 1]!])
    f(new Click({ id: flat[0]!, info }))
  })
}
