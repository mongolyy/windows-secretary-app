import {
  addCalendarDays,
  isValidYmd,
  wallTimeToUtcMs,
} from "./time";

export type DateParse =
  | { ok: true; startMs: number; endMs: number; allDay: boolean }
  | { ok: false; message: string };

type Side = {
  year: number;
  month: number;
  day: number;
  hour: number | null;
  minute: number | null;
  second: number | null;
  /** Minutes east of UTC. Null means "use the configured time zone". */
  offsetMinutes: number | null;
  timeOnly: boolean;
};

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const RANGE_SPLIT = /\s*(?:→|⇒|->|–|—)\s*/;

/**
 * Parse one Notion date cell.
 *
 * Timed end is exclusive (`start <= now < end`). All-day end dates are inclusive,
 * matching the last day Notion shows, and are stored as the next local midnight.
 * A time with no zone uses `timeZone` (the app default is Asia/Tokyo).
 * A single timed value with no end is treated as one hour long.
 */
export function parseNotionDateRange(raw: string, timeZone: string): DateParse {
  const text = normalizeDateText(raw);
  if (!text) return fail("日付が空です");

  const parts = text.split(RANGE_SPLIT).filter((part) => part.length > 0);
  if (parts.length === 0) return fail("日付が空です");
  if (parts.length > 2) return fail("日付の期間が多すぎます");

  const start = parseSide(parts[0]);
  if (!start) return fail("日付の形式を解釈できません");
  let end = parts.length === 2 ? parseSide(parts[1]) : null;
  if (parts.length === 2 && !end) return fail("終了側の日付を解釈できません");

  if (start.timeOnly) return fail("日付がありません");

  let endWasTimeOnly = false;
  if (end?.timeOnly) {
    endWasTimeOnly = true;
    end.year = start.year;
    end.month = start.month;
    end.day = start.day;
    if (end.offsetMinutes == null) end.offsetMinutes = start.offsetMinutes;
    const startClock = clockSeconds(start);
    const endClock = clockSeconds(end);
    if (endClock <= startClock) {
      const next = addCalendarDays(end.year, end.month, end.day, 1);
      end.year = next.year;
      end.month = next.month;
      end.day = next.day;
    }
  }

  if (!isValidYmd(start.year, start.month, start.day)) {
    return fail("ありえない日付です");
  }
  if (end && !isValidYmd(end.year, end.month, end.day)) {
    return fail("ありえない日付です");
  }

  const allDay = start.hour == null && (end == null || end.hour == null);
  if (allDay) {
    const startMs = midnightMs(start, timeZone);
    const endBase = end ?? start;
    const nextDay = addCalendarDays(endBase.year, endBase.month, endBase.day, 1);
    const endMs = midnightMs(
      { ...endBase, year: nextDay.year, month: nextDay.month, day: nextDay.day },
      timeZone,
    );
    if (endMs <= startMs) return fail("終了が開始以前です");
    return { ok: true, startMs, endMs, allDay: true };
  }

  const startMs = instantMs(start, timeZone);
  const endMs = end
    ? instantMs(end, timeZone)
    : startMs + 60 * 60 * 1000;
  if (end && !endWasTimeOnly && endMs <= startMs) return fail("終了が開始以前です");
  if (endMs <= startMs) return fail("終了が開始以前です");
  return { ok: true, startMs, endMs, allDay: false };
}

export function normalizeDateText(input: string): string {
  return input
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D]/g, "")
    .replace(/[\u00A0\u3000]/g, " ")
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, " ")
    .trim();
}

function fail(message: string): DateParse {
  return { ok: false, message };
}

function clockSeconds(side: Side): number {
  return (side.hour ?? 0) * 3600 + (side.minute ?? 0) * 60 + (side.second ?? 0);
}

function midnightMs(side: Side, timeZone: string): number {
  return instantMs({ ...side, hour: 0, minute: 0, second: 0 }, timeZone);
}

function instantMs(side: Side, timeZone: string): number {
  const hour = side.hour ?? 0;
  const minute = side.minute ?? 0;
  const second = side.second ?? 0;
  if (side.offsetMinutes != null) {
    return Date.UTC(side.year, side.month - 1, side.day, hour, minute, second) -
      side.offsetMinutes * 60_000;
  }
  return wallTimeToUtcMs(side.year, side.month, side.day, hour, minute, second, timeZone);
}

function parseSide(input: string): Side | null {
  const { rest, offsetMinutes } = extractOffset(input);
  const text = stripWeekday(rest);
  if (!text) return null;

  const timeOnly = parseTimeOnly(text);
  if (timeOnly) {
    return {
      year: 0,
      month: 0,
      day: 0,
      ...timeOnly,
      offsetMinutes,
      timeOnly: true,
    };
  }

  return (
    parseJapanese(text, offsetMinutes) ??
    parseEnglish(text, offsetMinutes) ??
    parseIso(text, offsetMinutes) ??
    parseSlash(text, offsetMinutes)
  );
}

