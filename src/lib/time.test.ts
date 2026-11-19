import { describe, expect, it } from "vitest";
import { isValidTimeZone, wallTimeToUtcMs, zonedDayBounds, zonedParts } from "./time";

describe("time zones", () => {
  it("accepts IANA names and rejects nonsense", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("interprets a Tokyo wall clock independent of the machine zone", () => {
    expect(wallTimeToUtcMs(2026, 11, 19, 10, 0, 0, "Asia/Tokyo")).toBe(Date.parse("2026-11-19T01:00:00.000Z"));
  });

  it("interprets a New York winter wall clock as UTC-5", () => {
    expect(wallTimeToUtcMs(2026, 11, 19, 10, 0, 0, "America/New_York")).toBe(Date.parse("2026-11-19T15:00:00.000Z"));
  });

  it("treats the Tokyo day as starting at 15:00 UTC the previous day", () => {
    const now = Date.parse("2026-11-18T15:30:00.000Z");
    const parts = zonedParts(now, "Asia/Tokyo");
    expect(parts).toMatchObject({ year: 2026, month: 11, day: 19, hour: 0, minute: 30 });
    expect(zonedDayBounds(now, "Asia/Tokyo")).toEqual({
      startMs: Date.parse("2026-11-18T15:00:00.000Z"),
      endMs: Date.parse("2026-11-19T15:00:00.000Z"),
    });
  });
});
