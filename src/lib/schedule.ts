import { parseCsv } from "./csv";
import { resolveColumns } from "./mapping";
import { parseNotionDateRange } from "./notionDate";
import { zonedDayBounds } from "./time";
import type {
  ColumnSettings,
  ParseIssue,
  ResolvedHeaders,
  ScheduleEvent,
} from "./types";

export type ParsedSchedule = {
  events: ScheduleEvent[];
  warnings: ParseIssue[];
  headers: ResolvedHeaders;
};

export type ScheduleParse =
  | { ok: true; schedule: ParsedSchedule }
  | { ok: false; issues: ParseIssue[] };

export type ScheduleView = {
  timeZone: string;
  allDay: ScheduleEvent[];
  /** 進行中の時刻指定の予定。なければ null。 */
  current: ScheduleEvent | null;
  /** 時刻指定の進行中がないとき、主表示にする終日予定。 */
  heroAllDay: ScheduleEvent | null;
  /** まだ続いている終日予定。主表示に出したものは除く。 */
  allDayStrip: ScheduleEvent[];
  next: ScheduleEvent | null;
  laterToday: ScheduleEvent[];
  currentRemainingSec: number | null;
  nextRemainingSec: number | null;
};

const MAX_WARNINGS = 50;

export function parseScheduleCsv(
  text: string,
  options: { timeZone: string; columns: ColumnSettings },
): ScheduleParse {
  if (!text.trim()) {
    return fail([{ rowNumber: null, code: "empty", message: "CSVが空です" }]);
  }

  const table = parseCsv(text);
  if (!table.ok) {
    return fail([{ rowNumber: null, code: "csv", message: table.message }]);
  }

  const records = table.rows
    .map((cells, index) => ({ rowNumber: index + 1, cells }))
    .filter((record) => record.cells.some((cell) => cell.trim() !== ""));

  if (records.length > 0 && isSepHint(records[0].cells)) records.shift();
  if (records.length === 0) {
    return fail([{ rowNumber: null, code: "empty", message: "CSVが空です" }]);
  }

  const headerRecord = records[0];
  const headers = headerRecord.cells.map((cell) => cell.trim());
  const data = records.slice(1);
  const resolved = resolveColumns(
    headers,
    data.map((record) => record.cells),
    options.columns,
    options.timeZone,
  );
  if (!resolved.ok) return fail(resolved.issues);

  const warnings: ParseIssue[] = [];
  const events: ScheduleEvent[] = [];
  for (const record of data) {
    const built = buildEvent(record.rowNumber, record.cells, resolved.roles, options.timeZone);
    if (built.warning) warnings.push(built.warning);
    if (built.event) events.push(built.event);
  }

  events.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.rowNumber - b.rowNumber);

  const capped = capWarnings(warnings);
  if (events.length === 0 && capped.length > 0) return fail(capped);

  return {
    ok: true,
    schedule: { events, warnings: capped, headers: resolved.roles.headers },
  };
}

export function buildScheduleView(
  events: ScheduleEvent[],
  nowMs: number,
  timeZone: string,
): ScheduleView {
  const inProgress = events
    .filter((event) => !event.allDay && event.startMs <= nowMs && nowMs < event.endMs)
    .sort((a, b) => a.endMs - b.endMs || a.startMs - b.startMs || a.rowNumber - b.rowNumber);
  const current = inProgress[0] ?? null;

  const allDay = events
    .filter((event) => event.allDay && event.startMs <= nowMs && nowMs < event.endMs)
    .sort((a, b) => a.startMs - b.startMs || a.rowNumber - b.rowNumber);
  const heroAllDay = current ? null : allDay[0] ?? null;
  const allDayStrip = current ? allDay : allDay.slice(1);

  const next =
    events
      .filter((event) => event.startMs > nowMs && !skipAllDayAsNext(event, events))
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.rowNumber - b.rowNumber)[0] ??
    null;

  const day = zonedDayBounds(nowMs, timeZone);
  const featured = new Set<string>();
  if (current) featured.add(current.id);
  if (heroAllDay) featured.add(heroAllDay.id);
  if (next) featured.add(next.id);

  const laterToday = events
    .filter(
      (event) =>
        !event.allDay &&
        !featured.has(event.id) &&
        event.endMs > nowMs &&
        event.startMs < day.endMs &&
        event.endMs > day.startMs,
    )
    .sort((a, b) => a.startMs - b.startMs || a.rowNumber - b.rowNumber);

  return {
    timeZone,
    allDay,
    current,
    heroAllDay,
    allDayStrip,
    next,
    laterToday,
    currentRemainingSec: current ? remainingSeconds(current.endMs, nowMs) : null,
    nextRemainingSec: next ? remainingSeconds(next.startMs, nowMs) : null,
  };
}

