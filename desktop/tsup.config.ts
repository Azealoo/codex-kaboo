import { defineConfig } from "tsup";
import pkg from "./package.json";

/**
 * Bundles the Electron main and preload processes.
 *
 * CommonJS, because Electron's main process loads `main` as CJS and `sandbox: true` preloads must
 * be CJS. `electron` is the only external: it is not a package to bundle, it is the runtime.
 *
 * Everything else IS bundled — including the collector's own source, which the main process
 * imports through the `@cli/*` path alias. That is deliberate: the packaged app carries no
 * cross-workspace runtime dependency and no `node_modules` of its own, and the CLI keeps its
 * one-file, zero-dependency published shape with no Electron anywhere near it.
 */
export default defineConfig({
  entry: { "main/index": "src/main/index.ts", "preload/index": "src/preload/index.ts" },
  outDir: "dist",
  format: ["cjs"],
  target: "node20", // Electron 44 ships Node 22; 20 is the repo's floor and costs nothing here
  platform: "node",
  external: ["electron"],
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  tsconfig: "tsconfig.json",
  // The same three build-time constants the collector bakes in, because the main process bundles
  // the collector's source: without them `@cli/build-info` reports 0.0.0-dev and no dashboard URL,
  // and the card's "Open dashboard" link has nowhere to go.
  define: {
    __CLI_VERSION__: JSON.stringify(process.env.CODEX_KABOO_CLI_VERSION ?? pkg.version),
    __CLI_SERVER__: JSON.stringify(process.env.CODEX_KABOO_SERVER ?? ""),
    __CLI_WEB_ORIGIN__: JSON.stringify(process.env.CODEX_KABOO_WEB_ORIGIN ?? ""),
  },
});
