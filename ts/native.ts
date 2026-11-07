// The native addon. A static import, so `bun build --compile` embeds the platform's `.node`.
import native from "../native.cjs"

export default native
export type * from "../native.cjs"
