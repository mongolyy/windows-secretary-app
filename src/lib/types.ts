/** CSV と Notion の日付セルを解釈したあとの予定1件。 */
export type ScheduleEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location?: string;
  url?: string;
  rowNumber: number;
};

export type ParseIssue = {
  /** CSV のレコード番号（1始まり）。ファイル全体の問題では null。 */
  rowNumber: number | null;
  code: string;
  message: string;
};

export type ColumnSettings = {
  autoDetect: boolean;
  title: string;
  date: string;
  end: string;
  location: string;
  url: string;
};

export type ResolvedHeaders = {
  title: string;
  date: string;
  end: string | null;
  location: string | null;
  url: string | null;
};

export type PersistedSettings = {
  schedulePath: string;
  autoDetectColumns: boolean;
  columns: {
    title: string;
    date: string;
    end: string;
    location: string;
    url: string;
  };
  timeZone: string;
  staleThresholdMinutes: number;
  alwaysOnTop: boolean;
  closeToTray: boolean;
};

export type SettingsDto = PersistedSettings & {
  effectiveSchedulePath: string;
  pathOverriddenByEnv: boolean;
};

export type SchedulePayload = {
  path: string;
  ioStatus: "ok" | "missing" | "notAFile" | "unreadable";
  message: string | null;
  contents: string | null;
  mtimeMs: number | null;
};

export const DEFAULT_TIME_ZONE = "Asia/Tokyo";
export const DEFAULT_STALE_MINUTES = 1440;

export const DEFAULT_COLUMNS = {
  title: "名前",
  date: "日付",
  end: "",
  location: "場所",
  url: "URL",
} as const;
