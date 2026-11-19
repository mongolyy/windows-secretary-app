import {
  closeWindow,
  fetchSchedule,
  fetchSettings,
  getPreviewKind,
  isDesktop,
  listenForNotificationActions,
  listenForNotifyWake,
  listenForScheduleChanges,
  loadNotified,
  minimizeWindow,
  openExternal,
  pickScheduleFile,
  saveNotified,
  saveSettings,
  scheduleNotifyWake,
  setPreviewKind,
  showMainWindow,
  showMeetingNotification,
  type PreviewKind,
} from "./lib/api";
import {
  MAX_NOTIFY_LEAD_MINUTES,
  MIN_NOTIFY_LEAD_MINUTES,
  notificationCopy,
  planNotifications,
  rememberFired,
  type FiredNotice,
} from "./lib/notify";
import { isValidTimeZone } from "./lib/time";
import { buildScheduleView, isStale, parseScheduleCsv, type ParsedSchedule } from "./lib/schedule";
import type { ParseIssue, SchedulePayload, SettingsDto } from "./lib/types";
import { renderScreen, updateLiveReadout, type ScreenModel } from "./view";

const viewRoot = document.querySelector("#view");
const dialogRoot = document.querySelector("#settings-dialog");
const previewBar = document.querySelector("#preview-bar");
if (!(viewRoot instanceof HTMLElement) || !(dialogRoot instanceof HTMLDialogElement)) {
  throw new Error("画面の初期化に失敗しました");
}
const view: HTMLElement = viewRoot;
const dialog: HTMLDialogElement = dialogRoot;

let settings: SettingsDto | null = null;
let firedLog: FiredNotice[] | null = null;
let notifying = false;
let scheduledFor: number | null | undefined;
let payload: SchedulePayload | null = null;
let schedule: ParsedSchedule | null = null;
let issues: ParseIssue[] = [];
let usingLastGood = false;
let lastGood: ParsedSchedule | null = null;
let statusKind: ScreenModel["kind"] = "loading";
let renderedKey = "";

void boot();

async function boot(): Promise<void> {
  tick(true);
  if (!isDesktop() && import.meta.env.DEV && previewBar instanceof HTMLElement) {
    previewBar.hidden = false;
    previewBar.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const kind = target.dataset.preview as PreviewKind | undefined;
      if (!kind) return;
      setPreviewKind(kind);
      lastGood = null;
      renderedKey = "";
      void reload();
    });
  }
  wireSettings();
  try {
    await listenForNotificationActions(
      (url) => {
        void openExternal(url);
      },
      () => {
        void showMainWindow();
      },
    );
  } catch {
    // 通知のボタンを登録できなくても、予定の表示は続ける。
  }
  await listenForNotifyWake(() => {
    void syncNotifications(Date.now());
  });
  settings = await fetchSettings();
  firedLog = await loadNotified();
  await listenForScheduleChanges(() => {
    void reload();
  });
  await reload();
  window.setInterval(() => {
    tick(false);
    void syncNotifications(Date.now());
  }, 1000);
  window.setInterval(() => {
    void reload();
  }, 20_000);
}

async function reload(): Promise<void> {
  try {
    payload = await fetchSchedule();
  } catch (error) {
    statusKind = "unreadable";
    payload = {
      path: settings?.effectiveSchedulePath ?? "",
      ioStatus: "unreadable",
      message: error instanceof Error ? error.message : "予定を読めませんでした",
      contents: null,
      mtimeMs: null,
    };
    schedule = null;
    tick(true);
    await syncNotifications(Date.now());
    return;
  }

  if (payload.ioStatus === "ok" && payload.contents != null && settings) {
    const parsed = parseScheduleCsv(payload.contents, {
      timeZone: settings.timeZone,
      columns: {
        autoDetect: settings.autoDetectColumns,
        ...settings.columns,
      },
    });
    if (parsed.ok) {
      lastGood = parsed.schedule;
      schedule = parsed.schedule;
      issues = parsed.schedule.warnings;
      usingLastGood = false;
      statusKind = "ready";
    } else if (lastGood) {
      schedule = lastGood;
      issues = parsed.issues;
      usingLastGood = true;
      statusKind = "ready";
    } else {
      schedule = null;
      issues = parsed.issues;
      usingLastGood = false;
      statusKind = "invalid";
    }
  } else if (payload.ioStatus === "missing") {
    lastGood = null;
    schedule = null;
    issues = [];
    usingLastGood = false;
    statusKind = "missing";
  } else {
    schedule = null;
    issues = [];
    usingLastGood = false;
    statusKind = "unreadable";
  }
  tick(true);
  await syncNotifications(Date.now());
}

