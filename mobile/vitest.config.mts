import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// Pure logic only (src/lib): React Native components are exercised by `expo export` and on device,
// not in jsdom.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
      "@shared": path.resolve(here, "../shared/src"),
      "@convex": path.resolve(here, "../web/convex"),
    },
  },
  test: { include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true },
});
