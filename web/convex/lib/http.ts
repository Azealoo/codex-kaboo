/**
 * Plumbing shared by every sync-token-authed HTTP endpoint (`/api/v1/*`).
 *
 * Lifted out of `ingest.ts` when the menu bar card added a second authed route: token
 * authentication is the one piece of this server no endpoint may get subtly different, and two
 * copies of "look up the hash, then check `revokedAt`" is precisely how a revoked token ends up
 * still working on one of them.
 */
import type { ErrorCode, ErrorResponse } from "../../../shared/src/sync";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { parseBearer, sha256Hex } from "./hash";
import type { TokenLookup } from "../syncTokens";

const JSON_HEADERS = { "content-type": "application/json" };

export function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Partial<Pick<ErrorResponse, "issues" | "limits">> = {},
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ErrorResponse = { ok: false, error, message, ...extra };
  return jsonResponse(status, body, extraHeaders);
}

/** A 503 with a short `Retry-After`; the detail is logged, never returned to the caller. */
export function internalError(scope: string, error: unknown): Response {
  console.error(`codex-kaboo ${scope} failed`, error);
  return errorResponse(
    503,
    "internal",
    "unexpected error, retry later",
    {},
    { "retry-after": "5" },
  );
}

export type AuthResult = { ok: true; auth: TokenLookup } | { ok: false; response: Response };

/** Bearer sync token → its owner. Revoked tokens are rejected with their own code, not 404'd. */
export async function authenticate(ctx: ActionCtx, request: Request): Promise<AuthResult> {
  const raw = parseBearer(request.headers.get("authorization"));
  if (!raw)
    return { ok: false, response: errorResponse(401, "unauthorized", "missing bearer token") };
  const auth = await ctx.runQuery(internal.syncTokens.lookupByHash, {
    tokenHash: await sha256Hex(raw),
  });
  if (!auth) return { ok: false, response: errorResponse(401, "unauthorized", "unknown token") };
  if (auth.revokedAt !== null) {
    return { ok: false, response: errorResponse(401, "token_revoked", "token has been revoked") };
  }
  return { ok: true, auth };
}