function tick(force: boolean): void {
  const model = currentModel();
  const key = modelKey(model);
  if (!force && key === renderedKey) {
    if (model.kind === "ready") updateLiveReadout(view, model);
    return;
  }
  renderedKey = key;
  renderScreen(view, model, {
    pinned: settings?.alwaysOnTop ?? true,
    onSettings: openSettings,
    onPin: () => {
      void togglePin();
    },
    onMinimize: () => {
      void minimizeWindow();
    },
    onClose: () => {
      void closeWindow();
    },
    onOpenUrl: (url) => {
      void openExternal(url);
    },
  });
}

function currentModel(): ScreenModel {
  const nowMs = Date.now();
  if (!settings || !payload || statusKind === "loading") return { kind: "loading" };
  if (statusKind === "missing") return { kind: "missing", path: payload.path };
  if (statusKind === "unreadable") {
    return {
      kind: "unreadable",
      path: payload.path,
      message: payload.message ?? "予定ファイルを読めませんでした",
    };
  }
  if (statusKind === "invalid" || !schedule) return { kind: "invalid", path: payload.path, issues };
  const viewModel = buildScheduleView(schedule.events, nowMs, settings.timeZone);
  return {
    kind: "ready",
    path: payload.path,
    view: viewModel,
    warnings: usingLastGood ? issues : schedule.warnings,
    mtimeMs: payload.mtimeMs,
    stale: isStale(payload.mtimeMs, nowMs, settings.staleThresholdMinutes),
    usingLastGood,
    preview: !isDesktop(),
    eventCount: schedule.events.length,
    nowMs,
  };
}

function modelKey(model: ScreenModel): string {
  if (model.kind !== "ready") return `${model.kind}:${"path" in model ? model.path : ""}:${getPreviewKind()}`;
  return [
    model.path,
    model.stale ? "1" : "0",
    model.usingLastGood ? "1" : "0",
    model.preview ? "1" : "0",
    model.warnings.map((issue) => issue.message).join(","),
    model.view.current?.id ?? "",
    model.view.heroAllDay?.id ?? "",
    model.view.next?.id ?? "",
    model.view.allDayStrip.map((event) => event.id).join(","),
    model.view.laterToday.map((event) => event.id).join(","),
    settings?.alwaysOnTop ? "1" : "0",
  ].join("|");
}

async function togglePin(): Promise<void> {
  if (!settings) return;
  settings = { ...settings, alwaysOnTop: !settings.alwaysOnTop };
  try {
    settings = await saveSettings(settings);
  } catch (error) {
    settings = { ...settings, alwaysOnTop: !settings.alwaysOnTop };
    window.alert(error instanceof Error ? error.message : "設定を保存できませんでした");
  }
  renderedKey = "";
  tick(true);
}

