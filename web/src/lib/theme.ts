/**
 * Theme preference logic, kept pure so it can be tested and so the same rules run in three places:
 * the inline boot script (before React hydrates, to avoid a light flash), the React provider, and
 * the toggle.
 */
export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "codex-kaboo:theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

/** Anything not one of the three known values (including `null`) falls back to `system`. */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

export function themeLabel(preference: ThemePreference): string {
  switch (preference) {
    case "system":
      return "System";
    case "light":
      return "Light";
    case "dark":
      return "Dark";
  }
}

/**
 * The script inlined in `<head>` so the very first paint already carries the right class. It reads
 * the same key and applies the same rule as `resolveTheme`; keep the two in step. Written as a
 * string (not a function serialised at runtime) so it is byte-identical on server and client.
 */
export function themeBootScript(): string {
  return (
    "(function(){try{" +
    `var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
    "var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
    "var c=document.documentElement.classList;" +
    "if(d){c.add('dark');}else{c.remove('dark');}" +
    "document.documentElement.style.colorScheme=d?'dark':'light';" +
    "}catch(e){}})();"
  );
}
