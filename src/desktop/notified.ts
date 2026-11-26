// すでに知らせた予定。アプリを終了しても、同じ予定を繰り返さない。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FiredNotice } from "../lib/notify";

import { notifiedFilePath, type PathContext } from "./paths";

const MAX_RECORDS = 200;
const MAX_KEY_CHARS = 500;

export function parseNotified(text: string): FiredNotice[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return sanitize(parsed);
  } catch {
    return [];
  }
}

export function sanitize(records: unknown[]): FiredNotice[] {
  const seen = new Set<string>();
  const clean: FiredNotice[] = [];
  for (const record of records) {
    if (record == null || typeof record !== "object") continue;
    const keyValue = "key" in record ? record.key : undefined;
    const startValue = "startMs" in record ? record.startMs : undefined;
    if (typeof keyValue !== "string" || typeof startValue !== "number" || !Number.isFinite(startValue)) continue;
    const key = keyValue.trim();
    if (!key || [...key].length > MAX_KEY_CHARS) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ key, startMs: startValue });
    if (clean.length === MAX_RECORDS) break;
  }
  return clean;
}

export function loadNotified(context: PathContext): FiredNotice[] {
  const file = notifiedFilePath(context.configDir);
  if (!file) return [];
  try {
    return parseNotified(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

export function saveNotified(records: FiredNotice[], context: PathContext): void {
  const file = notifiedFilePath(context.configDir);
  if (!file) throw new Error("通知の記録を保存する場所を決められません");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(sanitize(records), null, 2)}\n`);
}
