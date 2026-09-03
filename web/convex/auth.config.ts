import type { AuthConfig } from "convex/server";

// CLERK_FRONTEND_API_URL must be set on the deployment (`npx convex env set CLERK_FRONTEND_API_URL
// https://<slug>.clerk.accounts.dev`) before `npx convex dev` / `npx convex deploy` pushes this file;
// Convex refuses to push an auth config whose env var is unset. convex-test ignores this file.
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
