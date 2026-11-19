import { formatHm } from "./format";
import { sameYmd, zonedParts } from "./time";
import type { ScheduleEvent } from "./types";

/** 初期値。設定で 1〜180 分に変えられる。 */
export const DEFAULT_NOTIFY_LEAD_MINUTES = 5;
export const MIN_NOTIFY_LEAD_MINUTES = 1;
export const MAX_NOTIFY_LEAD_MINUTES = 180;

/** 知らせた記録は、開始からこの期間を過ぎたら捨てる。 */
const RETAIN_AFTER_START_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FIRED = 200;

export type NotifySettings = {
  enabled: boolean;
  leadMinutes: number;
};

/** すでに知らせた予定。CSV を読み直しても、アプリを再起動しても残す。 */
export type FiredNotice = {
  key: string;
  startMs: number;
};

export type DueNotice = {
  event: ScheduleEvent;
  key: string;
};

export type NotifyPlan = {
  /** 今すぐ出すべき通知。開始が早い順。 */
  due: DueNotice[];
  /** 次に知らせる時刻。予定が無ければ null。 */
  nextFireAtMs: number | null;
};

/**
 * 同じ予定かどうかは、タイトルと開始時刻で決める。
 * 行番号は書き出すたびにずれうるので使わない。
 * 開始時刻が変わった再書き出しは、別のキーになり、新しい時刻で知らせる。
 */
export function notificationKey(event: { title: string; startMs: number }): string {
  const title = event.title.trim().replace(/\s+/g, " ");
  return `${event.startMs}\u0000${title}`;
}

/**
 * 次に知らせる予定を決める。
 * 終日は開始時刻が深夜になるだけなので対象にしない。
 * すでに始まっている予定は対象にしない。開始前で、リード時間に入っていれば今すぐ出す。
 */
export function planNotifications(
  events: readonly ScheduleEvent[],
  nowMs: number,
  settings: NotifySettings,
  fired: readonly FiredNotice[],
): NotifyPlan {
  const lead = leadWindowMs(settings);
  if (lead == null) return { due: [], nextFireAtMs: null };

  const firedKeys = new Set(fired.map((item) => item.key));
  const upcoming = events
    .filter((event) => !event.allDay && event.startMs > nowMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.rowNumber - b.rowNumber);

  const due: DueNotice[] = [];
  for (const event of upcoming) {
    const key = notificationKey(event);
    const fireAt = event.startMs - lead;
    if (firedKeys.has(key)) continue;
    if (nowMs < fireAt) return { due, nextFireAtMs: fireAt };
    firedKeys.add(key);
    due.push({ event, key });
  }
  return { due, nextFireAtMs: null };
}

export function rememberFired(
  existing: readonly FiredNotice[],
  firedNow: readonly DueNotice[],
  nowMs: number,
): FiredNotice[] {
  const merged = new Map<string, FiredNotice>();
  for (const item of existing) {
    if (!item.key) continue;
    merged.set(item.key, { key: item.key, startMs: item.startMs });
  }
  for (const item of firedNow) {
    merged.set(item.key, { key: item.key, startMs: item.event.startMs });
  }
  return [...merged.values()]
    .filter((item) => Number.isFinite(item.startMs) && nowMs - item.startMs <= RETAIN_AFTER_START_MS)
    .sort((a, b) => a.startMs - b.startMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(-MAX_FIRED);
}

/** 通知の見出しは予定のタイトル。本文に開始時刻と、あれば場所を入れる。 */
export function notificationCopy(
  event: Pick<ScheduleEvent, "title" | "startMs" | "location">,
  nowMs: number,
  timeZone: string,
): { title: string; body: string } {
  const parts = zonedParts(event.startMs, timeZone);
  const hm = formatHm(event.startMs, timeZone);
  const when = sameYmd(event.startMs, nowMs, timeZone) ? hm : `${parts.month}月${parts.day}日 ${hm}`;
  const remainMin = Math.floor(Math.max(0, event.startMs - nowMs) / 60_000);
  const lead = remainMin >= 1 ? `あと${remainMin}分` : "まもなく";
  const lines = [`${lead}（${when} 開始）`];
  const location = event.location?.trim();
  if (location) lines.push(`場所: ${location}`);
  const title = event.title.trim() || "（無題）";
  return { title, body: lines.join("\n") };
}

function leadWindowMs(settings: NotifySettings): number | null {
  if (!settings.enabled) return null;
  if (!Number.isInteger(settings.leadMinutes) || settings.leadMinutes < MIN_NOTIFY_LEAD_MINUTES) {
    return null;
  }
  return settings.leadMinutes * 60_000;
}
