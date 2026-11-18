import type { SchedulePayload, SettingsDto } from "./types";
import { DEFAULT_COLUMNS, DEFAULT_STALE_MINUTES, DEFAULT_TIME_ZONE } from "./types";

export type PreviewKind = "ja" | "en" | "missing" | "broken" | "stale";

const STORAGE_KEY = "secretary.settings.v1";

let previewKind: PreviewKind = "ja";

export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function setPreviewKind(kind: PreviewKind): void {
  previewKind = kind;
}

export function getPreviewKind(): PreviewKind {
  return previewKind;
}

export async function fetchSettings(): Promise<SettingsDto> {
  if (!isDesktop()) return loadPreviewSettings();
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SettingsDto>("get_settings");
}

export async function saveSettings(settings: SettingsDto): Promise<SettingsDto> {
  if (!isDesktop()) {
    const next = { ...settings, pathOverriddenByEnv: false };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SettingsDto>("set_settings", { incoming: settings });
}

export async function fetchSchedule(): Promise<SchedulePayload> {
  if (!isDesktop()) return previewSchedule();
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SchedulePayload>("load_schedule");
}

export async function listenForScheduleChanges(onChange: () => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen("schedule-file-changed", () => onChange());
}

export async function pickScheduleFile(): Promise<string | null> {
  if (!isDesktop()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    title: "予定のCSVを選択",
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (!isDesktop()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export async function minimizeWindow(): Promise<void> {
  if (!isDesktop()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function closeWindow(): Promise<void> {
  if (!isDesktop()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
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
