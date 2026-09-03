declare const __CLI_VERSION__: string | undefined;
declare const __CLI_SERVER__: string | undefined;
declare const __CLI_WEB_ORIGIN__: string | undefined;

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Version stamped by tsup (`CODEX_KABOO_CLI_VERSION` or package.json); "0.0.0-dev" under vitest. */
export const CLI_VERSION: string =
  typeof __CLI_VERSION__ === "string" && __CLI_VERSION__.length > 0 ? __CLI_VERSION__ : "0.0.0-dev";
/** Server origin baked at build time from CODEX_KABOO_SERVER, e.g. https://xxx.convex.site */
export const BAKED_SERVER: string | undefined =
  typeof __CLI_SERVER__ === "string" ? nonEmpty(__CLI_SERVER__) : undefined;
/** Dashboard origin baked at build time from CODEX_KABOO_WEB_ORIGIN (for the upgrade hint). */
export const BAKED_WEB_ORIGIN: string | undefined =
  typeof __CLI_WEB_ORIGIN__ === "string" ? nonEmpty(__CLI_WEB_ORIGIN__) : undefined;
