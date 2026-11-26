import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { decodeScheduleBytes, readScheduleAt } from "./files";

describe("予定ファイルの文字コード", () => {
  it("UTF-8 の BOM ありとなし、UTF-16 を読む", () => {
    expect(decodeScheduleBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from("name")]))).toBe("name");
    expect(decodeScheduleBytes(Buffer.from("名前"))).toBe("名前");
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("予定", "utf16le")]);
    expect(decodeScheduleBytes(utf16)).toBe("予定");
    expect(() => decodeScheduleBytes(Uint8Array.from([0xff, 0x00]))).toThrow();
    expect(() => decodeScheduleBytes(Uint8Array.from([0xff, 0xfe, 0x00]))).toThrow(/UTF-16/);
  });

  it("対にならないサロゲートは拒否する", () => {
    expect(() => decodeScheduleBytes(Uint8Array.from([0xff, 0xfe, 0x00, 0xd8]))).toThrow(/UTF-16/);
  });

  it("無いファイル、ディレクトリ、本文を読み分ける", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secretary-files-"));
    try {
      expect(readScheduleAt(path.join(dir, "schedule.csv")).ioStatus).toBe("missing");
      expect(readScheduleAt(dir).ioStatus).toBe("notAFile");

      const file = path.join(dir, "schedule.csv");
      writeFileSync(file, Buffer.from([0xef, 0xbb, 0xbf, 0xe5, 0x90, 0x8d, 0xe5, 0x89, 0x8d]));
      const payload = readScheduleAt(file);
      expect(payload.ioStatus).toBe("ok");
      expect(payload.contents).toBe("名前");
      expect(payload.mtimeMs).not.toBeNull();

      writeFileSync(path.join(dir, "bad.csv"), Uint8Array.from([0xff, 0x00]));
      expect(readScheduleAt(path.join(dir, "bad.csv")).ioStatus).toBe("unreadable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("サンプル CSV は UTF-8 の BOM で始まり、名前から始まる", () => {
    const bytes = readFileSync(path.join(process.cwd(), "samples/notion-ja.csv"));
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(decodeScheduleBytes(bytes).startsWith("名前")).toBe(true);
  });
});
