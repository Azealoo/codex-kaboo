import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root, so `../shared/src` can be compiled by Turbopack.
  turbopack: { root: path.resolve(process.cwd(), "..") },
};

export default nextConfig;
