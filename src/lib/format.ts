import { addCalendarDays, pad2, sameYmd, wallTimeToUtcMs, weekdayJa, zonedParts } from "./time";

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}日 ${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(secs)}`;
  return `${pad2(minutes)}:${pad2(secs)}`;
}

export function formatRemainingPhrase(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return hours > 0 ? `${days}日${hours}時間` : `${days}日`;
  if (hours > 0) return minutes > 0 ? `${hours}時間${minutes}分` : `${hours}時間`;
  if (minutes > 0) return secs > 0 ? `${minutes}分${secs}秒` : `${minutes}分`;
  return `${secs}秒`;
}

export function formatAge(ageMs: number): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 1) return "1分未満";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

export function formatNow(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  return `${parts.month}月${parts.day}日（${weekdayJa(parts.weekday)}）${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function formatEventWhen(
  startMs: number,
  endMs: number,
  allDay: boolean,
  nowMs: number,
  timeZone: string,
): string {
  if (allDay) {
    const startLabel = formatMonthDay(startMs, timeZone);
    const inclusiveEnd = endMs - 1;
    const endLabel = formatMonthDay(inclusiveEnd, timeZone);
    if (startLabel === endLabel) return `${dayWord(startMs, nowMs, timeZone) ?? startLabel} 終日`;
    return `${startLabel}–${endLabel} 終日`;
  }

  const sameDay = sameYmd(startMs, endMs - 1, timeZone);
  if (sameDay) {
    const prefix = dayWord(startMs, nowMs, timeZone);
    const range = `${formatHm(startMs, timeZone)}–${formatHm(endMs, timeZone)}`;
    return prefix ? `${prefix} ${range}` : `${formatMonthDay(startMs, timeZone)} ${range}`;
  }

  return `${formatPoint(startMs, nowMs, timeZone)} – ${formatPoint(endMs, nowMs, timeZone)}`;
}

export function formatHm(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function formatPoint(ms: number, nowMs: number, timeZone: string): string {
  const word = dayWord(ms, nowMs, timeZone);
  const hm = formatHm(ms, timeZone);
  if (word) return `${word} ${hm}`;
  return `${formatMonthDay(ms, timeZone)} ${hm}`;
}

function formatMonthDay(ms: number, timeZone: string): string {
  const parts = zonedParts(ms, timeZone);
  return `${parts.month}月${parts.day}日（${weekdayJa(parts.weekday)}）`;
}

function dayWord(ms: number, nowMs: number, timeZone: string): string | null {
  if (sameYmd(ms, nowMs, timeZone)) return "今日";
  const today = zonedParts(nowMs, timeZone);
  const tomorrow = addCalendarDays(today.year, today.month, today.day, 1);
  const tomorrowMs = wallTimeToUtcMs(tomorrow.year, tomorrow.month, tomorrow.day, 12, 0, 0, timeZone);
  if (sameYmd(ms, tomorrowMs, timeZone)) return "明日";
  const yesterday = addCalendarDays(today.year, today.month, today.day, -1);
  const yesterdayMs = wallTimeToUtcMs(
    yesterday.year,
    yesterday.month,
    yesterday.day,
    12,
    0,
    0,
    timeZone,
  );
  if (sameYmd(ms, yesterdayMs, timeZone)) return "昨日";
  return null;
}
