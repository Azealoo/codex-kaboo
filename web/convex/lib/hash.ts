import { TOKEN_PREFIX } from "../../../shared/src/constants";

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `ck_` + base64url of 32 random bytes (43 characters). Returned to the user exactly once. */
export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return TOKEN_PREFIX + base64Url(bytes);
}

export const PREFIX_LENGTH = TOKEN_PREFIX.length + 6;

/** Display prefix stored next to the hash, e.g. `ck_3f9a1c`. */
export function tokenPrefix(raw: string): string {
  return raw.slice(0, PREFIX_LENGTH);
}

export function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}
