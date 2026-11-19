import { describe, expect, it } from "vitest";
import { formatHm } from "./format";
import {
  DEFAULT_NOTIFY_LEAD_MINUTES,
  notificationCopy,
  notificationKey,
  planNotifications,
  rememberFired,
  type FiredNotice,
  type NotifySettings,
} from "./notify";
import type { ScheduleEvent } from "./types";

const TZ = "Asia/Tokyo";
const LEAD = DEFAULT_NOTIFY_LEAD_MINUTES;
const MINUTE = 60_000;

/** 2026-11-19 10:00 JST。 */
const AT_10 = Date.UTC(2026, 10, 19, 1, 0, 0);

const enabled: NotifySettings = { enabled: true, leadMinutes: LEAD };

function meeting(partial: Partial<ScheduleEvent> & Pick<ScheduleEvent, "title" | "startMs">): ScheduleEvent {
  return {
    id: partial.id ?? `row-${partial.rowNumber ?? 2}`,
    endMs: partial.endMs ?? partial.startMs + 30 * MINUTE,
    allDay: partial.allDay ?? false,
    rowNumber: partial.rowNumber ?? 2,
    ...partial,
  };
}

describe("notificationKey", () => {
  it("ignores the row number so a re-export of the same meeting stays one event", () => {
    const first = meeting({ id: "row-2", title: "定例", startMs: AT_10, rowNumber: 2, location: "A" });
    const reloaded = meeting({
      id: "row-9",
      title: "定例",
      startMs: AT_10,
      rowNumber: 9,
      location: "B",
      url: "https://meet.example/abc",
    });
    expect(notificationKey(first)).toBe(notificationKey(reloaded));
  });

  it("changes when the start time changes", () => {
    const original = meeting({ title: "定例", startMs: AT_10 });
    const moved = meeting({ title: "定例", startMs: AT_10 + 30 * MINUTE });
    expect(notificationKey(original)).not.toBe(notificationKey(moved));
  });

  it("collapses extra whitespace in the title", () => {
    expect(notificationKey(meeting({ title: " 朝会  ", startMs: AT_10 }))).toBe(
      notificationKey(meeting({ title: "朝会", startMs: AT_10 })),
    );
  });
});

describe("planNotifications", () => {
  it("waits until the lead time of the next timed event", () => {
    const event = meeting({ title: "定例", startMs: AT_10, location: "会議室A" });
    const early = planNotifications([event], AT_10 - 30 * MINUTE, enabled, []);
    expect(early.due).toEqual([]);
    expect(early.nextFireAtMs).toBe(AT_10 - LEAD * MINUTE);

    const boundary = planNotifications([event], AT_10 - LEAD * MINUTE, enabled, []);
    expect(boundary.due.map((item) => item.event.title)).toEqual(["定例"]);
    expect(boundary.nextFireAtMs).toBeNull();
  });

  it("fires immediately when the app starts inside the lead window", () => {
    const event = meeting({ title: "定例", startMs: AT_10 });
    const plan = planNotifications([event], AT_10 - 2 * MINUTE, enabled, []);
    expect(plan.due).toHaveLength(1);
    expect(plan.due[0]?.event).toBe(event);
  });

  it("does not fire after the event has started", () => {
    const event = meeting({ title: "定例", startMs: AT_10, endMs: AT_10 + 30 * MINUTE });
    const plan = planNotifications([event], AT_10, enabled, []);
    expect(plan.due).toEqual([]);
    expect(plan.nextFireAtMs).toBeNull();
  });

  it("does nothing when notifications are off or the lead is invalid", () => {
    const event = meeting({ title: "定例", startMs: AT_10 });
    const now = AT_10 - MINUTE;
    expect(planNotifications([event], now, { enabled: false, leadMinutes: LEAD }, []).due).toEqual([]);
    expect(planNotifications([event], now, { enabled: true, leadMinutes: 0 }, []).due).toEqual([]);
    expect(planNotifications([event], now, { enabled: true, leadMinutes: 1.5 }, []).nextFireAtMs).toBeNull();
  });

  it("skips all-day events and notifies the next timed meeting", () => {
    const allDay = meeting({
      title: "出張",
      startMs: AT_10 - 10 * 60 * MINUTE,
      endMs: AT_10 + 14 * 60 * MINUTE,
      allDay: true,
    });
    const later = meeting({ title: "顧客", startMs: AT_10 + 2 * 60 * MINUTE, rowNumber: 4 });
    const plan = planNotifications([allDay, later], AT_10 - LEAD * MINUTE, enabled, []);
    expect(plan.due).toEqual([]);
    expect(plan.nextFireAtMs).toBe(later.startMs - LEAD * MINUTE);
  });

  it("does not notify the same event again after a CSV reload", () => {
    const original = meeting({ id: "row-2", title: "定例", startMs: AT_10, rowNumber: 2 });
    const first = planNotifications([original], AT_10 - LEAD * MINUTE, enabled, []);
    const fired: FiredNotice[] = [{ key: first.due[0]!.key, startMs: AT_10 }];
    const reloaded = meeting({
      id: "row-6",
      title: "定例",
      startMs: AT_10,
      rowNumber: 6,
      location: "別室",
    });
    const again = planNotifications([reloaded], AT_10 - 4 * MINUTE, enabled, fired);
    expect(again.due).toEqual([]);
  });

  it("schedules the new time when a re-export moves the meeting", () => {
    const original = meeting({ title: "定例", startMs: AT_10 });
    const fired: FiredNotice[] = [{ key: notificationKey(original), startMs: AT_10 }];
    const moved = meeting({ title: "定例", startMs: AT_10 + 30 * MINUTE, location: "オンライン" });
    const before = planNotifications([moved], AT_10, enabled, fired);
    expect(before.due).toEqual([]);
    expect(before.nextFireAtMs).toBe(moved.startMs - LEAD * MINUTE);

    const due = planNotifications([moved], moved.startMs - LEAD * MINUTE, enabled, fired);
    expect(due.due.map((item) => item.event.startMs)).toEqual([moved.startMs]);
    expect(due.due[0]?.key).not.toBe(fired[0]?.key);
  });

  it("notifies a later meeting even when the earlier one was already sent", () => {
    const first = meeting({ title: "朝会", startMs: AT_10, rowNumber: 2 });
    const second = meeting({ title: "設計", startMs: AT_10 + 20 * MINUTE, rowNumber: 3 });
    const fired: FiredNotice[] = [{ key: notificationKey(first), startMs: first.startMs }];
    const now = second.startMs - LEAD * MINUTE;
    const plan = planNotifications([first, second], now, enabled, fired);
    expect(plan.due.map((item) => item.event.title)).toEqual(["設計"]);
  });

  it("fires every meeting that is already inside its lead window", () => {
    const first = meeting({ title: "朝会", startMs: AT_10, rowNumber: 2 });
    const second = meeting({ title: "設計", startMs: AT_10 + 3 * MINUTE, rowNumber: 3 });
    const later = meeting({ title: "昼会", startMs: AT_10 + 60 * MINUTE, rowNumber: 4 });
    const plan = planNotifications([later, first, second], AT_10 - MINUTE, enabled, []);
    expect(plan.due.map((item) => item.event.title)).toEqual(["朝会", "設計"]);
    expect(plan.nextFireAtMs).toBe(later.startMs - LEAD * MINUTE);
  });

  it("treats two rows with the same title and start as one notice", () => {
    const a = meeting({ title: "定例", startMs: AT_10, rowNumber: 2 });
    const b = meeting({ title: "定例", startMs: AT_10, rowNumber: 3, url: "https://meet.example/a" });
    const plan = planNotifications([a, b], AT_10 - MINUTE, enabled, []);
    expect(plan.due).toHaveLength(1);
    expect(plan.due[0]?.event).toBe(a);
  });
});

