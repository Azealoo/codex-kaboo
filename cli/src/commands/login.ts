import { TOKEN_PREFIX } from "@codex-kaboo/shared/constants";
import { readConfig, writeConfig } from "../core/config";
import type { KabooPaths } from "../core/paths";
import type { Config } from "../types";
import type { SyncClient } from "../upload/client";
import type { Logger } from "../util/log";
import { randomLabel } from "../util/names";

export interface LoginOptions {
  token?: string;
  server?: string;
  machineName?: string;
  hostname: boolean;
  json: boolean;
}

export interface LoginDeps {
  paths: KabooPaths;
  env: NodeJS.ProcessEnv;
  bakedServer: string | undefined;
  cliVersion: string;
  prompt: (question: string) => Promise<string>;
  createClient: (config: Pick<Config, "server" | "token">) => SyncClient;
  newId: () => string;
  now: () => number;
  log: Logger;
}

export interface LoginResult {
  ok: boolean;
  exitCode: number;
  server: string;
  label: string;
  machineId: string;
  user: { userId: string; name: string | null; email: string | null } | null;
  token: { name: string; prefix: string } | null;
  error?: string;
}

/** Trims, strips trailing slashes, requires http(s). */
export function normalizeServer(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/.test(trimmed) ? trimmed : null;
}

export async function runLogin(opts: LoginOptions, deps: LoginDeps): Promise<LoginResult> {
  const fail = (error: string, server = ""): LoginResult => ({ ok: false, exitCode: 2, server, label: "", machineId: "", user: null, token: null, error });
  const rawServer = opts.server ?? deps.env.CODEX_KABOO_SERVER ?? deps.bakedServer;
  if (!rawServer) return fail("no server configured: pass --server https://<deployment>.convex.site (or set CODEX_KABOO_SERVER)");
  const server = normalizeServer(rawServer);
  if (server === null) return fail(`invalid server URL "${rawServer}": expected https://<deployment>.convex.site (--server)`);

  const token = (opts.token ?? (await deps.prompt("Paste your sync token (ck_…): "))).trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length <= TOKEN_PREFIX.length) {
    return fail(`invalid token: expected a token starting with ${TOKEN_PREFIX} (create one in the dashboard under Settings → Sync tokens)`, server);
  }

  let who;
  try {
    who = await deps.createClient({ server, token }).whoami();
  } catch (error) {
    return fail(`the server rejected the token or is unreachable: ${error instanceof Error ? error.message : String(error)}`, server);
  }

  const existing = await readConfig(deps.paths).catch(() => null);
  const machineId = existing?.machineId ?? deps.newId();
  const requestedLabel = opts.machineName?.trim();
  const label = requestedLabel && requestedLabel.length > 0 ? requestedLabel.slice(0, 64) : (existing?.label ?? randomLabel());
  const config: Config = {
    server,
    token,
    machineId,
    label,
    hostnameOptIn: opts.hostname || (existing?.hostnameOptIn ?? false),
    codexHomes: existing?.codexHomes ?? [],
    userId: who.userId,
    userName: who.name,
    userEmail: who.email,
    tokenName: who.token.name,
    loggedInAt: deps.now(),
  };
  await writeConfig(deps.paths, config);
  deps.log.info(`logged in to ${server} as ${who.name ?? who.email ?? who.userId} (machine "${label}")`);
  return {
    ok: true,
    exitCode: 0,
    server,
    label,
    machineId,
    user: { userId: who.userId, name: who.name, email: who.email },
    token: { name: who.token.name, prefix: who.token.prefix },
  };
}
