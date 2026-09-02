import { describe, expect, it, vi } from "vitest";
import { makeBatch } from "@codex-kaboo/shared/test-fixtures";
import {
  backoffMs,
  createClient,
  isAuthError,
  isBadRequest,
  isPayloadTooLarge,
  parseRetryAfter,
  RETRY_AFTER_MAX_MS,
  SyncHttpError,
  SyncNetworkError,
} from "../../src/upload/client";

const okBody = {
  ok: true,
  accepted: {
    sessions: { inserted: 1, updated: 0, unchanged: 0 },
    events: { inserted: 1, updated: 0, unchanged: 0 },
  },
  conflicts: { sessions: [], events: 0 },
  serverTime: 1,
  latestCliVersion: "0.2.0",
  limits: { maxBodyBytes: 8388608, maxSessions: 500, maxEvents: 5000 },
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function stub(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createClient({
    server: "https://x.convex.site",
    token: "ck_abc",
    cliVersion: "0.1.0",
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    now: () => 1_000_000,
  });
  return { client, calls, sleeps };
}

describe("createClient.sync", () => {
  it("posts the batch with auth and version headers and parses the response", async () => {
    const { client, calls } = stub([json(200, okBody)]);
    const res = await client.sync({ ...makeBatch(), batchId: "b1" });
    expect(res.latestCliVersion).toBe("0.2.0");
    expect(calls[0]?.url).toBe("https://x.convex.site/api/v1/sync");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ck_abc");
    expect(headers["X-Codex-Kaboo-Cli"]).toBe("0.1.0");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init.body)).batchId).toBe("b1");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });
  it("retries 5xx/429 with backoff and Retry-After, then succeeds", async () => {
    const { client, calls, sleeps } = stub([
      json(503, { ok: false, error: "internal" }, { "Retry-After": "2" }),
      json(429, { ok: false, error: "x" }),
      json(200, okBody),
    ]);
    await client.sync(makeBatch());
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]); // Retry-After 2 s, then attempt-2 backoff 2000 ms (jitter 0 with random 0.5)
  });
  it("does not retry 401, 413 or 400 and classifies them", async () => {
    const u = stub([json(401, { ok: false, error: "token_revoked" })]);
    const e1 = await u.client.sync(makeBatch()).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(SyncHttpError);
    expect((e1 as SyncHttpError).status).toBe(401);
    expect((e1 as SyncHttpError).code).toBe("token_revoked");
    expect(isAuthError(e1)).toBe(true);
    expect(u.calls).toHaveLength(1);
    const p = stub([
      json(413, {
        ok: false,
        error: "too_many_items",
        limits: { maxBodyBytes: 1, maxSessions: 1, maxEvents: 100 },
      }),
    ]);
    const e2 = await p.client.sync(makeBatch()).catch((e: unknown) => e);
    expect(isPayloadTooLarge(e2)).toBe(true);
    expect((e2 as SyncHttpError).body?.limits?.maxEvents).toBe(100);
    const b = stub([
      json(400, {
        ok: false,
        error: "invalid_batch",
        issues: [{ path: "sessions.0.day", message: "bad" }],
      }),
    ]);
    const e3 = await b.client.sync(makeBatch()).catch((e: unknown) => e);
    expect(isBadRequest(e3)).toBe(true);
    expect((e3 as SyncHttpError).message).toContain("sessions.0.day");
  });
  it("gives up after six attempts (five retries)", async () => {
    const { client, calls, sleeps } = stub([
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
    ]);
    await expect(client.sync(makeBatch())).rejects.toBeInstanceOf(SyncNetworkError);
    expect(calls).toHaveLength(6);
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000]);
  });
  it("rejects a malformed success body", async () => {
    const { client } = stub([json(200, { ok: true, nope: 1 })]);
    const e = await client.sync(makeBatch()).catch((x: unknown) => x);
    expect((e as SyncHttpError).code).toBe("invalid_response");
  });
});

describe("whoami / health", () => {
  it("parses whoami and health", async () => {
    const { client, calls } = stub([
      json(200, {
        ok: true,
        userId: "u1",
        name: "Ada",
        email: null,
        token: { name: "mac", prefix: "ck_abc" },
        serverTime: 5,
      }),
      json(200, { ok: true, serverTime: 6 }),
    ]);
    expect((await client.whoami()).userId).toBe("u1");
    expect(calls[0]?.url).toBe("https://x.convex.site/api/v1/whoami");
    expect(calls[0]?.init.method).toBe("GET");
    expect(await client.health()).toEqual({ ok: true, serverTime: 6 });
  });
});

