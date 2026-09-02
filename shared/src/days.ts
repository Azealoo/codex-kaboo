export type Bucket = "day" | "week" | "month";

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** True for a real calendar date between 2000-01-01 and 2099-12-31 in YYYY-MM-DD form. */
export function isValidDay(day: string): boolean {
  const m = DAY_RE.exec(day);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function dayToUtcMs(day: string): number {
  const m = DAY_RE.exec(day);
  if (!m) throw new RangeError(`invalid day: ${day}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function utcMsToDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(day: string, n: number): string {
  return utcMsToDay(dayToUtcMs(day) + n * MS_PER_DAY);
}

/** Inclusive day count; 0 when `from` is after `to`. */
export function daysBetween(from: string, to: string): number {
  const diff = Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / MS_PER_DAY);
  return diff < 0 ? 0 : diff + 1;
}

export function eachDay(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

export function compareDays(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const n = daysBetween(from, to);
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(n - 1)), to: prevTo };
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(day: string): number {
  return (new Date(dayToUtcMs(day)).getUTCDay() + 6) % 7;
}

export function weekStart(day: string): string {
  return addDays(day, -weekdayOf(day));
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function bucketStart(day: string, bucket: Bucket): string {
  switch (bucket) {
    case "day":
      return day;
    case "week":
      return weekStart(day);
    case "month":
      return monthStart(day);
  }
}

function nextBucketStart(start: string, bucket: Bucket): string {
  if (bucket === "day") return addDays(start, 1);
  if (bucket === "week") return addDays(start, 7);
  const d = new Date(dayToUtcMs(start));
  return utcMsToDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** Ascending bucket starts covering [from, to]; the first is bucketStart(from). */
export function eachBucket(from: string, to: string, bucket: Bucket): string[] {
  const out: string[] = [];
  let cur = bucketStart(from, bucket);
  while (compareDays(cur, to) <= 0) {
    out.push(cur);
    cur = nextBucketStart(cur, bucket);
  }
  return out;
}

export function bucketFor(days: number): Bucket {
  return days <= 120 ? "day" : days <= 730 ? "week" : "month";
}

function formatterFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...options, timeZone });
  } catch {
    try {
      return new Intl.DateTimeFormat("en-CA", options); // machine zone
    } catch {
      return new Intl.DateTimeFormat("en-CA", { ...options, timeZone: "UTC" });
    }
  }
}

/** Local calendar day and hour of `tsMs` in `timeZone`; invalid/missing zone → machine zone → UTC. */
export function dayHourIn(
  tsMs: number,
  timeZone: string | undefined,
): { day: string; hour: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(tsMs));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hourRaw = Number(get("hour"));
  const hour = !Number.isFinite(hourRaw) || hourRaw === 24 ? 0 : hourRaw;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour };
}
