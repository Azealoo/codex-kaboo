import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The same alias `tsconfig.json` and `tsup.config.ts` use: the card's main process consumes
      // the collector from source, so its tests have to resolve it the same way.
      "@cli": fileURLToPath(new URL("../cli/src", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    passWithNoTests: true,
  },
});
