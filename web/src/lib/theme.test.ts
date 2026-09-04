import { describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  themeBootScript,
  themeLabel,
} from "./theme";

describe("parseThemePreference", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    [null, "system"],
    [undefined, "system"],
    ["", "system"],
    ["DARK", "system"],
    ["blue", "system"],
  ])("%s → %s", (raw, expected) => {
    expect(parseThemePreference(raw)).toBe(expected);
  });
});

describe("resolveTheme", () => {
  it("follows the OS only for the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("themeLabel", () => {
  it("names all three preferences", () => {
    expect(themeLabel("system")).toBe("System");
    expect(themeLabel("light")).toBe("Light");
    expect(themeLabel("dark")).toBe("Dark");
  });
});

describe("themeBootScript", () => {
  function run(stored: string | null, systemDark: boolean) {
    const classes = new Set<string>();
    const style: Record<string, string> = {};
    const sandbox = {
      localStorage: { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) },
      window: { matchMedia: () => ({ matches: systemDark }) },
      document: {
        documentElement: {
          classList: {
            add: (c: string) => classes.add(c),
            remove: (c: string) => classes.delete(c),
          },
          style,
        },
      },
    };
    new Function("localStorage", "window", "document", themeBootScript())(
      sandbox.localStorage,
      sandbox.window,
      sandbox.document,
    );
    return { dark: classes.has("dark"), colorScheme: style.colorScheme };
  }

  it("applies the stored preference before React runs", () => {
    expect(run("dark", false)).toEqual({ dark: true, colorScheme: "dark" });
    expect(run("light", true)).toEqual({ dark: false, colorScheme: "light" });
  });

  it("falls back to the OS setting when nothing (or junk) is stored", () => {
    expect(run(null, true)).toEqual({ dark: true, colorScheme: "dark" });
    expect(run(null, false)).toEqual({ dark: false, colorScheme: "light" });
    expect(run("purple", true)).toEqual({ dark: true, colorScheme: "dark" });
  });

  it("agrees with resolveTheme for every combination", () => {
    for (const stored of ["light", "dark", "system", null]) {
      for (const systemDark of [true, false]) {
        const expected = resolveTheme(parseThemePreference(stored), systemDark);
        expect(run(stored, systemDark).dark).toBe(expected === "dark");
      }
    }
  });

  it("swallows a storage access error instead of throwing during boot", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(() =>
      new Function("localStorage", "window", "document", themeBootScript())(throwing, {}, {}),
    ).not.toThrow();
  });
});
