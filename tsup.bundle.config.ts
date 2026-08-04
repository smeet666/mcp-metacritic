import { defineConfig } from "tsup";

/**
 * The build that goes into the .mcpb bundle.
 *
 * A bundle is installed by unpacking it, not by resolving a package, so nothing
 * can stay external: the dependencies are compiled into the one file that
 * ships. The npm build keeps them external, so a consumer's own copies win
 * there; the two configurations exist for that reason and must not be merged.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "bundle",
  dts: false,
  sourcemap: false,
  clean: true,
  splitting: false,
  noExternal: [/.*/],
  // Some dependencies reach for require() at runtime, which an ESM bundle has
  // no answer for. createRequire gives them one. The shebang that opens the
  // published entry point is stripped here: this build is launched as an
  // argument to node, and a shebang below the first line is a syntax error.
  banner: {
    js: "import { createRequire as __nodeCreateRequire } from 'node:module';\nconst require = __nodeCreateRequire(import.meta.url);",
  },
});
