import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // The npm workspace root holds the lockfile and `shared/`.
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
