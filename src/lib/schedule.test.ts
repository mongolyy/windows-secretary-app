import { describe, expect, it } from "vitest";
import enCsv from "../../samples/notion-en.csv?raw";
import jaCsv from "../../samples/notion-ja.csv?raw";
import { buildScheduleView, isStale, parseScheduleCsv, remainingSeconds } from "./schedule";
import type { ColumnSettings, ScheduleEvent } from "./types";

const TZ = "Asia/Tokyo";
const auto: ColumnSettings = {
  autoDetect: true,
  title: "",
  date: "",
  end: "",
  location: "",
  url: "",
};

function event(partial: Partial<ScheduleEvent> & Pick<ScheduleEvent, "id" | "startMs" | "endMs">): ScheduleEvent {
  return {
    title: partial.id,
    allDay: false,
    rowNumber: 2,
    ...partial,
  };
}

describe("parseScheduleCsv", () => {
  it("reads the Japanese and English samples as the same instants", () => {
    const ja = parseScheduleCsv(jaCsv, { timeZone: TZ, columns: auto });
    const en = parseScheduleCsv(enCsv, { timeZone: TZ, columns: auto });
    expect(ja.ok).toBe(true);
    expect(en.ok).toBe(true);
    if (!ja.ok || !en.ok) return;
    expect(ja.schedule.headers).toMatchObject({ title: "名前", date: "日付", location: "場所", url: "URL" });
    expect(en.schedule.headers).toMatchObject({ title: "Name", date: "Date", location: "Location", url: "URL" });
    const stamp = (events: ScheduleEvent[]) =>
      events.map((item) => [item.startMs, item.endMs, item.allDay, item.url ?? ""]);
    expect(stamp(ja.schedule.events)).toEqual(stamp(en.schedule.events));
    expect(ja.schedule.events).toHaveLength(6);
    const weekly = ja.schedule.events.find((item) => item.url?.includes("meet.google.com"));
    expect(weekly?.endMs).toBe((weekly?.startMs ?? 0) + 30 * 60 * 1000);
    expect(ja.schedule.events[0].allDay).toBe(true);
    expect(ja.schedule.events[0].endMs - ja.schedule.events[0].startMs).toBe(2 * 86_400_000);
  });

  it("keeps good rows when one date is unreadable and still warns", () => {
    const csv = [
      "名前,日付,場所,URL",
      "朝会,2026年11月19日 9:00 → 9:15,オンライン,",
      "壊れた,not-a-date,,",
      "週次,2026年11月19日 10:00 → 10:30,会議室A,https://meet.google.com/abc",
      "メモ,2026年11月19日 11:00 → 12:00,,javascript:alert(1)",
    ].join("\n");
    const parsed = parseScheduleCsv(csv, { timeZone: TZ, columns: auto });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schedule.events.map((item) => item.title)).toEqual(["朝会", "週次", "メモ"]);
    expect(parsed.schedule.events[1].url).toBe("https://meet.google.com/abc");
    expect(parsed.schedule.events[2].url).toBeUndefined();
    expect(parsed.schedule.warnings.map((issue) => issue.code)).toEqual(["bad-row", "bad-url"]);
  });

  it("uses a separate end column when the date cell is not already a range", () => {
    const csv = "件名,開始,終了\n定例,2026年11月19日 10:00,10:30\n";
    const parsed = parseScheduleCsv(csv, { timeZone: TZ, columns: auto });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schedule.events[0].endMs - parsed.schedule.events[0].startMs).toBe(30 * 60 * 1000);
  });

  it("honors a manual mapping for unusual headers", () => {
    const csv = "いつ,用件\n2026年11月19日 15:00 → 16:00,顧客\n";
    const parsed = parseScheduleCsv(csv, {
      timeZone: TZ,
      columns: {
        autoDetect: false,
        title: "用件",
        date: "いつ",
        end: "",
        location: "",
        url: "",
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schedule.events[0].title).toBe("顧客");
  });

  it("sniffs a date column when the header is not a known name", () => {
    const csv = "ColA,ColB\n朝会,2026年11月19日 9:00 → 9:15\n定例,2026年11月19日 10:00 → 10:30\n";
    const parsed = parseScheduleCsv(csv, { timeZone: TZ, columns: auto });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.schedule.headers.date).toBe("ColB");
    expect(parsed.schedule.headers.title).toBe("ColA");
  });

  it("fails when every data row is unreadable", () => {
    const parsed = parseScheduleCsv("名前,日付\nA,nope\n", { timeZone: TZ, columns: auto });
    expect(parsed.ok).toBe(false);
  });

  it("accepts a header-only file as an empty schedule", () => {
    const parsed = parseScheduleCsv("名前,日付\n", { timeZone: TZ, columns: auto });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.schedule.events).toEqual([]);
  });

  it("rejects a missing manual column", () => {
    const parsed = parseScheduleCsv("名前,日付\nA,2026年11月19日\n", {
      timeZone: TZ,
      columns: { ...auto, autoDetect: false, title: "件名", date: "日付" },
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0].code).toBe("missing-column");
  });
});

