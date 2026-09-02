import { describe, expect, it } from "vitest";
import { nodeSpawner } from "../../src/util/spawn";

describe("nodeSpawner", () => {
  it("captures stdout, exit codes, stdin and missing commands", async () => {
    const ok = await nodeSpawner.run(process.execPath, ["-e", "process.stdout.write('hi'); process.exit(3)"]);
    expect(ok).toEqual({ code: 3, stdout: "hi", stderr: "" });
    const echo = await nodeSpawner.run(process.execPath, ["-e", "process.stdin.on('data', d => process.stdout.write(d))"], { input: "abc" });
    expect(echo.stdout).toBe("abc");
    const missing = await nodeSpawner.run("definitely-not-a-command-xyz", []);
    expect(missing.code).toBeNull();
    expect(missing.stderr.length).toBeGreaterThan(0);
  });
});
