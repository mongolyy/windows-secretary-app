// 予定 CSV の読み込み。文字コードは UTF-8（BOM あり・なし）と UTF-16 を受け付ける。
import { readFileSync, statSync } from "node:fs";

import type { SchedulePayload } from "../lib/types";

export const MAX_SCHEDULE_BYTES = 5 * 1024 * 1024;

export function decodeScheduleBytes(bytes: Uint8Array): string {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return decodeUtf8(bytes.subarray(3));
  if (startsWith(bytes, [0xff, 0xfe])) return decodeUtf16(bytes.subarray(2), true);
  if (startsWith(bytes, [0xfe, 0xff])) return decodeUtf16(bytes.subarray(2), false);
  return decodeUtf8(bytes);
}

export function readScheduleAt(filePath: string): SchedulePayload {
  let info;
  try {
    info = statSync(filePath);
  } catch {
    return {
      path: filePath,
      ioStatus: "missing",
      message: "予定ファイルが見つかりません",
      contents: null,
      mtimeMs: null,
    };
  }
  if (!info.isFile()) {
    return {
      path: filePath,
      ioStatus: "notAFile",
      message: "指定されたパスはファイルではありません",
      contents: null,
      mtimeMs: null,
    };
  }
  if (info.size > MAX_SCHEDULE_BYTES) {
    return unreadable(filePath, "ファイルが大きすぎます（5MBまで）");
  }
  try {
    const text = decodeScheduleBytes(readFileSync(filePath));
    return {
      path: filePath,
      ioStatus: "ok",
      message: null,
      contents: text,
      mtimeMs: mtimeMs(info.mtimeMs),
    };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : "予定ファイルを読めませんでした";
    return unreadable(filePath, message);
  }
}

function unreadable(filePath: string, message: string): SchedulePayload {
  return { path: filePath, ioStatus: "unreadable", message, contents: null, mtimeMs: null };
}

function mtimeMs(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("UTF-8として読めません");
  }
}

/** 対にならないサロゲートは拒否する。 */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length % 2 !== 0) throw new Error("UTF-16として読めません");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 2) {
    units.push(view.getUint16(offset, littleEndian));
  }
  let text = "";
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index] ?? 0;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = units[index + 1];
      if (next == null || next < 0xdc00 || next > 0xdfff) throw new Error("UTF-16として読めません");
      const codePoint = 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
      text += String.fromCodePoint(codePoint);
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) throw new Error("UTF-16として読めません");
    text += String.fromCharCode(unit);
  }
  return text;
}
