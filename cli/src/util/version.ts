export function parseVersion(version: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(version.trim());
  if (!m || !m[1]) return null;
  return m[1].split(".").map((part) => Number(part));
}

/** -1, 0, 1 by numeric dotted comparison; missing segments count as 0; suffixes ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [];
  const pb = parseVersion(b) ?? [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function newestVersion(list: Iterable<string | null | undefined>): string | undefined {
  let best: string | undefined;
  for (const v of list) {
    if (typeof v !== "string" || parseVersion(v) === null) continue;
    if (best === undefined || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

export function meetsVersion(actual: string, required: string): boolean {
  return compareVersions(actual, required) >= 0;
}
