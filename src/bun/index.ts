// 秘書の Bun プロセス。ウィンドウ、トレイ、ファイル、通知、自動起動を持つ。
// 自動アップデートは呼ばない。画面とのやり取りは型付き RPC だけ。
import { spawn } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

import { BrowserView, BrowserWindow, Tray, Utils } from "electrobun/main";

import { applyLaunchAtLogin, launchedInTray, type RegResult, type RegRunner } from "../desktop/autostart";
import { readScheduleAt } from "../desktop/files";
import { claimInstance, isPidAlive, takeInstanceRequest } from "../desktop/instance";
import { loadNotified, saveNotified } from "../desktop/notified";
import { defaultPathContext } from "../desktop/paths";
import type { AppRPC } from "../desktop/rpc";
import { effectiveSchedulePath, loadSettings, saveSettings, toDto, validate } from "../desktop/settings";
import { eventTargetsSchedule } from "../desktop/watch";
import { clampWindowSize, shouldHideOnClose } from "../desktop/window-size";

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;

const context = defaultPathContext();
const instanceDir = context.configDir ? path.join(context.configDir, "secretary") : null;
if (instanceDir) {
  const claim = claimInstance(instanceDir, process.argv, process.pid, isPidAlive);
  if (claim.role === "secondary") process.exit(0);
}

const state = {
  settings: loadSettings(context),
  exiting: false,
};

let mainWindow: BrowserWindow | null = null;
let watcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let notifyGeneration = 0;

