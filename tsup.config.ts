import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/mc/client.ts"],
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // Dependencies stay external so `npx` resolves them from node_modules.
  external: ["@modelcontextprotocol/sdk", "zod"],
  // The shebang lives at the top of src/index.ts; esbuild preserves it there.
  // A global banner would also prepend it to the library entry point.
});
