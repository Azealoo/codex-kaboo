import { CLI_VERSION_HEADER, HEALTH_PATH, SYNC_PATH, WHOAMI_PATH } from "@codex-kaboo/shared/constants";
import { ErrorResponse, SyncResponse, WhoamiResponse, type SyncBatch } from "@codex-kaboo/shared/sync";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  server: string;
  token: string;
  cliVersion: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  random?: () => number;
  now?: () => number;
}

export interface SyncClient {
  sync(batch: SyncBatch): Promise<SyncResponse>;
  whoami(): Promise<WhoamiResponse>;
  health(): Promise<{ ok: boolean; serverTime: number | null }>;
}

export class SyncHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body: ErrorResponse | null,
    public readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
}

export class SyncNetworkError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "SyncNetworkError";
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof SyncHttpError && (error.status === 401 || error.status === 403);
}

export function isPayloadTooLarge(error: unknown): boolean {
  return error instanceof SyncHttpError && error.status === 413;
}

export function isBadRequest(error: unknown): boolean {
  return error instanceof SyncHttpError && (error.status === 400 || error.status === 422);
}

/** 1 s, 2 s, 4 s, 8 s, 16 s ± 25 % jitter. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = 1000 * 2 ** Math.max(0, attempt - 1);
  const jitter = (random() * 2 - 1) * 0.25;
  return Math.round(base * (1 + jitter));
}

export function parseRetryAfter(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

const RETRYABLE = new Set([408, 425, 429]);

function describeError(body: ErrorResponse | null, status: number): string {
  if (!body) return `HTTP ${status}`;
  const issues = body.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
  return `${body.error}${body.message ? `: ${body.message}` : ""}${issues ? ` (${issues})` : ""} [HTTP ${status}]`;
}

export function createClient(opts: ClientOptions): SyncClient {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxAttempts = opts.maxAttempts ?? 5;
  const random = opts.random ?? Math.random;
  const now = opts.now ?? (() => Date.now());
  const base = opts.server.replace(/\/+$/, "");

  async function request(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`${base}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${opts.token}`,
            [CLI_VERSION_HEADER]: opts.cliVersion,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastError = new SyncNetworkError(`network error: ${error instanceof Error ? error.message : String(error)}`, error);
        if (attempt < maxAttempts) await sleep(backoffMs(attempt, random));
        continue;
      }
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (response.status >= 200 && response.status < 300) return parsed;
      const errorBody = ErrorResponse.safeParse(parsed);
      const bodyOrNull = errorBody.success ? errorBody.data : null;
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), now());
      const httpError = new SyncHttpError(response.status, bodyOrNull?.error ?? `http_${response.status}`, describeError(bodyOrNull, response.status), bodyOrNull, retryAfterMs);
      if (response.status >= 500 || RETRYABLE.has(response.status)) {
        lastError = httpError;
        if (attempt < maxAttempts) await sleep(retryAfterMs ?? backoffMs(attempt, random));
        continue;
      }
      throw httpError;
    }
    throw lastError instanceof Error ? lastError : new SyncNetworkError("request failed", lastError);
  }

  return {
    async sync(batch) {
      const parsed = SyncResponse.safeParse(await request(SYNC_PATH, "POST", batch));
      if (!parsed.success) throw new SyncHttpError(200, "invalid_response", "server returned an unexpected sync response", null, null);
      return parsed.data;
    },
    async whoami() {
      const parsed = WhoamiResponse.safeParse(await request(WHOAMI_PATH, "GET"));
      if (!parsed.success) throw new SyncHttpError(200, "invalid_response", "server returned an unexpected whoami response", null, null);
      return parsed.data;
    },
    async health() {
      const raw = (await request(HEALTH_PATH, "GET")) as { ok?: unknown; serverTime?: unknown } | null;
      return { ok: raw?.ok === true, serverTime: typeof raw?.serverTime === "number" ? raw.serverTime : null };
    },
  };
}
