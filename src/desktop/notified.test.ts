import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadNotified, parseNotified, sanitize, saveNotified } from "./notified";
import type { PathContext } from "./paths";

describe("通知の記録", () => {
  it("壊れた JSON は空の記録になる", () => {
    expect(parseNotified("")).toEqual([]);
    expect(parseNotified("{")).toEqual([]);
    expect(parseNotified("null")).toEqual([]);
  });

  it("空のキーと重複を落とす", () => {
    expect(
      sanitize([
        { key: "  ", startMs: 1 },
        { key: " a ", startMs: 2 },
        { key: "a", startMs: 3 },
        { key: "b", startMs: 4 },
      ]),
    ).toEqual([
      { key: "a", startMs: 2 },
      { key: "b", startMs: 4 },
    ]);
  });

  it("ファイルを往復できる", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secretary-notified-"));
    try {
      const context: PathContext = { home: dir, configDir: dir, envSchedulePath: null };
      const records = [{ key: "100\u0000定例", startMs: 100 }];
      saveNotified(records, context);
      expect(loadNotified(context)).toEqual(records);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