function openSettings(): void {
  if (!settings) return;
  setInput("schedule-path", settings.schedulePath);
  setChecked("auto-detect", settings.autoDetectColumns);
  setInput("col-title", settings.columns.title);
  setInput("col-date", settings.columns.date);
  setInput("col-end", settings.columns.end);
  setInput("col-location", settings.columns.location);
  setInput("col-url", settings.columns.url);
  ensureTimeZoneOption(settings.timeZone);
  setInput("time-zone", settings.timeZone);
  setInput("stale-minutes", String(settings.staleThresholdMinutes));
  setChecked("always-on-top", settings.alwaysOnTop);
  setChecked("close-to-tray", settings.closeToTray);
  setChecked("launch-at-login", settings.launchAtLogin);
  setChecked("notify-enabled", settings.notifyEnabled);
  setInput("notify-lead", String(settings.notifyLeadMinutes));
  syncNotifyInputs();
  const envNote = document.querySelector("#env-note");
  if (envNote instanceof HTMLElement) {
    envNote.hidden = !settings.pathOverriddenByEnv;
    envNote.textContent = settings.pathOverriddenByEnv
      ? `環境変数 SECRETARY_SCHEDULE_PATH が優先されています: ${settings.effectiveSchedulePath}`
      : "";
  }
  const detected = document.querySelector("#detected");
  const lock = document.querySelector("#lock-columns");
  if (detected instanceof HTMLElement) {
    detected.textContent = schedule
      ? `前回の判定: タイトル「${schedule.headers.title}」 / 日時「${schedule.headers.date}」${
          schedule.headers.location ? ` / 場所「${schedule.headers.location}」` : ""
        }${schedule.headers.url ? ` / URL「${schedule.headers.url}」` : ""}`
      : "まだ列を判定できていません。";
  }
  if (lock instanceof HTMLButtonElement) lock.disabled = !schedule;
  syncColumnInputs();
  setFormError("");
  const pick = document.querySelector("#pick-file");
  if (pick instanceof HTMLButtonElement) pick.disabled = !isDesktop();
  dialog.showModal();
}

function wireSettings(): void {
  document.querySelector("#auto-detect")?.addEventListener("change", syncColumnInputs);
  document.querySelector("#notify-enabled")?.addEventListener("change", syncNotifyInputs);
  document.querySelector("#pick-file")?.addEventListener("click", () => {
    void (async () => {
      const picked = await pickScheduleFile();
      if (picked) setInput("schedule-path", picked);
    })();
  });
  document.querySelector("#lock-columns")?.addEventListener("click", () => {
    if (!schedule) return;
    setChecked("auto-detect", false);
    setInput("col-title", schedule.headers.title);
    setInput("col-date", schedule.headers.date);
    setInput("col-end", schedule.headers.end ?? "");
    setInput("col-location", schedule.headers.location ?? "");
    setInput("col-url", schedule.headers.url ?? "");
    syncColumnInputs();
  });
  document.querySelector("#settings-cancel")?.addEventListener("click", () => dialog.close());
  document.querySelector("#settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitSettings();
  });
}

async function submitSettings(): Promise<void> {
  if (!settings) return;
  const stale = Number(inputValue("stale-minutes"));
  const timeZone = inputValue("time-zone").trim();
  const schedulePath = inputValue("schedule-path").trim();
  if (!schedulePath) {
    setFormError("予定ファイルのパスを入力してください。");
    return;
  }
  if (!Number.isInteger(stale) || stale < 5 || stale > 20160) {
    setFormError("古さのしきい値は 5 分から 20160 分にしてください。");
    return;
  }
  if (!isValidTimeZone(timeZone)) {
    setFormError("タイムゾーンを解釈できません。");
    return;
  }
  const notifyLead = Number(inputValue("notify-lead"));
  if (!Number.isInteger(notifyLead) || notifyLead < MIN_NOTIFY_LEAD_MINUTES || notifyLead > MAX_NOTIFY_LEAD_MINUTES) {
    setFormError("通知は 1 分前から 180 分前にしてください。");
    return;
  }
  const next: SettingsDto = {
    ...settings,
    schedulePath,
    autoDetectColumns: checked("auto-detect"),
    columns: {
      title: inputValue("col-title").trim(),
      date: inputValue("col-date").trim(),
      end: inputValue("col-end").trim(),
      location: inputValue("col-location").trim(),
      url: inputValue("col-url").trim(),
    },
    timeZone,
    staleThresholdMinutes: stale,
    alwaysOnTop: checked("always-on-top"),
    closeToTray: checked("close-to-tray"),
    launchAtLogin: checked("launch-at-login"),
    notifyEnabled: checked("notify-enabled"),
    notifyLeadMinutes: notifyLead,
  };
  try {
    settings = await saveSettings(next);
  } catch (error) {
    setFormError(error instanceof Error ? error.message : "設定を保存できませんでした");
    return;
  }
  dialog.close();
  lastGood = null;
  renderedKey = "";
  await reload();
}

