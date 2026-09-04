import type { MetadataRoute } from "next";

/**
 * Lets the dashboard be installed to a phone's home screen ("Add to Home Screen") as a standalone
 * app — the lightweight companion to the native apps under `mobile/`. Served at
 * `/manifest.webmanifest`, which `src/proxy.ts` deliberately leaves outside the auth middleware.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "codex-kaboo",
    short_name: "kaboo",
    description: "Codex usage dashboard for a shared account",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f9fb",
    theme_color: "#008300",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
