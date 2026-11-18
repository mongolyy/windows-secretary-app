import { describe, expect, it } from "vitest";
import { formatAge, formatCountdown, formatEventWhen, formatNow, formatRemainingPhrase } from "./format";

const TZ = "Asia/Tokyo";
const now = Date.parse("2026-11-18T14:21:00.000Z");

describe("format", () => {
  it("formats countdown clocks", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(45)).toBe("00:45");
    expect(formatCountdown(125)).toBe("02:05");
    expect(formatCountdown(3600 + 70)).toBe("1:01:10");
    expect(formatCountdown(86_400 + 3 * 3600 + 4)).toBe("1日 03:00:04");
  });

  it("formats spoken remainders", () => {
    expect(formatRemainingPhrase(45)).toBe("45秒");
    expect(formatRemainingPhrase(120)).toBe("2分");
    expect(formatRemainingPhrase(130)).toBe("2分10秒");
    expect(formatRemainingPhrase(3600)).toBe("1時間");
    expect(formatRemainingPhrase(3900)).toBe("1時間5分");
    expect(formatRemainingPhrase(2 * 86_400 + 3 * 3600)).toBe("2日3時間");
  });

  it("formats file age and the footer clock in Tokyo", () => {
    expect(formatAge(30_000)).toBe("1分未満");
    expect(formatAge(5 * 60_000)).toBe("5分前");
    expect(formatAge(3 * 3_600_000)).toBe("3時間前");
    expect(formatAge(2 * 86_400_000)).toBe("2日前");
    expect(formatNow(now, TZ)).toBe("11月18日（水）23:21");
  });

  it("labels today, tomorrow, and all-day spans", () => {
    const start = Date.parse("2026-11-18T12:00:00.000Z");
    const end = Date.parse("2026-11-19T00:00:00.000Z");
    expect(formatEventWhen(start, end, false, now, TZ)).toBe("今日 21:00 – 明日 09:00");
    const meeting = Date.parse("2026-11-19T01:00:00.000Z");
    expect(formatEventWhen(meeting, meeting + 30 * 60_000, false, now, TZ)).toBe("明日 10:00–10:30");
    const allStart = Date.parse("2026-11-17T15:00:00.000Z");
    const allEnd = Date.parse("2026-11-19T15:00:00.000Z");
    expect(formatEventWhen(allStart, allEnd, true, now, TZ)).toBe("11月18日（水）–11月19日（木） 終日");
  });
});