describe("buildScheduleView", () => {
  const day = Date.parse("2026-11-18T15:00:00.000Z");
  const events: ScheduleEvent[] = [
    event({
      id: "all",
      title: "在宅勤務",
      allDay: true,
      startMs: day,
      endMs: day + 2 * 86_400_000,
      rowNumber: 2,
    }),
    event({
      id: "past",
      startMs: Date.parse("2026-11-19T00:00:00.000Z"),
      endMs: Date.parse("2026-11-19T00:15:00.000Z"),
      rowNumber: 3,
    }),
    event({
      id: "long",
      startMs: Date.parse("2026-11-19T12:00:00.000Z"),
      endMs: Date.parse("2026-11-20T00:00:00.000Z"),
      rowNumber: 4,
    }),
    event({
      id: "soon",
      startMs: Date.parse("2026-11-19T13:00:00.000Z"),
      endMs: Date.parse("2026-11-19T13:20:00.000Z"),
      rowNumber: 5,
    }),
    event({
      id: "weekly",
      startMs: Date.parse("2026-11-20T01:00:00.000Z"),
      endMs: Date.parse("2026-11-20T01:30:00.000Z"),
      rowNumber: 6,
    }),
  ];

  it("features the timed event that ends first and counts down to its end", () => {
    const now = Date.parse("2026-11-19T13:10:00.000Z");
    const view = buildScheduleView(events, now, TZ);
    expect(view.current?.id).toBe("soon");
    expect(view.currentRemainingSec).toBe(10 * 60);
    expect(view.allDay.map((item) => item.id)).toEqual(["all"]);
    expect(view.heroAllDay).toBeNull();
    expect(view.next?.id).toBe("weekly");
    expect(view.nextRemainingSec).toBe(remainingSeconds(events[4].startMs, now));
    expect(view.laterToday.map((item) => item.id)).toEqual(["long"]);
  });

  it("starts an event at the start instant and ends it at the end instant", () => {
    const start = Date.parse("2026-11-19T13:00:00.000Z");
    const end = Date.parse("2026-11-19T13:20:00.000Z");
    expect(buildScheduleView(events, start, TZ).current?.id).toBe("soon");
    expect(buildScheduleView(events, end, TZ).current?.id).toBe("long");
  });

  it("does not let tomorrow's all-day hide a meeting on that day", () => {
    const holiday = event({
      id: "holiday",
      allDay: true,
      startMs: Date.parse("2026-11-19T15:00:00.000Z"),
      endMs: Date.parse("2026-11-20T15:00:00.000Z"),
      rowNumber: 7,
    });
    const meeting = event({
      id: "meeting",
      startMs: Date.parse("2026-11-20T01:00:00.000Z"),
      endMs: Date.parse("2026-11-20T01:30:00.000Z"),
      rowNumber: 8,
    });
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const view = buildScheduleView([holiday, meeting], now, TZ);
    expect(view.next?.id).toBe("meeting");
    expect(buildScheduleView([holiday], now, TZ).next?.id).toBe("holiday");
  });

  it("uses Tokyo's calendar day for today's remaining list", () => {
    const now = Date.parse("2026-11-18T14:30:00.000Z");
    const today = event({
      id: "today",
      startMs: Date.parse("2026-11-18T15:30:00.000Z"),
      endMs: Date.parse("2026-11-18T16:00:00.000Z"),
      rowNumber: 2,
    });
    const tomorrow = event({
      id: "tomorrow",
      startMs: Date.parse("2026-11-19T15:30:00.000Z"),
      endMs: Date.parse("2026-11-19T16:00:00.000Z"),
      rowNumber: 3,
    });
    const view = buildScheduleView([today, tomorrow], now, TZ);
    expect(view.next?.id).toBe("today");
    expect(view.laterToday.map((item) => item.id)).toEqual([]);
    const later = buildScheduleView([today, tomorrow], Date.parse("2026-11-18T15:10:00.000Z"), TZ);
    expect(later.next?.id).toBe("today");
    expect(later.laterToday).toEqual([]);
    const afterTodayStarts = buildScheduleView(
      [
        today,
        event({
          id: "also",
          startMs: Date.parse("2026-11-18T16:30:00.000Z"),
          endMs: Date.parse("2026-11-18T17:00:00.000Z"),
          rowNumber: 4,
        }),
      ],
      Date.parse("2026-11-18T15:10:00.000Z"),
      TZ,
    );
    expect(afterTodayStarts.next?.id).toBe("today");
    expect(afterTodayStarts.laterToday.map((item) => item.id)).toEqual(["also"]);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-11-19T01:00:00.000Z");

  it("is stale only after the threshold", () => {
    expect(isStale(now - 24 * 60 * 60 * 1000, now, 1440)).toBe(false);
    expect(isStale(now - 24 * 60 * 60 * 1000 - 1, now, 1440)).toBe(true);
    expect(isStale(null, now, 1440)).toBe(false);
    expect(isStale(now + 60_000, now, 1440)).toBe(false);
  });
});