describe("rememberFired", () => {
  it("keeps the key across reloads and drops week-old records", () => {
    const event = meeting({ title: "定例", startMs: AT_10 });
    const due = planNotifications([event], AT_10 - MINUTE, enabled, []).due;
    const kept = rememberFired([], due, AT_10 - MINUTE);
    expect(kept).toEqual([{ key: notificationKey(event), startMs: AT_10 }]);
    expect(rememberFired(kept, [], AT_10 - MINUTE)).toEqual(kept);

    const stale = rememberFired(kept, [], AT_10 + 8 * 24 * 60 * MINUTE);
    expect(stale).toEqual([]);
  });

  it("does not store the same key twice", () => {
    const event = meeting({ title: "定例", startMs: AT_10 });
    const due = planNotifications([event], AT_10 - MINUTE, enabled, []).due;
    const once = rememberFired([], due, AT_10);
    expect(rememberFired(once, due, AT_10)).toEqual(once);
  });
});

describe("notificationCopy", () => {
  it("shows the title, start time, and location", () => {
    const event = meeting({ title: "企画会議", startMs: AT_10, location: "本社 3F" });
    const copy = notificationCopy(event, AT_10 - 5 * MINUTE, TZ);
    expect(copy.title).toBe("企画会議");
    expect(copy.body).toBe(`あと5分（${formatHm(AT_10, TZ)} 開始）\n場所: 本社 3F`);
    expect(formatHm(AT_10, TZ)).toBe("10:00");
  });

  it("omits the location line when the event has none", () => {
    const copy = notificationCopy(meeting({ title: "朝会", startMs: AT_10 }), AT_10 - 30_000, TZ);
    expect(copy.body).toBe("まもなく（10:00 開始）");
    expect(copy.body).not.toContain("場所");
  });

  it("includes the date when the notice crosses midnight", () => {
    const start = Date.UTC(2026, 10, 18, 15, 2, 0);
    const now = Date.UTC(2026, 10, 18, 14, 57, 0);
    const copy = notificationCopy(meeting({ title: "深夜", startMs: start, location: "オンライン" }), now, TZ);
    expect(copy.body).toContain("11月19日 00:02 開始");
    expect(copy.body).toContain("場所: オンライン");
  });
});
