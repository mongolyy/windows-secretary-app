import path from "node:path";
import { describe, expect, it } from "vitest";

import { eventTargetsSchedule } from "./watch";

describe("予定ファイルの変更判定", () => {
  it("同じフォルダの同じファイル名だけを対象にする", () => {
    const schedule = path.join("home", "ada", "secretary", "schedule.csv");
    expect(eventTargetsSchedule([schedule], schedule)).toBe(true);
    expect(eventTargetsSchedule(["schedule.csv"], schedule)).toBe(true);
    expect(eventTargetsSchedule([path.join("home", "ada", "other", "schedule.csv")], schedule)).toBe(false);
    expect(eventTargetsSchedule([path.dirname(schedule)], schedule)).toBe(false);
  });
});