describe("helpers", () => {
  it("computes jittered backoff and Retry-After", () => {
    expect(backoffMs(1, () => 0.5)).toBe(1000);
    expect(backoffMs(1, () => 0)).toBe(750);
    expect(backoffMs(3, () => 1)).toBe(5000);
    expect(parseRetryAfter("3", 0)).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(parseRetryAfter("garbage", 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});

// Supplementary coverage beyond the brief's Step 1 tests, closing gaps called out by the task's
// self-review checklist: an end-to-end (not just unit-level) HTTP-date Retry-After, an explicit
// no-retry call count on 400, a malformed whoami body, token safety in thrown messages, and the
// actual timeoutMs value wired into AbortSignal.timeout (only "signal instanceof AbortSignal" is
// checked by the brief).

describe("Retry-After edge cases", () => {
  it("honours an HTTP-date Retry-After header end-to-end, not just via the parseRetryAfter helper", async () => {
    const retryAt = new Date(1_000_000 + 3000).toUTCString(); // now() + 3 s, stub's now() is fixed at 1_000_000
    const { client, calls, sleeps } = stub([
      json(503, { ok: false, error: "internal" }, { "Retry-After": retryAt }),
      json(200, okBody),
    ]);
    await client.sync(makeBatch());
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  // `sleep` is a plain refed setTimeout: neither AbortSignal.timeout (fetch only) nor the run-budget
  // deadline (checked between batches) can cut it short, so an unbounded Retry-After parks the whole
  // process for as long as the server likes while cron keeps launching new ones.
  it("clamps a huge numeric Retry-After to one minute instead of parking the process for a day", async () => {
    expect(parseRetryAfter("86400", 0)).toBe(RETRY_AFTER_MAX_MS); // a full day
    expect(parseRetryAfter("60", 0)).toBe(60_000); // exactly at the cap: untouched
    expect(parseRetryAfter("30", 0)).toBe(30_000); // below the cap: still honoured verbatim
    const { client, calls, sleeps } = stub([
      json(503, { ok: false, error: "internal" }, { "Retry-After": "86400" }),
      json(200, okBody),
    ]);
    await client.sync(makeBatch());
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_AFTER_MAX_MS]);
  });

  it("clamps a far-future HTTP-date Retry-After the same way", async () => {
    const farFuture = new Date(1_000_000 + 7 * 24 * 60 * 60 * 1000).toUTCString(); // now() + 7 days
    expect(parseRetryAfter(farFuture, 1_000_000)).toBe(RETRY_AFTER_MAX_MS);
    expect(parseRetryAfter(new Date(1_000_000 - 5000).toUTCString(), 1_000_000)).toBe(0); // past date: no negative sleep
    const { client, calls, sleeps } = stub([
      json(503, { ok: false, error: "internal" }, { "Retry-After": farFuture }),
      json(200, okBody),
    ]);
    await client.sync(makeBatch());
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([RETRY_AFTER_MAX_MS]);
  });

  it("reports the clamped delay on the error too, so retryAfterMs never promises a wait we would not take", async () => {
    // 400 is non-retryable, so the error surfaces on the first attempt with its parsed header.
    const { client } = stub([
      json(400, { ok: false, error: "invalid_batch" }, { "Retry-After": "99999" }),
    ]);
    const error = await client.sync(makeBatch()).catch((e: unknown) => e);
    expect((error as SyncHttpError).retryAfterMs).toBe(RETRY_AFTER_MAX_MS);
  });
});

describe("no-retry call counts", () => {
  it("stops after exactly one attempt on 400 (retrying would exhaust the stub and change the error type)", async () => {
    const { client, calls } = stub([json(400, { ok: false, error: "invalid_batch" })]);
    const e = await client.sync(makeBatch()).catch((x: unknown) => x);
    expect(isBadRequest(e)).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("response schema validation beyond sync", () => {
  it("rejects a malformed whoami body the same way as a malformed sync body", async () => {
    const { client } = stub([json(200, { ok: true, nope: 1 })]);
    const e = await client.whoami().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SyncHttpError);
    expect((e as SyncHttpError).code).toBe("invalid_response");
  });
});

describe("token safety", () => {
  it("never includes the token in a SyncHttpError message", async () => {
    const { client } = stub([json(401, { ok: false, error: "token_revoked" })]);
    const e = await client.sync(makeBatch()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SyncHttpError);
    expect((e as SyncHttpError).message).not.toContain("ck_abc");
  });
  it("never includes the token in a SyncNetworkError message", async () => {
    const { client } = stub([
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
      new Error("ECONNRESET"),
    ]);
    const e = await client.sync(makeBatch()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SyncNetworkError);
    expect((e as SyncNetworkError).message).not.toContain("ck_abc");
  });
});

describe("timeout wiring", () => {
  it("defaults the abort timeout to 30 s and forwards a custom timeoutMs", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    try {
      const { client } = stub([json(200, okBody)]);
      await client.sync(makeBatch());
      expect(spy).toHaveBeenCalledWith(30_000);

      spy.mockClear();
      const fetch = async (): Promise<Response> => json(200, okBody);
      const custom = createClient({
        server: "https://x.convex.site",
        token: "ck_abc",
        cliVersion: "0.1.0",
        fetch,
        sleep: async () => {},
        random: () => 0.5,
        now: () => 0,
        timeoutMs: 5000,
      });
      await custom.sync(makeBatch());
      expect(spy).toHaveBeenCalledWith(5000);
    } finally {
      spy.mockRestore();
    }
  });
});
