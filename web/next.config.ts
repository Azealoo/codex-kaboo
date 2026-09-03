import type { NextConfig } from "next";
import path from "node:path";

// Nothing here reads the environment on purpose. `next typegen`, which `npm run typecheck` runs,
// evaluates this file with phase `phase-production-build` and NODE_ENV=production — a real build is
// indistinguishable from a type check. Anything that throws on a missing deployment value therefore
// fails typecheck on every machine without a `.env.local`, and passes on the machines that have one
// for a reason unrelated to whether the value is actually configured.
//
// The build-time env gate lives in `scripts/pack-cli.mjs` (the `prebuild`), which only a real
// `npm run build` reaches. See `buildEnvProblems` there.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // The npm workspace root holds the lockfile and `shared/`.
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
