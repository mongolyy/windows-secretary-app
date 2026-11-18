import { parseNotionDateRange } from "./notionDate";
import type { ColumnSettings, ParseIssue, ResolvedHeaders } from "./types";

export type ColumnRoles = {
  title: number;
  date: number;
  end: number | null;
  location: number | null;
  url: number | null;
  headers: ResolvedHeaders;
};

const DATE_HEADERS = [
  "日付",
  "date",
  "日時",
  "開始日時",
  "実施日時",
  "予定日",
  "実施日",
  "開始日",
  "start",
  "startdate",
  "starttime",
  "when",
  "時間",
  "開始",
];

const TITLE_HEADERS = [
  "名前",
  "name",
  "タイトル",
  "title",
  "件名",
  "予定名",
  "タスク名",
  "名称",
  "予定",
  "タスク",
  "内容",
];

const END_HEADERS = ["終了", "終了日時", "終了日", "end", "endtime", "enddate", "終わり"];

const LOCATION_HEADERS = ["場所", "会場", "会議室", "location", "place", "where", "所在地", "部屋", "room"];

const URL_HEADERS = ["url", "リンク", "link", "会議リンク", "参加リンク", "会議url", "参加url", "meet"];

export function normHeader(value: string): string {
  return value
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "");
}

export function resolveColumns(
  headers: string[],
  dataRows: string[][],
  settings: ColumnSettings,
  timeZone: string,
): { ok: true; roles: ColumnRoles } | { ok: false; issues: ParseIssue[] } {
  if (settings.autoDetect) {
    return resolveAuto(headers, dataRows, timeZone);
  }
  return resolveManual(headers, settings);
}

function resolveAuto(
  headers: string[],
  dataRows: string[][],
  timeZone: string,
): { ok: true; roles: ColumnRoles } | { ok: false; issues: ParseIssue[] } {
  const used = new Set<number>();
  let date = pickHeader(headers, DATE_HEADERS, used);
  if (date < 0) date = sniffDateColumn(headers, dataRows, timeZone, used);
  if (date < 0) {
    return {
      ok: false,
      issues: [
        {
          rowNumber: 1,
          code: "no-date-column",
          message: "日時の列を判定できません。設定で列名を指定してください。",
        },
      ],
    };
  }
  used.add(date);

  let title = pickHeader(headers, TITLE_HEADERS, used);
  if (title < 0) title = firstUnused(headers, used);
  if (title < 0) {
    return {
      ok: false,
      issues: [
        {
          rowNumber: 1,
          code: "no-title-column",
          message: "タイトルの列を判定できません。設定で列名を指定してください。",
        },
      ],
    };
  }
  used.add(title);

  const end = optionalPick(headers, END_HEADERS, used);
  const location = optionalPick(headers, LOCATION_HEADERS, used);
  const url = optionalPick(headers, URL_HEADERS, used);

  return { ok: true, roles: rolesFromIndexes(headers, title, date, end, location, url) };
}

function resolveManual(
  headers: string[],
  settings: ColumnSettings,
): { ok: true; roles: ColumnRoles } | { ok: false; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const title = requireHeader(headers, settings.title, "タイトル", issues);
  const date = requireHeader(headers, settings.date, "日時", issues);
  if (issues.length > 0 || title == null || date == null) return { ok: false, issues };

  const used = new Set<number>([title, date]);
  const end = optionalManual(headers, settings.end, "終了", used, issues);
  const location = optionalManual(headers, settings.location, "場所", used, issues);
  const url = optionalManual(headers, settings.url, "URL", used, issues);
  if (issues.length > 0 || end === undefined || location === undefined || url === undefined) {
    return { ok: false, issues };
  }
  return { ok: true, roles: rolesFromIndexes(headers, title, date, end, location, url) };
}

function requireHeader(headers: string[], name: string, label: string, issues: ParseIssue[]): number | null {
  if (!name.trim()) {
    issues.push({
      rowNumber: 1,
      code: "missing-column",
      message: `${label}列の名前を入力してください。`,
    });
    return null;
  }
  const index = findHeader(headers, name);
  if (index < 0) {
    issues.push({
      rowNumber: 1,
      code: "missing-column",
      message: `${label}列「${name.trim()}」が見つかりません。`,
    });
    return null;
  }
  return index;
}

function optionalManual(
  headers: string[],
  name: string,
  label: string,
  used: Set<number>,
  issues: ParseIssue[],
): number | null | undefined {
  if (!name.trim()) return null;
  const index = findHeader(headers, name);
  if (index < 0) {
    issues.push({
      rowNumber: 1,
      code: "missing-column",
      message: `${label}列「${name.trim()}」が見つかりません。`,
    });
    return undefined;
  }
  if (used.has(index)) {
    issues.push({
      rowNumber: 1,
      code: "missing-column",
      message: `${label}列がほかの列と重複しています。`,
    });
    return undefined;
  }
  used.add(index);
  return index;
}

function findHeader(headers: string[], name: string): number {
  const want = normHeader(name);
  return headers.findIndex((header) => normHeader(header) === want);
}

function pickHeader(headers: string[], table: string[], used: Set<number>): number {
  let best = -1;
  let bestScore = 0;
  headers.forEach((header, index) => {
    if (used.has(index)) return;
    const score = scoreHeader(header, table);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

function optionalPick(headers: string[], table: string[], used: Set<number>): number | null {
  const index = pickHeader(headers, table, used);
  if (index < 0) return null;
  used.add(index);
  return index;
}

function scoreHeader(header: string, table: string[]): number {
  const name = normHeader(header);
  const index = table.indexOf(name);
  if (index < 0) return 0;
  return table.length - index;
}

function firstUnused(headers: string[], used: Set<number>): number {
  return headers.findIndex((_, index) => !used.has(index));
}

function sniffDateColumn(headers: string[], dataRows: string[][], timeZone: string, used: Set<number>): number {
  let best = -1;
  let bestRatio = 0;
  headers.forEach((_, index) => {
    if (used.has(index)) return;
    const values = dataRows
      .map((row) => (row[index] ?? "").trim())
      .filter((value) => value.length > 0)
      .slice(0, 20);
    if (values.length === 0) return;
    const ok = values.filter((value) => parseNotionDateRange(value, timeZone).ok).length;
    const ratio = ok / values.length;
    if (ok > 0 && ratio >= 0.5 && ratio > bestRatio) {
      best = index;
      bestRatio = ratio;
    }
  });
  return best;
}

function rolesFromIndexes(
  headers: string[],
  title: number,
  date: number,
  end: number | null,
  location: number | null,
  url: number | null,
): ColumnRoles {
  return {
    title,
    date,
    end,
    location,
    url,
    headers: {
      title: headers[title] ?? "",
      date: headers[date] ?? "",
      end: end == null ? null : (headers[end] ?? ""),
      location: location == null ? null : (headers[location] ?? ""),
      url: url == null ? null : (headers[url] ?? ""),
    },
  };
}
