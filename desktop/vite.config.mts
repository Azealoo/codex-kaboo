import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Builds the card itself — the page inside the popover window.
 *
 * `base: "./"` because the window loads the built page over `file://`; absolute asset paths would
 * resolve against the filesystem root and 404. Assets are inlined without limit for the same
 * reason: one file to load, no `file://` fetches at all.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/renderer", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    target: "chrome130", // Electron 44's Chromium; no point transpiling below it
  },
});
