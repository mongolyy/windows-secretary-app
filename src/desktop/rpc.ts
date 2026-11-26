// 画面と Bun プロセスが共有する RPC の形。実行時の依存は持たない。
import type { RPCSchema } from "electrobun/main";

import type { FiredNotice } from "../lib/notify";
import type { PersistedSettings, SchedulePayload, SettingsDto } from "../lib/types";

export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      getSettings: { params: Record<string, never>; response: SettingsDto };
      setSettings: { params: PersistedSettings; response: SettingsDto };
      loadSchedule: { params: Record<string, never>; response: SchedulePayload };
      loadNotified: { params: Record<string, never>; response: { records: FiredNotice[] } };
      saveNotified: { params: { records: FiredNotice[] }; response: { ok: true } };
      scheduleNotifyWake: { params: { atMs: number | null }; response: { ok: true } };
      pickScheduleFile: { params: Record<string, never>; response: { path: string | null } };
      openExternal: { params: { url: string }; response: { opened: boolean } };
      minimizeWindow: { params: Record<string, never>; response: { ok: true } };
      closeWindow: { params: Record<string, never>; response: { ok: true } };
      showMainWindow: { params: Record<string, never>; response: { ok: true } };
      showMeetingNotification: {
        params: { title: string; body: string; url?: string };
        response: { shown: boolean };
      };
    };
  }>;
  webview: RPCSchema<{
    messages: {
      scheduleFileChanged: { at: number };
      notificationDue: { at: number };
    };
  }>;
};
