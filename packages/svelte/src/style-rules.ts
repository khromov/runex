// The shape of one `<style>` rule as compile.ts emits it and the renderer matches it.

export type Pseudo = "hover" | "active" | null

/**
 * One compound selector of a component's `<style>`: classes, at most one tag and at most one
 * of `:hover`/`:active`, with its declarations as written (translated when an element matches).
 */
export interface StyleRule {
  classes: string[]
  tag: string | null
  pseudo: Pseudo
  decls: [string, string][]
}
