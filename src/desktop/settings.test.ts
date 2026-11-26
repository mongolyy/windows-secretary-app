import path from "node:path";
import { describe, expect, it } from "vitest";

import { defaultSchedulePath } from "./paths";
import { defaultSettings, expandUserPath, resolveSchedulePath, settingsFromText, validate } from "./settings";

describe("設定", () => {
  it("既定の予定ファイルはホームの secretary 配下", () => {
    const home = path.join("Users", "ada");
    expect(defaultSchedulePath(home)).toBe(path.join(home, "secretary", "schedule.csv"));
  });

  it("ホームと USERPROFILE を展開する", () => {
    const home = path.join("home", "ada");
    expect(expandUserPath("~/secretary/schedule.csv", home)).toBe(path.join(home, "secretary", "schedule.csv"));
    const expanded = expandUserPath("%USERPROFILE%/secretary/schedule.csv", home);
    expect(expanded.startsWith(home)).toBe(true);
    expect(expanded.includes("schedule.csv")).toBe(true);
    expect(expandUserPath("~\\secretary\\schedule.csv", home).startsWith(home)).toBe(true);
  });

  it("環境変数が設定より優先される", () => {
    const home = path.join("/home", "ada");
    const resolved = resolveSchedulePath("/tmp/configured.csv", "~/secretary/from-env.csv", home);
    expect(resolved.overridden).toBe(true);
    expect(resolved.path).toBe(path.join(home, "secretary", "from-env.csv"));
  });

  it("空の環境変数は設定を残す", () => {
    const resolved = resolveSchedulePath("/tmp/configured.csv", "   ", "/home/ada");
    expect(resolved.overridden).toBe(false);
    expect(resolved.path).toBe("/tmp/configured.csv");
  });

  it("短すぎる古さのしきい値を拒否する", () => {
    expect(() => validate({ ...defaultSettings("/home/ada"), staleThresholdMinutes: 1 })).toThrow(/しきい値/);
  });

  it("既定は東京で、古さは 1 日", () => {
    const settings = defaultSettings("/home/ada");
    expect(settings.timeZone).toBe("Asia/Tokyo");
    expect(settings.staleThresholdMinutes).toBe(1440);
    expect(settings.autoDetectColumns).toBe(true);
    expect(settings.alwaysOnTop).toBe(true);
    expect(settings.launchAtLogin).toBe(false);
    expect(settings.notifyEnabled).toBe(true);
    expect(settings.notifyLeadMinutes).toBe(5);
  });

  it("古い設定ファイルはログインと通知の既定を補う", () => {
    const settings = settingsFromText("{}", "/home/ada");
    expect(settings.launchAtLogin).toBe(false);
    expect(settings.notifyEnabled).toBe(true);
    expect(settings.notifyLeadMinutes).toBe(5);
    expect(settings.schedulePath).toBe(path.join("/home/ada", "secretary", "schedule.csv"));
  });

  it("範囲外の通知分数を拒否する", () => {
    expect(() => validate({ ...defaultSettings(null), notifyLeadMinutes: 0 })).toThrow(/通知/);
    expect(() => validate({ ...defaultSettings(null), notifyLeadMinutes: 181 })).toThrow(/通知/);
  });

  it("壊れた JSON は既定に戻す", () => {
    expect(settingsFromText("{", null).timeZone).toBe("Asia/Tokyo");
  });
});
