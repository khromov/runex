declare module "*.svelte" {
  const component: import("@runex-js/svelte").AnyComponent
  export default component
}