function extractOffset(input: string): { rest: string; offsetMinutes: number | null } {
  const match = input.match(
    /^(.*?)(?:\s*[(（]\s*(GMT|UTC|JST)\s*([+-]\s*\d{1,2}(?::\d{2})?)?\s*[)）])\s*$/i,
  );
  if (!match) return { rest: input.trim(), offsetMinutes: null };
  const kind = match[2].toUpperCase();
  const rawOffset = match[3];
  if (kind === "JST" && !rawOffset) {
    return { rest: match[1].trim(), offsetMinutes: 9 * 60 };
  }
  if ((kind === "GMT" || kind === "UTC") && !rawOffset) {
    return { rest: match[1].trim(), offsetMinutes: 0 };
  }
  if (!rawOffset) return { rest: input.trim(), offsetMinutes: null };
  const offsetMinutes = parseGmtOffset(rawOffset);
  if (offsetMinutes == null) return { rest: input.trim(), offsetMinutes: null };
  return { rest: match[1].trim(), offsetMinutes };
}

function parseGmtOffset(raw: string): number | null {
  const match = raw.replace(/\s+/g, "").match(/^([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  if (hours > 14 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

function stripWeekday(input: string): string {
  return input
    .replace(
      /\s*[(（]\s*(?:(?:月|火|水|木|金|土|日)曜?日?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*[)）]/gi,
      "",
    )
    .replace(
      /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\s*,\s*/i,
      "",
    )
    .trim();
}

function applyMarker(hour: number, marker: string | undefined): number | null {
  if (!marker) {
    if (hour > 23) return null;
    return hour;
  }
  const token = marker.toLowerCase();
  const pm = token === "pm" || token === "午後";
  const am = token === "am" || token === "午前";
  if (!am && !pm) return null;
  if (hour < 1 || hour > 12) return null;
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function parseClock(
  markerBefore: string | undefined,
  hourText: string,
  minuteText: string,
  secondText: string | undefined,
  markerAfter: string | undefined,
): { hour: number; minute: number; second: number } | null {
  if (markerBefore && markerAfter) return null;
  const hour = applyMarker(Number(hourText), markerBefore ?? markerAfter);
  const minute = Number(minuteText);
  const second = secondText ? Number(secondText) : 0;
  if (hour == null || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function parseTimeOnly(text: string): Pick<Side, "hour" | "minute" | "second"> | null {
  const match = text.match(
    /^(午前|午後)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|午前|午後)?$/i,
  );
  if (!match) return null;
  const clock = parseClock(match[1], match[2], match[3], match[4], match[5]);
  if (!clock) return null;
  return clock;
}

function parseJapanese(text: string, offsetMinutes: number | null): Side | null {
  const match = text.match(
    /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*(午前|午後)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|午前|午後)?)?$/i,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!match[5]) {
    return side(year, month, day, null, null, null, offsetMinutes, false);
  }
  const clock = parseClock(match[4], match[5], match[6], match[7], match[8]);
  if (!clock) return null;
  return side(year, month, day, clock.hour, clock.minute, clock.second, offsetMinutes, false);
}

function parseEnglish(text: string, offsetMinutes: number | null): Side | null {
  const match = text.match(
    /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s*(午前|午後)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|午前|午後)?)?$/i,
  );
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return null;
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!match[5]) {
    return side(year, month, day, null, null, null, offsetMinutes, false);
  }
  const clock = parseClock(match[4], match[5], match[6], match[7], match[8]);
  if (!clock) return null;
  return side(year, month, day, clock.hour, clock.minute, clock.second, offsetMinutes, false);
}

function parseIso(text: string, offsetMinutes: number | null): Side | null {
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return side(
      Number(dateOnly[1]),
      Number(dateOnly[2]),
      Number(dateOnly[3]),
      null,
      null,
      null,
      offsetMinutes,
      false,
    );
  }
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/i,
  );
  if (!match) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offset = offsetMinutes;
  if (match[7]) {
    if (match[7].toUpperCase() === "Z") offset = 0;
    else {
      const parsed = parseGmtOffset(match[7]);
      if (parsed == null) return null;
      offset = parsed;
    }
  }
  return side(Number(match[1]), Number(match[2]), Number(match[3]), hour, minute, second, offset, false);
}

function parseSlash(text: string, offsetMinutes: number | null): Side | null {
  const match = text.match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) return null;
  if (!match[4]) {
    return side(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      null,
      null,
      null,
      offsetMinutes,
      false,
    );
  }
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return side(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    hour,
    minute,
    second,
    offsetMinutes,
    false,
  );
}

function side(
  year: number,
  month: number,
  day: number,
  hour: number | null,
  minute: number | null,
  second: number | null,
  offsetMinutes: number | null,
  timeOnly: boolean,
): Side {
  return { year, month, day, hour, minute, second, offsetMinutes, timeOnly };
}