export function remainingSeconds(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((targetMs - nowMs) / 1000));
}

export function isStale(
  mtimeMs: number | null,
  nowMs: number,
  thresholdMinutes: number,
): boolean {
  if (mtimeMs == null) return false;
  return nowMs - mtimeMs > thresholdMinutes * 60_000;
}

/**
 * 終日予定の期間中に時刻指定の予定が始まるなら、その終日は「次」にしない。
 * そうしないと、深夜 0 時の終日が同じ日の会議を隠す。
 */
function skipAllDayAsNext(event: ScheduleEvent, events: ScheduleEvent[]): boolean {
  if (!event.allDay) return false;
  return events.some(
    (other) =>
      !other.allDay && other.startMs >= event.startMs && other.startMs < event.endMs,
  );
}

function buildEvent(
  rowNumber: number,
  cells: string[],
  roles: {
    title: number;
    date: number;
    end: number | null;
    location: number | null;
    url: number | null;
  },
  timeZone: string,
): { event?: ScheduleEvent; warning?: ParseIssue } {
  const titleRaw = cell(cells, roles.title);
  const dateRaw = cell(cells, roles.date);
  const endRaw = roles.end == null ? "" : cell(cells, roles.end);
  const locationRaw = roles.location == null ? "" : cell(cells, roles.location);
  const urlRaw = roles.url == null ? "" : cell(cells, roles.url);

  if (!titleRaw && !dateRaw && !endRaw && !locationRaw && !urlRaw) return {};
  if (!dateRaw && !endRaw) {
    return { warning: rowIssue(rowNumber, "日付が空です") };
  }

  let dateText = dateRaw;
  if (endRaw && !hasRangeSeparator(dateRaw)) {
    dateText = dateRaw ? `${dateRaw} → ${endRaw}` : endRaw;
  }

  const parsed = parseNotionDateRange(dateText, timeZone);
  if (!parsed.ok) return { warning: rowIssue(rowNumber, parsed.message) };

  let url: string | undefined;
  let warning: ParseIssue | undefined;
  if (urlRaw) {
    if (/^https?:\/\/\S+$/i.test(urlRaw)) url = urlRaw;
    else warning = rowIssue(rowNumber, "URLの形式が正しくないため、リンクは無視しました", "bad-url");
  }

  const event: ScheduleEvent = {
    id: `row-${rowNumber}`,
    title: titleRaw || "（無題）",
    startMs: parsed.startMs,
    endMs: parsed.endMs,
    allDay: parsed.allDay,
    rowNumber,
  };
  if (locationRaw) event.location = locationRaw.slice(0, 500);
  if (url) event.url = url;
  return { event, warning };
}

function cell(cells: string[], index: number): string {
  return (cells[index] ?? "").trim();
}

function hasRangeSeparator(value: string): boolean {
  return /→|⇒|->|–|—/.test(value);
}

function rowIssue(rowNumber: number, message: string, code = "bad-row"): ParseIssue {
  return { rowNumber, code, message: `${rowNumber}行目: ${message}` };
}

function isSepHint(cells: string[]): boolean {
  return cells.length === 1 && /^sep=.$/i.test(cells[0]?.trim() ?? "");
}

function capWarnings(warnings: ParseIssue[]): ParseIssue[] {
  if (warnings.length <= MAX_WARNINGS) return warnings;
  const extra = warnings.length - MAX_WARNINGS;
  return [
    ...warnings.slice(0, MAX_WARNINGS),
    { rowNumber: null, code: "more", message: `ほか ${extra} 件の行を読み飛ばしました` },
  ];
}

function fail(issues: ParseIssue[]): ScheduleParse {
  return { ok: false, issues };
}
