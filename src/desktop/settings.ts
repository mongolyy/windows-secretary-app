// 設定の検証と読み書き。画面に出す文言は、これまでの設定ファイルと同じにする。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_NOTIFY_LEAD_MINUTES } from "../lib/notify";
import type { PersistedSettings, SettingsDto } from "../lib/types";
import { DEFAULT_COLUMNS, DEFAULT_STALE_MINUTES, DEFAULT_TIME_ZONE } from "../lib/types";

import { defaultSchedulePath, settingsFilePath, type PathContext } from "./paths";

const FAIL = Symbol("fail");

export function defaultSettings(home: string | null): PersistedSettings {
  return {
    schedulePath: defaultSchedulePath(home),
    autoDetectColumns: true,
    columns: { ...DEFAULT_COLUMNS },
    timeZone: DEFAULT_TIME_ZONE,
    staleThresholdMinutes: DEFAULT_STALE_MINUTES,
    alwaysOnTop: true,
    closeToTray: true,
    launchAtLogin: false,
    notifyEnabled: true,
    notifyLeadMinutes: DEFAULT_NOTIFY_LEAD_MINUTES,
  };
}

export function expandUserPath(raw: string, home: string | null): string {
  const trimmed = raw.trim();
  if (home == null) return trimmed;
  let expanded = trimmed;
  for (const token of ["%USERPROFILE%", "%userprofile%"]) {
    if (expanded.includes(token)) expanded = expanded.replaceAll(token, home);
  }
  if (expanded === "~") return home;
  if (expanded.startsWith("~/") || expanded.startsWith("~\\")) return path.join(home, expanded.slice(2));
  return expanded;
}

export function resolveSchedulePath(
  configured: string,
  envOverride: string | null | undefined,
  home: string | null,
): { path: string; overridden: boolean } {
  if (envOverride != null) {
    const trimmed = envOverride.trim();
    if (trimmed.length > 0) return { path: expandUserPath(trimmed, home), overridden: true };
  }
  return { path: expandUserPath(configured, home), overridden: false };
}

export function toDto(settings: PersistedSettings, context: PathContext): SettingsDto {
  const resolved = resolveSchedulePath(settings.schedulePath, context.envSchedulePath, context.home);
  return {
    ...settings,
    columns: { ...settings.columns },
    effectiveSchedulePath: resolved.path,
    pathOverriddenByEnv: resolved.overridden,
  };
}

export function effectiveSchedulePath(settings: PersistedSettings, context: PathContext): string {
  return toDto(settings, context).effectiveSchedulePath;
}

export function validate(input: PersistedSettings): PersistedSettings {
  const schedulePath = input.schedulePath.trim();
  if (!schedulePath) throw new Error("予定ファイルのパスを入力してください");
  if ([...schedulePath].length > 4096 || schedulePath.includes("\n") || schedulePath.includes("\r")) {
    throw new Error("予定ファイルのパスが不正です");
  }
  if (
    !Number.isInteger(input.staleThresholdMinutes) ||
    input.staleThresholdMinutes < 5 ||
    input.staleThresholdMinutes > 20160
  ) {
    throw new Error("古さのしきい値は 5 分から 20160 分にしてください");
  }
  const timeZone = input.timeZone.trim();
  if (!validTimeZoneName(timeZone)) throw new Error("タイムゾーンの名前が不正です");
  if (!Number.isInteger(input.notifyLeadMinutes) || input.notifyLeadMinutes < 1 || input.notifyLeadMinutes > 180) {
    throw new Error("通知は 1 分前から 180 分前にしてください");
  }
  return {
    schedulePath,
    autoDetectColumns: input.autoDetectColumns,
    columns: {
      title: cleanColumn(input.columns.title),
      date: cleanColumn(input.columns.date),
      end: cleanColumn(input.columns.end),
      location: cleanColumn(input.columns.location),
      url: cleanColumn(input.columns.url),
    },
    timeZone,
    staleThresholdMinutes: input.staleThresholdMinutes,
    alwaysOnTop: input.alwaysOnTop,
    closeToTray: input.closeToTray,
    launchAtLogin: input.launchAtLogin,
    notifyEnabled: input.notifyEnabled,
    notifyLeadMinutes: input.notifyLeadMinutes,
  };
}

