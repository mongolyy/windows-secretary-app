// 画面から Bun プロセスを呼ぶ。ブラウザプレビューでは読み込まない。
import { Electroview } from "electrobun/view";

import type { AppRPC } from "../desktop/rpc";
import type { FiredNotice } from "./notify";
import type { PersistedSettings, SchedulePayload, SettingsDto } from "./types";

type DesktopRpc = {
  request: {
    getSettings(params: Record<string, never>): Promise<SettingsDto>;
    setSettings(params: PersistedSettings): Promise<SettingsDto>;
    loadSchedule(params: Record<string, never>): Promise<SchedulePayload>;
    loadNotified(params: Record<string, never>): Promise<{ records: FiredNotice[] }>;
    saveNotified(params: { records: FiredNotice[] }): Promise<{ ok: true }>;
    scheduleNotifyWake(params: { atMs: number | null }): Promise<{ ok: true }>;
    pickScheduleFile(params: Record<string, never>): Promise<{ path: string | null }>;
    openExternal(params: { url: string }): Promise<{ opened: boolean }>;
    minimizeWindow(params: Record<string, never>): Promise<{ ok: true }>;
    closeWindow(params: Record<string, never>): Promise<{ ok: true }>;
    showMainWindow(params: Record<string, never>): Promise<{ ok: true }>;
    showMeetingNotification(params: { title: string; body: string; url?: string }): Promise<{ shown: boolean }>;
  };
};

const scheduleListeners = new Set<() => void>();
const wakeListeners = new Set<() => void>();

let rpc: DesktopRpc | null = null;

function client(): DesktopRpc {
  if (rpc) return rpc;
  const defined = Electroview.defineRPC<AppRPC>({
    handlers: {
      requests: {},
      messages: {
        scheduleFileChanged: () => {
          for (const listener of scheduleListeners) listener();
        },
        notificationDue: () => {
          for (const listener of wakeListeners) listener();
        },
      },
    },
  });
  new Electroview({ rpc: defined });
  rpc = defined as unknown as DesktopRpc;
  return rpc;
}

export async function fetchSettings(): Promise<SettingsDto> {
  return client().request.getSettings({});
}

export async function saveSettings(settings: SettingsDto): Promise<SettingsDto> {
  const persisted: PersistedSettings = {
    schedulePath: settings.schedulePath,
    autoDetectColumns: settings.autoDetectColumns,
    columns: settings.columns,
    timeZone: settings.timeZone,
    staleThresholdMinutes: settings.staleThresholdMinutes,
    alwaysOnTop: settings.alwaysOnTop,
    closeToTray: settings.closeToTray,
    launchAtLogin: settings.launchAtLogin,
    notifyEnabled: settings.notifyEnabled,
    notifyLeadMinutes: settings.notifyLeadMinutes,
  };
  return client().request.setSettings(persisted);
}

export async function fetchSchedule(): Promise<SchedulePayload> {
  return client().request.loadSchedule({});
}

export async function listenForScheduleChanges(onChange: () => void): Promise<() => void> {
  client();
  scheduleListeners.add(onChange);
  return () => {
    scheduleListeners.delete(onChange);
  };
}

export async function pickScheduleFile(): Promise<string | null> {
  const selected = await client().request.pickScheduleFile({});
  return selected.path;
}

export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  await client().request.openExternal({ url });
}

export async function minimizeWindow(): Promise<void> {
  await client().request.minimizeWindow({});
}

export async function closeWindow(): Promise<void> {
  await client().request.closeWindow({});
}

export async function showMainWindow(): Promise<void> {
  await client().request.showMainWindow({});
}

export async function loadNotified(): Promise<FiredNotice[]> {
  const result = await client().request.loadNotified({});
  return Array.isArray(result.records) ? result.records : [];
}

export async function saveNotified(records: FiredNotice[]): Promise<void> {
  await client().request.saveNotified({ records });
}

export async function scheduleNotifyWake(atMs: number | null): Promise<void> {
  await client().request.scheduleNotifyWake({ atMs });
}

export async function listenForNotifyWake(onWake: () => void): Promise<() => void> {
  client();
  wakeListeners.add(onWake);
  return () => {
    wakeListeners.delete(onWake);
  };
}

export async function showMeetingNotification(notice: { title: string; body: string; url?: string }): Promise<boolean> {
  const result = await client().request.showMeetingNotification({
    title: notice.title,
    body: notice.body,
    url: notice.url,
  });
  return result.shown === true;
}
