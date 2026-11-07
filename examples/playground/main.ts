// A small preferences window with a playground (⌘⇧D): its scenes, a live page, a story with its
// own state and timer, and an overlay, grouped by type, with triggers, variants (1–9) and a
// side-column control. "Controls" nests groups inside it by path ("Controls/Switches/Toggle")
// and comes first in the list. Every group starts folded but the open story's, and a click on
// a group's header folds or unfolds it; / filters the list. "Every device" scrolls its stage,
// and "Windows/Preferences" fills it edge to edge.
//
// `bun examples/playground/main.ts` shows the bar along the bottom; `-- --playground "Upload"` opens
// the playground at that story, and `-- --snap out.png --playground` renders it headless;
// `--variant "Long names"` beside `--playground "Many devices"` picks a variant.

import { App, AppSpec, Color, type Cx, type El, OverlaySpec, type Play, Playground, Story, type Tx, col, el, row, text, tok } from "runex-js"
const { motion, radius, type_ } = tok
type Theme = tok.Theme

const Section = { General: "General", Sync: "Sync", Devices: "Devices" } as const
type Section = (typeof Section)[keyof typeof Section]

const SECTIONS: [Section, string][] = [[Section.General, "General"], [Section.Sync, "Sync"], [Section.Devices, "Devices"]]

type Prefs = {
  section: Section
  launch_at_login: boolean
  sounds: boolean
  sync: boolean
  wifi_only: boolean
  devices: string[]
}

function init(): Prefs {
  return { section: Section.General, launch_at_login: true, sounds: false, sync: true, wifi_only: true, devices: ["Studio desk", "Travel laptop"] }
}

const SCENES: [string, (s: Prefs) => void][] = [
  ["Sections/General", (s) => { s.section = Section.General }],
  ["Sections/Sync paused", (s) => { s.section = Section.Sync; s.sync = false }],
  ["Lists/Many devices", (s) => {
    s.section = Section.Devices
    s.devices.push(...["Kitchen tablet", "Spare phone", "Lab machine", "Old desktop"])
  }],
]

function view(s: Prefs, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  const accent = tok.accent(0, cx.system_dark())
  const nav = col().key("nav").w(176.0).h_full().pt(cx.titlebar_inset() > 0.0 ? 44.0 : 12.0).px(8.0).gap(2.0)
    .children(SECTIONS.map(([section, name]) => {
      const on = s.section === section
      return row().key(name).w_full().h(28.0).px(10.0).center_y().radius(radius.SM)
        .fill(on ? t.control_track : Color.TRANSPARENT)
        .hover(on ? t.control_track : t.hover)
        .child(text(name).font(type_.BODY).color(t.text))
        .role("tab").label(name)
        .on_press((s: Prefs) => { s.section = section })
    }))
  let body: El
  switch (s.section) {
    case Section.General:
      body = col().gap(8.0)
        .child(switch_row(t, accent, "launch", "Open at login", s.launch_at_login, (s) => { s.launch_at_login = !s.launch_at_login }))
        .child(switch_row(t, accent, "sounds", "Play sounds", s.sounds, (s) => { s.sounds = !s.sounds }))
      break
    case Section.Sync:
      body = col().gap(8.0)
        .child(switch_row(t, accent, "sync", "Sync across devices", s.sync, (s) => { s.sync = !s.sync }))
        .child(switch_row(t, accent, "wifi", "Only on Wi-Fi", s.wifi_only && s.sync, (s) => { s.wifi_only = !s.wifi_only }).opacity(s.sync ? 1.0 : 0.5))
        .children(!s.sync ? [text("Changes stay on this device until sync is back on.").font(type_.BODY).color(t.text_secondary).px(4.0)] : [])
      break
    case Section.Devices:
      body = devices(s, cx)
      break
  }
  const title = SECTIONS.find(([section, _]) => section === s.section)?.[1] ?? ""
  return row().w_full().h_full().fill(t.bg)
    .child(nav)
    .child(el().w(1.0).h_full().fill(t.separator))
    .child(col().key("content").grow(1.0).h_full().padding(24.0).gap(16.0)
      .child(text(title).font(type_.TITLE).color(t.text))
      .child(body))
}

/** The playground's live devices page: the list, drawn from the real state. */
function devices_page(s: Prefs, cx: Cx): El {
  return col().w_full().h_full().padding(24.0).child(devices(s, cx))
}

/** The "Every device" story: more devices than the stage is tall, on a scrolling stage. */
function every_device(): Prefs {
  return { ...init(), devices: [...EVERY_DEVICE] }
}

const EVERY_DEVICE: string[] = [
  "Studio desk", "Travel laptop", "Kitchen tablet", "Spare phone", "Lab machine", "Old desktop",
  "Living room TV", "Garage Pi", "Work phone", "Reading tablet", "Build server", "Test phone",
  "Backup drive", "Guest laptop", "Car display", "Watch", "Office printer", "Media box",
  "Shared iPad", "Loaner laptop", "Render node", "Home server", "Second monitor hub", "Field kit",
]

