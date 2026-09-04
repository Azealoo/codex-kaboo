// Monorepo-aware Metro config. Expo already infers the workspace root from the lockfile; the
// explicit settings below make the two things this app relies on unambiguous:
//  - `../shared` and `../web/convex` are outside this package and must be watched/transpiled;
//  - dependencies are hoisted to the repo root's node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// `@codex-kaboo/shared` exports TypeScript sources through its `exports` map.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
