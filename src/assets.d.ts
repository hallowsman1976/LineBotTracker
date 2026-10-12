// esbuild inlines .png imports as base64 strings (see build.mjs loader).
declare module '*.png' {
  const base64: string;
  export default base64;
}
