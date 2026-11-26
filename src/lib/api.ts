import type { FiredNotice } from "./notify";
import { DEFAULT_NOTIFY_LEAD_MINUTES } from "./notify";
import type { SchedulePayload, SettingsDto } from "./types";
import { DEFAULT_COLUMNS, DEFAULT_STALE_MINUTES, DEFAULT_TIME_ZONE } from "./types";

export type PreviewKind = "ja" | "en" | "missing" | "broken" | "stale";

const STORAGE_KEY = "secretary.settings.v1";

let previewKind: PreviewKind = "ja";

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__electrobun" in window;
}

async function desktop() {
  return import("./desktop");
}

export function setPreviewKind(kind: PreviewKind): void {
  previewKind = kind;
}

export function getPreviewKind(): PreviewKind {
  return previewKind;
}

export async function fetchSettings(): Promise<SettingsDto> {
  if (!isDesktop()) return loadPreviewSettings();
  return (await desktop()).fetchSettings();
}

export async function saveSettings(settings: SettingsDto): Promise<SettingsDto> {
  if (!isDesktop()) {
    const next = { ...settings, pathOverriddenByEnv: false };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }
  return (await desktop()).saveSettings(settings);
}

export async function fetchSchedule(): Promise<SchedulePayload> {
  if (!isDesktop()) return previewSchedule();
  return (await desktop()).fetchSchedule();
}

export async function listenForScheduleChanges(onChange: () => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  return (await desktop()).listenForScheduleChanges(onChange);
}

export async function pickScheduleFile(): Promise<string | null> {
  if (!isDesktop()) return null;
  return (await desktop()).pickScheduleFile();
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (!isDesktop()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await (await desktop()).openExternal(url);
}

export async function minimizeWindow(): Promise<void> {
  if (!isDesktop()) return;
  await (await desktop()).minimizeWindow();
}

export async function closeWindow(): Promise<void> {
  if (!isDesktop()) return;
  await (await desktop()).closeWindow();
}

export async function showMainWindow(): Promise<void> {
  if (!isDesktop()) return;
  await (await desktop()).showMainWindow();
}

export async function loadNotified(): Promise<FiredNotice[]> {
  if (!isDesktop()) return [];
  return (await desktop()).loadNotified();
}

export async function saveNotified(records: FiredNotice[]): Promise<void> {
  if (!isDesktop()) return;
  await (await desktop()).saveNotified(records);
}

export async function scheduleNotifyWake(atMs: number | null): Promise<void> {
  if (!isDesktop()) return;
  await (await desktop()).scheduleNotifyWake(atMs);
}

export async function listenForNotifyWake(onWake: () => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  return (await desktop()).listenForNotifyWake(onWake);
}

/**
 * 通知のボタンは、Electrobun の Windows 通知では受け取れない。
 * 参加リンクは画面の「参加する」から開く。
 */
export async function listenForNotificationActions(
  onJoin: (url: string) => void,
  onOpenApp: () => void,
): Promise<void> {
  void onJoin;
  void onOpenApp;
}

export async function showMeetingNotification(notice: { title: string; body: string; url?: string }): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    return (await desktop()).showMeetingNotification(notice);
  } catch {
    return false;
  }
}

function loadPreviewSettings(): SettingsDto {
  const defaults = defaultSettings("samples/notion-ja.csv");
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SettingsDto>;
    return {
      ...defaults,
      ...parsed,
      columns: { ...defaults.columns, ...parsed.columns },
      pathOverriddenByEnv: false,
    };
  } catch {
    return defaults;
  }
}

function defaultSettings(path: string): SettingsDto {
  return {
    schedulePath: path,
    autoDetectColumns: true,
    columns: { ...DEFAULT_COLUMNS },
    timeZone: DEFAULT_TIME_ZONE,
    staleThresholdMinutes: DEFAULT_STALE_MINUTES,
    alwaysOnTop: true,
    closeToTray: true,
    launchAtLogin: false,
    notifyEnabled: true,
    notifyLeadMinutes: DEFAULT_NOTIFY_LEAD_MINUTES,
    effectiveSchedulePath: path,
    pathOverriddenByEnv: false,
  };
}

async function previewSchedule(): Promise<SchedulePayload> {
  if (previewKind === "missing") {
    return {
      path: "~/secretary/schedule.csv",
      ioStatus: "missing",
      message: "予定ファイルが見つかりません",
      contents: null,
      mtimeMs: null,
    };
  }
  if (previewKind === "broken") {
    return {
      path: "~/secretary/schedule.csv",
      ioStatus: "ok",
      message: null,
      contents: '名前,日付\n"引用符が閉じられていない,2026年11月19日\n',
      mtimeMs: Date.now(),
    };
  }
  const sample =
    previewKind === "en"
      ? (await import("../../samples/notion-en.csv?raw")).default
      : (await import("../../samples/notion-ja.csv?raw")).default;
  const age = previewKind === "stale" ? 3 * 24 * 60 * 60 * 1000 : 0;
  return {
    path: previewKind === "en" ? "samples/notion-en.csv" : "samples/notion-ja.csv",
    ioStatus: "ok",
    message: null,
    contents: sample,
    mtimeMs: Date.now() - age,
  };
}