function devices(s: Prefs, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  return col().key("devices").w_full().radius(radius.MD).fill(t.card).outline(1.0, 0.0, t.card_border)
    .children(s.devices.map((name, i) => {
      const line = i > 0 ? [el().w_full().h(1.0).fill(t.separator)] : []
      return col().key(`device-${i}`).w_full()
        .children(line)
        .child(row().w_full().h(36.0).px(12.0).center_y().justify_between()
          .child(text(name).font(type_.BODY).color(t.text))
          .child(text(i === 0 ? "This device" : "Synced").font(type_.LABEL).color(t.text_secondary)))
    }))
}

function switch_row(t: Theme, accent: Color, key: string, label: string, on: boolean, flip: (s: Prefs) => void): El {
  return switch_(t, accent, key, label, on, flip)
}

/** A labelled switch on any state, `flip` turning it. */
function switch_<S>(t: Theme, accent: Color, key: string, label: string, on: boolean, flip: (s: S) => void): El {
  const [w, h, k] = [34.0, 20.0, 16.0]
  const knob = el().size(k, k).absolute(on ? w - k - 2.0 : 2.0, 2.0).radius(k / 2.0).fill(t.knob).shadow(1.0, 3.0, t.knob_shadow)
  return row().key(key).w_full().h(44.0).px(12.0).center_y().justify_between()
    .radius(radius.MD).fill(t.card).outline(1.0, 0.0, t.card_border)
    .child(text(label).font(type_.BODY).color(t.text))
    .child(el().size(w, h).radius(h / 2.0).fill(on ? accent : t.control_off).motion(motion.SNAPPY).child(knob))
    .role("switch").label(label)
    .on_press((s: S) => { flip(s) })
}

/** The "Controls/Switches" stories' own state: one switch. */
type Switch = {
  on: boolean
  dimmed: boolean
  label: string
}

function switch_story(s: Switch, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  const accent = tok.accent(0, cx.system_dark())
  return col().w_full().h_full().center().child(
    col().w(300.0).child(switch_(t, accent, "switch", s.label, s.on, (s: Switch) => { s.on = !s.on }).opacity(s.dimmed ? 0.5 : 1.0)),
  )
}

/** The "Controls/Rows" stories: the devices list on its own. */
function device_rows(devices: readonly string[]): () => Prefs {
  return () => ({ ...init(), devices: [...devices] })
}

/** The "Upload" story's own state: a pretend upload ticking along on a timer. */
type Upload = {
  progress: number
  running: boolean
  last: number
}

function upload_init(): Upload {
  return { progress: 0, running: false, last: 0.0 }
}

/** One step every 0.1 s while running: `wake_after` asks for the next frame, whose poll steps. */
function upload_poll(u: Upload, t: number, tx: Tx): boolean {
  if (!u.running) { return false }
  tx.wake_after(0.1) // Duration::from_millis(100)
  if (t - u.last < 0.1) { return false }
  u.last = t
  u.progress = Math.min(u.progress + 4, 100)
  u.running = u.progress < 100
  return true
}

function upload_view(u: Upload, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  const accent = tok.accent(0, cx.system_dark())
  const label = u.running ? "Pause"
    : u.progress === 100 ? "Again"
    : u.progress === 0 ? "Start"
    : "Resume"
  const track = 240.0
  return col().w_full().h_full().center().gap(12.0)
    .child(text(`Uploading backup · ${u.progress}%`).font(type_.BODY).color(t.text))
    .child(el().w(track).h(6.0).radius(3.0).fill(t.control_track)
      .child(el().w(Math.fround(Math.fround(track * u.progress) / 100.0)).h(6.0).radius(3.0).fill(accent).motion(motion.SNAPPY)))
    .child(row().key("upload-toggle").h(28.0).px(14.0).center().radius(radius.SM).fill(t.control_track).hover(t.hover)
      .child(text(label).font(type_.LABEL).color(t.text))
      .role("button").label(label)
      .on_press_tx((u: Upload, tx: Tx) => {
        if (u.progress === 100) { u.progress = 0 }
        u.running = !u.running
        tx.wake_after(0) // Duration::ZERO
      }))
}

/** The toast an app shows over the desktop when a sync finishes, previewed as a story. */
type Toast = {
  message: string
  failed: boolean
}

function toast_view(s: Toast, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  return el().w_full().h_full().center()
    .child(row().h(36.0).px(16.0).gap(8.0).center_y().radius(18.0).fill(t.card).outline(1.0, 0.0, t.card_border).shadow(4.0, 16.0, t.shadow_soft)
      .child(el().size(8.0, 8.0).radius(4.0).fill(tok.accent(s.failed ? 3 : 4, cx.system_dark())))
      .child(text(s.message).font(type_.BODY).color(t.text)))
}