function syncNotifyInputs(): void {
  const field = document.querySelector("#notify-lead");
  if (field instanceof HTMLInputElement) field.disabled = !checked("notify-enabled");
}

async function syncNotifications(nowMs: number): Promise<void> {
  if (notifying || firedLog == null || settings == null) return;
  notifying = true;
  try {
    const events = statusKind === "ready" && schedule ? schedule.events : [];
    const prefs = {
      enabled: settings.notifyEnabled,
      leadMinutes: settings.notifyLeadMinutes,
    };
    const plan = planNotifications(events, nowMs, prefs, firedLog);
    if (plan.due.length > 0) {
      const shown = [];
      for (const item of plan.due) {
        const copy = notificationCopy(item.event, nowMs, settings.timeZone);
        const ok = await showMeetingNotification({
          title: copy.title,
          body: copy.body,
          url: item.event.url,
        });
        if (ok) shown.push(item);
      }
      if (shown.length > 0 && firedLog) {
        firedLog = rememberFired(firedLog, shown, nowMs);
        try {
          await saveNotified(firedLog);
        } catch {
          // この起動中はメモリの記録で同じ予定を繰り返さない。
        }
      }
    }
    if (firedLog == null || settings == null) return;
    const next = planNotifications(
      statusKind === "ready" && schedule ? schedule.events : [],
      Date.now(),
      {
        enabled: settings.notifyEnabled,
        leadMinutes: settings.notifyLeadMinutes,
      },
      firedLog,
    ).nextFireAtMs;
    if (next !== scheduledFor) {
      scheduledFor = next;
      try {
        await scheduleNotifyWake(next);
      } catch {
        scheduledFor = undefined;
      }
    }
  } finally {
    notifying = false;
  }
}

function syncColumnInputs(): void {
  const auto = checked("auto-detect");
  for (const id of ["col-title", "col-date", "col-end", "col-location", "col-url"]) {
    const field = document.querySelector(`#${id}`);
    if (field instanceof HTMLInputElement) field.disabled = auto;
  }
}

function ensureTimeZoneOption(timeZone: string): void {
  const select = document.querySelector("#time-zone");
  if (!(select instanceof HTMLSelectElement)) return;
  if ([...select.options].some((option) => option.value === timeZone)) return;
  const option = document.createElement("option");
  option.value = timeZone;
  option.textContent = timeZone;
  select.append(option);
}

function setFormError(message: string): void {
  const node = document.querySelector("#settings-error");
  if (!(node instanceof HTMLElement)) return;
  node.hidden = message.length === 0;
  node.textContent = message;
}

function inputValue(id: string): string {
  const node = document.querySelector(`#${id}`);
  return node instanceof HTMLInputElement || node instanceof HTMLSelectElement ? node.value : "";
}

function setInput(id: string, value: string): void {
  const node = document.querySelector(`#${id}`);
  if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) node.value = value;
}

function checked(id: string): boolean {
  const node = document.querySelector(`#${id}`);
  return node instanceof HTMLInputElement ? node.checked : false;
}

function setChecked(id: string, value: boolean): void {
  const node = document.querySelector(`#${id}`);
  if (node instanceof HTMLInputElement) node.checked = value;
}
