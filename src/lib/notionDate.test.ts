import { describe, expect, it } from "vitest";
import { parseNotionDateRange } from "./notionDate";

const TZ = "Asia/Tokyo";

function utc(iso: string): number {
  return Date.parse(iso);
}

function expectRange(
  raw: string,
  expected: { start: string; end: string; allDay: boolean },
  timeZone = TZ,
) {
  const parsed = parseNotionDateRange(raw, timeZone);
  expect(parsed.ok, parsed.ok ? "" : parsed.message).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.allDay).toBe(expected.allDay);
  expect(parsed.startMs).toBe(utc(expected.start));
  expect(parsed.endMs).toBe(utc(expected.end));
}

describe("Notion date cells", () => {
  it.each([
    {
      name: "japanese short range",
      raw: "2026年11月19日 10:00 → 10:30",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "japanese full range",
      raw: "2026年11月19日 10:00 → 2026年11月19日 10:30",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "japanese date only is one local day",
      raw: "2026年11月19日",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-19T15:00:00.000Z",
      allDay: true,
    },
    {
      name: "japanese multi-day end is inclusive",
      raw: "2026年11月19日 → 2026年11月21日",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-21T15:00:00.000Z",
      allDay: true,
    },
    {
      name: "same-day all-day range is one day",
      raw: "2026年11月19日 → 2026年11月19日",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-19T15:00:00.000Z",
      allDay: true,
    },
    {
      name: "gmt+9 matches a zoneless tokyo time",
      raw: "2026年11月19日 10:00 (GMT+9) → 10:30",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "weekday in parentheses is ignored",
      raw: "2026年11月19日（木） 10:00 → 10:30",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "fullwidth digits and colon",
      raw: "２０２６年１１月１９日　１０：００　→　１０：３０",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "japanese afternoon marker",
      raw: "2026年11月19日 午後3:05 → 午後4:00",
      start: "2026-11-19T06:05:00.000Z",
      end: "2026-11-19T07:00:00.000Z",
      allDay: false,
    },
    {
      name: "no space before the time",
      raw: "2026年11月19日10:00 → 10:30",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "english full range",
      raw: "November 19, 2026 10:00 AM → November 19, 2026 10:30 AM",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "english short range",
      raw: "November 19, 2026 10:00 AM → 10:30 AM",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "ascii arrow",
      raw: "November 19, 2026 10:00 AM -> 10:30 AM",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "english date only",
      raw: "November 19, 2026",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-19T15:00:00.000Z",
      allDay: true,
    },
    {
      name: "abbreviated month",
      raw: "Nov 19, 2026",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-19T15:00:00.000Z",
      allDay: true,
    },
    {
      name: "english multi-day inclusive",
      raw: "November 19, 2026 → November 21, 2026",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-21T15:00:00.000Z",
      allDay: true,
    },
    {
      name: "gmt-5",
      raw: "November 19, 2026 10:00 AM (GMT-5)",
      start: "2026-11-19T15:00:00.000Z",
      end: "2026-11-19T16:00:00.000Z",
      allDay: false,
    },
    {
      name: "gmt+05:30",
      raw: "November 19, 2026 10:00 AM (GMT+05:30) → 10:30 AM",
      start: "2026-11-19T04:30:00.000Z",
      end: "2026-11-19T05:00:00.000Z",
      allDay: false,
    },
    {
      name: "lowercase gmt and weekday prefix",
      raw: "Thursday, November 19, 2026 3:05 PM (gmt+9)",
      start: "2026-11-19T06:05:00.000Z",
      end: "2026-11-19T07:05:00.000Z",
      allDay: false,
    },
    {
      name: "midnight and noon",
      raw: "November 19, 2026 12:00 AM → 12:30 AM",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-18T15:30:00.000Z",
      allDay: false,
    },
    {
      name: "noon single time defaults to one hour",
      raw: "November 19, 2026 12:00 PM",
      start: "2026-11-19T03:00:00.000Z",
      end: "2026-11-19T04:00:00.000Z",
      allDay: false,
    },
    {
      name: "overnight shorthand rolls to the next day",
      raw: "2026年11月19日 23:00 → 1:00",
      start: "2026-11-19T14:00:00.000Z",
      end: "2026-11-19T16:00:00.000Z",
      allDay: false,
    },
    {
      name: "iso with offset",
      raw: "2026-11-19T10:00:00+09:00",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T02:00:00.000Z",
      allDay: false,
    },
    {
      name: "iso date",
      raw: "2026-11-19",
      start: "2026-11-18T15:00:00.000Z",
      end: "2026-11-19T15:00:00.000Z",
      allDay: true,
    },
    {
      name: "slash datetime",
      raw: "2026/11/19 10:00 → 10:30",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "seconds",
      raw: "2026年11月19日 10:00:30 → 10:01:00",
      start: "2026-11-19T01:00:30.000Z",
      end: "2026-11-19T01:01:00.000Z",
      allDay: false,
    },
    {
      name: "jst abbreviation",
      raw: "2026年11月19日 10:00 (JST) → 10:30",
      start: "2026-11-19T01:00:00.000Z",
      end: "2026-11-19T01:30:00.000Z",
      allDay: false,
    },
    {
      name: "zoneless new york wall time",
      raw: "November 19, 2026 10:00 AM → 11:00 AM",
      start: "2026-11-19T15:00:00.000Z",
      end: "2026-11-19T16:00:00.000Z",
      allDay: false,
      timeZone: "America/New_York",
    },
  ])("$name", ({ raw, start, end, allDay, timeZone }) => {
    expectRange(raw, { start, end, allDay }, timeZone);
  });

  it.each([
    ["", "日付が空です"],
    ["   ", "日付が空です"],
    ["hello", "日付の形式を解釈できません"],
    ["10:00 → 10:30", "日付がありません"],
    ["November 32, 2026", "ありえない日付です"],
    ["2026年13月1日", "ありえない日付です"],
    ["2026年11月19日 10:00 → 2026年11月19日 9:00", "終了が開始以前です"],
    ["November 19, 2026 10:00 AM → 9:00 AM → 11:00 AM", "日付の期間が多すぎます"],
  ])("rejects %j", (raw, message) => {
    const parsed = parseNotionDateRange(raw, TZ);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toBe(message);
  });
});