const TOAST: OverlaySpec<Toast> = new OverlaySpec<Toast>({
  name: "Sync toast",
  size: [320.0, 64.0],
  edge: "Top",
  margin: 12.0,
  align: "Center",
  inset: 0.0,
  interactive: false,
  view: toast_view,
})

/** The "Many devices" scene's own control in the side column: how many devices it lists. */
function device_count(s: Prefs, cx: Cx): El {
  const t = tok.theme(cx.system_dark())
  const step = (key: string, label: string, f: (s: Prefs) => void) => {
    return row().key(key).size(24.0, 24.0).center().radius(radius.SM).hover(t.hover).press(t.press)
      .child(text(label).font(type_.BODY).color(t.text))
      .role("button").label(label)
      .on_press((s: Prefs) => { f(s) })
  }
  return row().key("device-count").w_full().h(36.0).pl(12.0).pr(6.0).gap(2.0).center_y().radius(radius.LG).fill(t.card).outline(1.0, 0.0, t.card_border)
    .child(text("Devices").font(type_.BODY).color(t.text))
    .child(el().grow(1.0))
    .child(text(String(s.devices.length)).font(type_.BODY).color(t.text_secondary).pr(6.0))
    .child(step("fewer", "−", (s) => { if (s.devices.length > 1) { s.devices.pop() } }))
    .child(step("more", "+", (s) => { s.devices.push("New device") }))
}

/** R on the upload: start over, then pause part way and pick up again, on the logical clock. */
function upload_replay(u: Upload, play: Play) {
  u.running = true
  play.wake_after(0) // Duration::ZERO
  play.after(0.6, (u: Upload, _: Play) => { u.running = false })
  play.after(1.2, (u: Upload, play: Play) => {
    u.running = true
    play.wake_after(0) // Duration::ZERO
  })
}

const spec = { ...AppSpec.new<Prefs>("Preferences", [640.0, 420.0], init, view), scenes: SCENES }
App.new(spec)
  .playground(
    Playground.new()
      .page("Lists/Live devices", devices_page)
      .trigger("Lists/Many devices", "a", "Add device", (s: Prefs, _: Play) => { s.devices.push("New device") })
      .trigger("Lists/Many devices", "x", "Remove the last", (s: Prefs, _: Play) => { s.devices.pop() })
      .side("Lists/Many devices", device_count)
      .variant("Lists/Many devices", "Six", (_: Prefs) => {})
      .variant("Lists/Many devices", "Just this one", (s: Prefs) => { s.devices.length = Math.min(s.devices.length, 1) })
      .variant("Lists/Many devices", "Long names", (s: Prefs) => {
        s.devices = ["Studio desk in the back office", "Travel laptop (borrowed for the conference)", "Kitchen tablet"]
      })
      .story(Story.new("Lists/Every device", every_device, devices).stage("Scroll"))
      .story(Story.new("Windows/Preferences", init, view).stage("Fill"))
      .story(
        Story.new("Progress/Upload", upload_init, upload_view)
          .poll(upload_poll)
          .trigger("r", "Run, pause, resume", upload_replay)
          .trigger("f", "Finish", (u: Upload, _: Play) => { u.progress = 100; u.running = false })
          .variant("From the start", (_: Upload) => {})
          .variant("Half done", (u: Upload) => { u.progress = 48 }),
      )
      .story(
        Story.overlay("Toasts/Sync toast", TOAST, (): Toast => ({ message: "Synced 3 devices", failed: false }))
          .trigger("e", "Fail", (s: Toast, _: Play) => { s.message = "Sync failed, retrying"; s.failed = true })
          .variant("Synced", (_: Toast) => {})
          .variant("Failed", (s: Toast) => { s.message = "Sync failed, retrying"; s.failed = true }),
      )
      .story(
        Story.new("Controls/Switches/Toggle", (): Switch => ({ on: true, dimmed: false, label: "Sync across devices" }), switch_story)
          .trigger("t", "Flip", (s: Switch, _: Play) => { s.on = !s.on })
          .variant("On", (_: Switch) => {})
          .variant("Off", (s: Switch) => { s.on = false })
          .variant("Dimmed", (s: Switch) => { s.dimmed = true }),
      )
      .story(Story.new("Controls/Switches/Long label", (): Switch => ({ on: false, dimmed: false, label: "Only sync over Wi-Fi when on battery" }), switch_story))
      .story(Story.new("Controls/Rows/Two devices", device_rows(["Studio desk", "Travel laptop"]), devices))
      .story(Story.new("Controls/Rows/One device", device_rows(["Studio desk"]), devices))
      .story(Story.new("Controls/Rows/Long names", device_rows(["Studio desk in the back office", "Travel laptop (borrowed for the conference)"]), devices))
      .group_order(["Controls"])
      .start_folded(true)
      .sizes([["Compact", [420.0, 300.0]], ["Wide", [900.0, 560.0]]]),
  )
  .run()