const rpc = BrowserView.defineRPC<AppRPC>({
  handlers: {
    requests: {
      getSettings: () => toDto(state.settings, context),
      setSettings: async (incoming: import("../lib/types").PersistedSettings) => {
        const previous = state.settings;
        const clean = validate(incoming);
        saveSettings(clean, context);
        state.settings = clean;
        if (clean.launchAtLogin !== previous.launchAtLogin) {
          try {
            await applyLaunchAtLogin(clean.launchAtLogin, process.execPath, windowsRegRunner());
          } catch (error) {
            saveSettings(previous, context);
            state.settings = previous;
            throw error;
          }
        }
        applyAlwaysOnTop(clean.alwaysOnTop);
        restartWatcher();
        return toDto(state.settings, context);
      },
      loadSchedule: () => {
        restartWatcher();
        return readScheduleAt(effectiveSchedulePath(state.settings, context));
      },
      loadNotified: () => ({ records: loadNotified(context) }),
      saveNotified: ({ records }) => {
        saveNotified(records, context);
        return { ok: true as const };
      },
      scheduleNotifyWake: ({ atMs }) => {
        armNotifyWake(atMs);
        return { ok: true as const };
      },
      pickScheduleFile: async () => {
        const current = effectiveSchedulePath(state.settings, context);
        const folder = path.dirname(current);
        const selected = await Utils.openFileDialog({
          startingFolder: existsSync(folder) ? folder : (context.home ?? undefined),
          allowedFileTypes: "csv",
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: false,
        });
        return { path: selected.find((item) => item.trim().length > 0) ?? null };
      },
      openExternal: ({ url }) => {
        if (!/^https?:\/\//i.test(url)) return { opened: false };
        return { opened: Utils.openExternal(url) };
      },
      minimizeWindow: () => {
        mainWindow?.minimize();
        return { ok: true as const };
      },
      closeWindow: () => {
        mainWindow?.close();
        return { ok: true as const };
      },
      showMainWindow: () => {
        showMain();
        return { ok: true as const };
      },
      showMeetingNotification: ({ title, body, url }) => {
        // 通知のボタンは受け取れない。リンクがあるときは本文の末尾に足す。
        const text = url && /^https?:\/\//i.test(url) ? `${body}\n${url}` : body;
        try {
          Utils.showNotification({ title, body: text, silent: false });
          return { shown: true };
        } catch (error) {
          console.error("通知を出せませんでした", error);
          return { shown: false };
        }
      },
    },
    messages: {},
  },
});

const devServer = process.env.SECRETARY_DEV_SERVER?.trim() ?? "";
const initialUrl = LOOPBACK.test(devServer) ? devServer : "views://mainview/index.html";
const startInTray = launchedInTray(process.argv);

const created = new BrowserWindow({
  title: "秘書",
  url: initialUrl,
  frame: { width: 400, height: 700 },
  titleBarStyle: "hidden",
  hidden: startInTray,
  activate: !startInTray,
  rpc,
});
mainWindow = created;

created.setAlwaysOnTop(state.settings.alwaysOnTop);
created.on("will-close", (event) => {
  const closeEvent = event as { response?: { allow: boolean } };
  if (!shouldHideOnClose(state.exiting, state.settings.closeToTray)) return;
  closeEvent.response = { allow: false };
  created.hide();
});
created.on("resize", (event) => {
  const data = (event as { data?: { width?: number; height?: number } }).data;
  if (!data) return;
  const next = clampWindowSize(data.width ?? 400, data.height ?? 700);
  if (next.width !== data.width || next.height !== data.height) created.setSize(next.width, next.height);
});

const tray = new Tray({
  title: "秘書",
  image: trayImage(),
  template: false,
  width: 32,
  height: 32,
});
tray.setMenu([
  { type: "normal", label: "表示", action: "show" },
  { type: "normal", label: "常に手前に表示を切り替え", action: "pin" },
  { type: "separator" },
  { type: "normal", label: "終了", action: "quit" },
]);
tray.on("tray-clicked", (event: unknown) => {
  const action = (event as { data?: { action?: string } }).data?.action ?? "";
  if (action === "" || action === "show") showMain();
  else if (action === "pin") togglePin();
  else if (action === "quit") quit();
});

restartWatcher();
if (process.platform === "win32") {
  void applyLaunchAtLogin(state.settings.launchAtLogin, process.execPath, windowsRegRunner()).catch(
    (error: unknown) => {
      console.error("自動起動の同期に失敗しました", error);
    },
  );
}
if (!startInTray) showMain();

if (instanceDir) {
  setInterval(() => {
    const request = takeInstanceRequest(instanceDir);
    if (request === "show") showMain();
  }, 500);
}

function showMain(): void {
  if (!mainWindow) return;
  mainWindow.unminimize();
  mainWindow.show();
  mainWindow.focus();
}

function togglePin(): void {
  const next = { ...state.settings, alwaysOnTop: !state.settings.alwaysOnTop };
  try {
    saveSettings(next, context);
  } catch (error) {
    console.error("手前固定を保存できませんでした", error);
    return;
  }
  state.settings = next;
  applyAlwaysOnTop(next.alwaysOnTop);
}

function applyAlwaysOnTop(alwaysOnTop: boolean): void {
  mainWindow?.setAlwaysOnTop(alwaysOnTop);
}

function quit(): void {
  state.exiting = true;
  if (notifyTimer) clearTimeout(notifyTimer);
  watcher?.close();
  Utils.quit(0);
}

function restartWatcher(): void {
  watcher?.close();
  watcher = null;
  const schedule = effectiveSchedulePath(state.settings, context);
  const parent = path.dirname(schedule);
  if (!parent || parent === "." || !existsSync(parent)) return;
  try {
    watcher = watch(parent, { persistent: true }, (_eventType, filename) => {
      const name = filename?.toString() ?? "";
      if (name && !eventTargetsSchedule([name, path.join(parent, name)], schedule)) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        rpc.send.scheduleFileChanged({ at: Date.now() });
      }, 400);
    });
  } catch (error) {
    console.error("予定ファイルを監視できません", error);
  }
}

function armNotifyWake(atMs: number | null): void {
  notifyGeneration += 1;
  const generation = notifyGeneration;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = null;
  if (atMs == null) return;
  const tick = () => {
    if (generation !== notifyGeneration || state.exiting) return;
    const now = Date.now();
    if (now >= atMs) {
      rpc.send.notificationDue({ at: now });
      return;
    }
    const slice = Math.min(30_000, Math.max(1, atMs - now));
    notifyTimer = setTimeout(tick, slice);
  };
  tick();
}

function trayImage(): string {
  const bundled = path.join(process.cwd(), "assets", "icons", "32x32.png");
  if (existsSync(bundled)) return bundled;
  return "views://mainview/tray-icon.png";
}

function windowsRegRunner(): RegRunner {
  return (args) =>
    new Promise<RegResult>((resolve) => {
      const child = spawn("reg", args, { windowsHide: true });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({ code: 1, stderr: error.message });
      });
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stderr });
      });
    });
}
