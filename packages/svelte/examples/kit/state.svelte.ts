// Everything the gallery's controls bind to, so main.ts's scenes can set it before a snapshot.
export const ui = $state({
  wifi: true,
  bluetooth: false,
  remember: true,
  newsletter: false,
  name: "Ada Lovelace",
  notes: "",
  size: "Medium" as string | null,
  size_open: false,
  view: 1 as number | null,
  progress: 0.62,
  presses: 0,
  confirm: false,
})
