import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: { "codex-kaboo": "src/main.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node18",
  outDir: "dist",
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  noExternal: [/.*/],
  outExtension: () => ({ js: ".js" }),
  define: {
    __CLI_VERSION__: JSON.stringify(process.env.CODEX_KABOO_CLI_VERSION ?? pkg.version),
    __CLI_SERVER__: JSON.stringify(process.env.CODEX_KABOO_SERVER ?? ""),
    __CLI_WEB_ORIGIN__: JSON.stringify(process.env.CODEX_KABOO_WEB_ORIGIN ?? ""),
  },
});
