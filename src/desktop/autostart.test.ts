import { describe, expect, it } from "vitest";

import { applyLaunchAtLogin, autostartCommands, launchedInTray, loginCommand, type RegResult } from "./autostart";

describe("ログイン時の起動", () => {
  it("空白を含むパスを引用符で囲む", () => {
    expect(loginCommand("C:\\Program Files\\Secretary\\Secretary.exe")).toBe(
      '"C:\\Program Files\\Secretary\\Secretary.exe" --minimized',
    );
  });

  it("パス内の引用符を拒否する", () => {
    expect(() => loginCommand('C:\\bad"path\\Secretary.exe')).toThrow(/自動起動/);
  });

  it("ログイン引数だけをトレイ起動とみなす", () => {
    expect(launchedInTray(["C:\\Secretary\\Secretary.exe", "--minimized"])).toBe(true);
    expect(launchedInTray(["C:\\Secretary\\Secretary.exe", "--minimized-extra"])).toBe(false);
    expect(launchedInTray(["C:\\Secretary\\Secretary.exe"])).toBe(false);
  });

  it("有効化は Run と StartupApproved を書き、無効化は消す", () => {
    const enable = autostartCommands(true, "C:\\Program Files\\Secretary\\Secretary.exe");
    expect(enable[0]).toContain('"C:\\Program Files\\Secretary\\Secretary.exe" --minimized');
    expect(enable[0]?.join(" ")).toContain("REG_SZ");
    expect(enable[1]?.join(" ")).toContain("REG_BINARY");
    expect(enable[1]?.join(" ")).toContain("020000000000000000000000");
    const disable = autostartCommands(false, "C:\\Secretary\\Secretary.exe");
    expect(disable[0]?.[0]).toBe("delete");
    expect(disable[1]?.[0]).toBe("delete");
  });

  it("無効化で値が無くても成功し、有効化の失敗は戻す", async () => {
    const calls: string[][] = [];
    const missing: RegResult = {
      code: 1,
      stderr: "ERROR: The system was unable to find the specified registry key or value.",
    };
    await applyLaunchAtLogin(false, "C:\\Secretary\\Secretary.exe", async (args) => {
      calls.push(args);
      return args[0] === "delete" ? missing : { code: 0, stderr: "" };
    });
    expect(calls).toHaveLength(2);

    await expect(
      applyLaunchAtLogin(true, "C:\\Secretary\\Secretary.exe", async () => ({ code: 1, stderr: "access denied" })),
    ).rejects.toThrow(/有効にできません/);
  });

  it("StartupApproved の失敗では設定を失敗にしない", async () => {
    await applyLaunchAtLogin(true, "C:\\Secretary\\Secretary.exe", async (args) => {
      if (args.includes("REG_BINARY")) return { code: 1, stderr: "approved missing" };
      return { code: 0, stderr: "" };
    });
  });
});
