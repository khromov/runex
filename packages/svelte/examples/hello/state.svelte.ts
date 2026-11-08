// The app's state, in a runes module: it loads once per process, so it survives a hot remount,
// and main.ts's scenes can set it before the first frame.
export const lights = $state({ on: false })
