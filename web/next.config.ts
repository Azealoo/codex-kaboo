import type { NextConfig } from "next";
import path from "node:path";

// A green build with these unset still deploys — every route 500s at runtime because Clerk has no
// keys to initialize with (verified in the final deployment review). Fail the build instead.
for (const k of ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]) {
  if (process.env.NODE_ENV === "production" && !process.env[k]) {
    throw new Error(`${k} is not set — the build would deploy an app that 500s on every request`);
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // The npm workspace root holds the lockfile and `shared/`.
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
