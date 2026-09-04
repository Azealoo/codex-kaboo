import { defineConfig, globalIgnores } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  ...expoConfig,
  globalIgnores([".expo/**", ".expo-export/**", "dist/**", "ios/**", "android/**"]),
  {
    // Same allowance the root config gives the CLI and shared workspaces: an underscore prefix marks
    // an intentionally unused binding. Scoped to TypeScript files, where the expo config loads the
    // @typescript-eslint plugin.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