export function settingsFromText(text: string, home: string | null): PersistedSettings {
  const defaults = defaultSettings(home);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return defaults;
  }
  const object = asRecord(parsed);
  if (!object) return defaults;
  const columns = asRecord(object.columns);
  const schedulePath = readString(object, "schedulePath", defaults.schedulePath);
  const autoDetectColumns = readBool(object, "autoDetectColumns", defaults.autoDetectColumns);
  const title = readString(columns ?? {}, "title", defaults.columns.title);
  const date = readString(columns ?? {}, "date", defaults.columns.date);
  const end = readString(columns ?? {}, "end", defaults.columns.end);
  const location = readString(columns ?? {}, "location", defaults.columns.location);
  const url = readString(columns ?? {}, "url", defaults.columns.url);
  const timeZone = readString(object, "timeZone", defaults.timeZone);
  const staleThresholdMinutes = readInt(object, "staleThresholdMinutes", defaults.staleThresholdMinutes);
  const alwaysOnTop = readBool(object, "alwaysOnTop", defaults.alwaysOnTop);
  const closeToTray = readBool(object, "closeToTray", defaults.closeToTray);
  const launchAtLogin = readBool(object, "launchAtLogin", defaults.launchAtLogin);
  const notifyEnabled = readBool(object, "notifyEnabled", defaults.notifyEnabled);
  const notifyLeadMinutes = readInt(object, "notifyLeadMinutes", defaults.notifyLeadMinutes);
  if (
    schedulePath === FAIL ||
    autoDetectColumns === FAIL ||
    title === FAIL ||
    date === FAIL ||
    end === FAIL ||
    location === FAIL ||
    url === FAIL ||
    timeZone === FAIL ||
    staleThresholdMinutes === FAIL ||
    alwaysOnTop === FAIL ||
    closeToTray === FAIL ||
    launchAtLogin === FAIL ||
    notifyEnabled === FAIL ||
    notifyLeadMinutes === FAIL
  ) {
    return defaults;
  }
  try {
    return validate({
      schedulePath,
      autoDetectColumns,
      columns: { title, date, end, location, url },
      timeZone,
      staleThresholdMinutes,
      alwaysOnTop,
      closeToTray,
      launchAtLogin,
      notifyEnabled,
      notifyLeadMinutes,
    });
  } catch {
    return defaults;
  }
}

export function loadSettings(context: PathContext): PersistedSettings {
  const file = settingsFilePath(context.configDir);
  if (!file) return defaultSettings(context.home);
  try {
    return settingsFromText(readFileSync(file, "utf8"), context.home);
  } catch {
    return defaultSettings(context.home);
  }
}

export function saveSettings(settings: PersistedSettings, context: PathContext): void {
  const file = settingsFilePath(context.configDir);
  if (!file) throw new Error("設定を保存する場所を決められません");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function validTimeZoneName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 64 &&
    !value.startsWith("/") &&
    [...value].every((char) => /[A-Za-z0-9/_+-]/.test(char))
  );
}

function cleanColumn(value: string): string {
  const trimmed = value.trim();
  if ([...trimmed].length > 200) throw new Error("列名が長すぎます");
  if (trimmed.includes("\n") || trimmed.includes("\r")) throw new Error("列名に改行は使えません");
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(object: Record<string, unknown>, key: string, fallback: string): string | typeof FAIL {
  if (!Object.hasOwn(object, key)) return fallback;
  return typeof object[key] === "string" ? object[key] : FAIL;
}

function readBool(object: Record<string, unknown>, key: string, fallback: boolean): boolean | typeof FAIL {
  if (!Object.hasOwn(object, key)) return fallback;
  return typeof object[key] === "boolean" ? object[key] : FAIL;
}

function readInt(object: Record<string, unknown>, key: string, fallback: number): number | typeof FAIL {
  if (!Object.hasOwn(object, key)) return fallback;
  const value = object[key];
  return typeof value === "number" && Number.isInteger(value) ? value : FAIL;
}
