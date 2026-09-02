import { describe, expect, it } from "vitest";
import {
  compareVersions,
  installCommands,
  INSTALL_OS,
  installSteps,
  isNewerThanTested,
  tgzUrl,
} from "./install";

const origin = "https://codex-kaboo.vercel.app";

describe("install strings", () => {
  it("builds the four commands from the origin, always including npm 12's --allow-remote=all", () => {
    // A user copies whichever card is in front of them on first run — onboarding, Data Sync, or
    // Settings — so there is no safe "plain" variant to print alongside the flagged one; every
    // surface must get the one command that works on npm >= 12.
    expect(tgzUrl(origin)).toBe("https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz");
    const c = installCommands(origin);
    expect(c.install).toBe(
      "npm install -g --allow-remote=all https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz",
    );
    expect(c.login).toBe("codex-kaboo login --token <token>");
    expect(installCommands(origin, "ck_abc").login).toBe("codex-kaboo login --token ck_abc");
    expect(c.schedule).toBe("codex-kaboo install");
    expect(c.status).toBe("codex-kaboo status");
  });
  it("lists per-OS steps with the same commands and OS-specific notes", () => {
    const mac = installSteps("macos", origin);
    expect(mac.map((s) => s.command)).toEqual([
      "npm install -g --allow-remote=all https://codex-kaboo.vercel.app/cli/codex-kaboo-cli.tgz",
      "codex-kaboo login --token <token>",
      "codex-kaboo install",
      "codex-kaboo status",
    ]);
    expect(installSteps("windows", origin)[0]?.note).toContain("%AppData%\\npm");
    expect(installSteps("linux", origin)[0]?.note).toContain("EACCES");
    expect(installSteps("macos", origin)[2]?.note).toContain("launchd");
  });
  it("gives every OS the same install command", () => {
    const commands = INSTALL_OS.map((os) => installSteps(os.id, origin)[0]?.command);
    expect(new Set(commands).size).toBe(1);
    expect(commands[0]).toContain("--allow-remote=all");
  });
});

describe("versions", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("0.151.0", "0.150.1")).toBe(1);
    expect(compareVersions("0.150.1", "0.150.1")).toBe(0);
    expect(compareVersions("0.9.0", "0.150.1")).toBe(-1);
    expect(compareVersions("0.150.1-beta.1", "0.150.1")).toBe(0);
  });
  it("flags Codex versions newer than the tested one", () => {
    expect(isNewerThanTested("0.150.1")).toBe(false);
    expect(isNewerThanTested("0.152.0")).toBe(true);
    expect(isNewerThanTested(null)).toBe(false);
    expect(isNewerThanTested("garbage")).toBe(false);
  });
});
