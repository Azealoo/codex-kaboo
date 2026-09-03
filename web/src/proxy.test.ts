import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// The first matcher entry decides which paths the Clerk proxy runs on at all. `/cli/*` must not be
// among them: it serves the installer tarball that `npm install -g <url>` fetches, and a path that
// reaches the proxy needs Clerk to be configured and reachable to be served. Letting the tarball
// through as a PUBLIC route (which it also is) is not enough — public still means the middleware
// ran. Skipping the matcher means a Clerk outage or a bad key cannot break installing the CLI,
// which is the one thing a user does before they can sign in at all.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it("never runs the auth proxy on the CLI download paths", () => {
    expect(matcher.test("/cli/codex-kaboo-cli.tgz")).toBe(false);
    expect(matcher.test("/cli/codex-kaboo-cli-0.1.0.tgz")).toBe(false);
    // version.json is fetched by the CLI's upgrade hint, and `.json` is deliberately excluded from
    // the extension list below (`js(?!on)`), so without the `/cli/` rule it would reach the proxy.
    expect(matcher.test("/cli/version.json")).toBe(false);
  });

  it("still runs on the pages that need auth", () => {
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/users/abc123")).toBe(true);
    expect(matcher.test("/settings")).toBe(true);
  });

  it("still skips Next internals and ordinary static assets", () => {
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/favicon.ico")).toBe(false);
  });
});
