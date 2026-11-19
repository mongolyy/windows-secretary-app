import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple table and ignores a trailing newline", () => {
    const table = parseCsv("名前,日付\n朝会,明日\n");
    expect(table).toEqual({
      ok: true,
      rows: [
        ["名前", "日付"],
        ["朝会", "明日"],
      ],
    });
  });

  it("strips a leading UTF-8 BOM", () => {
    const table = parseCsv("\uFEFF名前,日付\n週次,今日\n");
    expect(table.ok).toBe(true);
    if (table.ok) expect(table.rows[0][0]).toBe("名前");
  });

  it("keeps commas and quotes inside quoted fields", () => {
    const table = parseCsv('"Weekly sync, all hands","November 19, 2026 10:00 AM → 10:30 AM"\n');
    expect(table.ok).toBe(true);
    if (!table.ok) return;
    expect(table.rows[0]).toEqual(["Weekly sync, all hands", "November 19, 2026 10:00 AM → 10:30 AM"]);
  });

  it("unescapes doubled quotes and allows a newline inside a field", () => {
    const table = parseCsv('名前,メモ\n"定例","1行目\n""2行目"""\n');
    expect(table.ok).toBe(true);
    if (!table.ok) return;
    expect(table.rows[1][1]).toBe('1行目\n"2行目"');
  });

  it("handles CRLF", () => {
    const table = parseCsv("a,b\r\nc,d\r\n");
    expect(table).toEqual({
      ok: true,
      rows: [
        ["a", "b"],
        ["c", "d"],
      ],
    });
  });

  it("rejects an unterminated quote", () => {
    const table = parseCsv('名前,日付\n"壊れた,今日\n');
    expect(table.ok).toBe(false);
  });
});
