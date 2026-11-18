/** Timezone helpers. Zoneless Notion times are interpreted in the configured zone (default Asia/Tokyo). */

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** en-US short weekday: Sun, Mon, ... */
  weekday: string;
};

const WEEKDAY_JA: Record<string, string> = {
  Sun: "日",
  Mon: "月",
  Tue: "火",
  Wed: "水",
  Thu: "木",
  Fri: "金",
  Sat: "土",
};

export function isValidTimeZone(timeZone: string): boolean {
  const name = timeZone.trim();
  if (!name) return false;
  try {
    Intl.DateTimeFormat("ja-JP", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(ms: number, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  let year = Number(get("year"));
  let month = Number(get("month"));
  let day = Number(get("day"));
  let hour = Number(get("hour"));
  // Some ICU builds report midnight as 24:00 on the previous calendar math.
  if (hour === 24) {
    hour = 0;
    const next = addCalendarDays(year, month, day, 1);
    year = next.year;
    month = next.month;
    day = next.day;
  }
  return {
    year,
    month,
    day,
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

export function weekdayJa(weekdayEn: string): string {
  return WEEKDAY_JA[weekdayEn] ?? "";
}

/** Minutes east of UTC at an absolute instant. Tokyo in winter and summer is 540. */
export function offsetMinutesAt(timeZone: string, instant: number): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - instant) / 60_000);
}

/** Convert a wall-clock time in `timeZone` to a UTC epoch. */
export function wallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = offsetMinutesAt(timeZone, utcGuess);
  let instant = utcGuess - offset1 * 60_000;
  const offset2 = offsetMinutesAt(timeZone, instant);
  if (offset2 !== offset1) {
    instant = utcGuess - offset2 * 60_000;
  }
  return instant;
}

export function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function zonedDayBounds(
  nowMs: number,
  timeZone: string,
): { startMs: number; endMs: number } {
  const parts = zonedParts(nowMs, timeZone);
  const startMs = wallTimeToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
  const next = addCalendarDays(parts.year, parts.month, parts.day, 1);
  const endMs = wallTimeToUtcMs(next.year, next.month, next.day, 0, 0, 0, timeZone);
  return { startMs, endMs };
}

export function sameYmd(aMs: number, bMs: number, timeZone: string): boolean {
  const a = zonedParts(aMs, timeZone);
  const b = zonedParts(bMs, timeZone);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
