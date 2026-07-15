// Uint8Array.prototype.toHex() (stage-4 proposal, shipped in browsers,
// not yet part of TypeScript's bundled lib definitions).
interface Uint8Array {
  toHex(): string;
}

// @goodtools/wiregasm ships no types for its emscripten entry point.
declare module "@goodtools/wiregasm/dist/wiregasm" {
  const loadWiregasm: any;
  export default loadWiregasm;
}

// Vite's `?raw` query for .html imports isn't covered by vite/client.
declare module "*.html?raw" {
  const content: string;
  export default content;
}
