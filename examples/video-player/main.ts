// Play a movie or audio file, or a URL. `bun examples/video-player/main.ts clip.mov` opens a video
// looping and muted; tap to pause or resume. An audio file (mp3, m4a, wav) shows a progress
// bar and waits for a tap, since audio is audible. With no argument it plays the four-frame
// test clip. `-- --snap out.png --at 0.6` renders the frame at 0.6 s headless.
//
// Port of vendor/rune/examples/video-player/src/main.rs. The test clip (Rune's
// `crates/rune/tests/fixtures/rgbw.mp4`) is copied next to this file.

import { fileURLToPath } from "node:url"
import { AppSpec, type Cx, type El, MediaSource, Player, type Tx, type Waker, col, el, extra_args, row, run, text, tok } from "runex-js"
const { type_ } = tok

const WIDTH = 480.0
const AUDIO: string[] = ["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "ogg"]

type Viewer = {
  clip: Player
}

/** `str::to_ascii_lowercase`: only ASCII letters change. */
function to_ascii_lowercase(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

function state(): Viewer {
  const source: string = extra_args().at(0) ?? fileURLToPath(new URL("./rgbw.mp4", import.meta.url))
  const dot = source.lastIndexOf(".")
  const ext = dot >= 0 ? to_ascii_lowercase(source.slice(dot + 1)) : ""
  if (AUDIO.includes(ext)) {
    // `Player::audio(impl Into<MediaSource>)`: the `From<String>` impl.
    return { clip: Player.audio(MediaSource.from_String(source)) }
  }
  const clip = Player.new(MediaSource.from_String(source))
  clip.set_looping(true)
  clip.play()
  return { clip }
}

/** The clip calls the waker when it loads, ends or fails, so the label follows. */
function setup(s: Viewer, waker: Waker) {
  s.clip.set_waker(waker)
}

/** Audio progress: re-run the view about 30 times a second while it plays, and never otherwise. */
function poll(s: Viewer, _: number, tx: Tx): boolean {
  if (s.clip.is_audio() && s.clip.is_playing()) {
    tx.wake_after(0.033)
  }
  return s.clip.is_audio()
}

function toggle(s: Viewer) {
  if (s.clip.is_playing()) { s.clip.pause() } else { s.clip.play() }
}

function view(s: Viewer, _: Cx): El {
  const t = tok.theme(true)
  const st = s.clip.state()
  let label: string
  if (st === "Loading") label = "Loading"
  else if (st === "Playing") label = "Playing, tap to pause"
  else if (st === "Ready") label = "Paused, tap to play"
  else if (st === "Ended") label = "Ended, tap to replay"
  else if (typeof st === "object" && "Failed" in st) label = st.Failed
  else label = ""
  let media: El
  if (s.clip.is_audio()) {
    const d = s.clip.duration()
    const progress = d !== null && d > 0.0 ? Math.fround(s.clip.time() / d) : 0.0
    media = row()
      .key("progress")
      .w(WIDTH)
      .h(4.0)
      .radius(2.0)
      .fill(t.control_track)
      .child(el().w(Math.fround(WIDTH * Math.min(Math.max(progress, 0.0), 1.0))).h(4.0).radius(2.0).fill(t.indicator))
  } else {
    const [w, h] = s.clip.natural_size() ?? [16, 9]
    media = el().key("video").w(WIDTH).h(Math.fround(Math.fround(WIDTH * Math.fround(h)) / Math.fround(w))).radius(10.0).video(s.clip, "Fit")
  }
  return col().w_full().h_full().center().gap(12.0).fill(t.bg).on_press(toggle).child(media).child(text(label).font(type_.BODY).color(t.text_secondary))
}

run({ ...AppSpec.new<Viewer>("Video player", [520.0, 340.0], state, view), setup, poll })
