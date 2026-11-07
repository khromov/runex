// The switch's caption, in its own module: edit it while `vite` runs and the open window
// changes in place, the switch keeping its position.
export function caption(on: boolean): string {
  return on ? "Lights on" : "Lights off"
}
