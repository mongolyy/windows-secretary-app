import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { claimInstance, takeInstanceRequest } from "./instance";

describe("二重起動", () => {
  it("生きているプロセスがあれば表示を頼んで終わる", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secretary-instance-"));
    try {
      const alive = new Set<number>([10]);
      expect(claimInstance(dir, ["Secretary.exe"], 10, (pid) => alive.has(pid)).role).toBe("primary");
      expect(claimInstance(dir, ["Secretary.exe"], 11, (pid) => alive.has(pid))).toEqual({
        role: "secondary",
        action: "show",
      });
      expect(takeInstanceRequest(dir)).toBe("show");
      expect(takeInstanceRequest(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ログイン起動の 2 つ目はトレイのままにする", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secretary-instance-"));
    try {
      claimInstance(dir, ["Secretary.exe"], 10, () => true);
      expect(claimInstance(dir, ["Secretary.exe", "--minimized"], 11, () => true)).toEqual({
        role: "secondary",
        action: "tray",
      });
      expect(takeInstanceRequest(dir)).toBe("tray");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("終了したプロセスのロックは引き継ぐ", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secretary-instance-"));
    try {
      claimInstance(dir, ["Secretary.exe"], 10, () => true);
      expect(claimInstance(dir, ["Secretary.exe"], 12, () => false).role).toBe("primary");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
