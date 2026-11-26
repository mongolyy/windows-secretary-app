// 二重起動。2 つ目は既存のプロセスへ「表示」か「トレイのまま」を頼んで終わる。
// ループバックの待受は使わない。設定フォルダのファイルだけで伝える。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TRAY_ARG } from "./autostart";

const LOCK_NAME = "instance.json";
const REQUEST_NAME = "instance-request.json";

export type InstanceAction = "show" | "tray";

export type InstanceClaim = { role: "primary" } | { role: "secondary"; action: InstanceAction };

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    return code === "EPERM";
  }
}

export function claimInstance(
  directory: string,
  args: readonly string[],
  selfPid: number,
  isAlive: (pid: number) => boolean,
): InstanceClaim {
  mkdirSync(directory, { recursive: true });
  const action: InstanceAction = args.includes(TRAY_ARG) ? "tray" : "show";
  const lockPath = path.join(directory, LOCK_NAME);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockPath, `${JSON.stringify({ pid: selfPid })}\n`, { flag: "wx" });
      return { role: "primary" };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
    }
    const owner = readLockPid(lockPath);
    if (owner === selfPid) return { role: "primary" };
    if (owner != null && isAlive(owner)) {
      writeFileSync(path.join(directory, REQUEST_NAME), `${JSON.stringify({ action })}\n`);
      return { role: "secondary", action };
    }
    rmSync(lockPath, { force: true });
  }
  writeFileSync(path.join(directory, REQUEST_NAME), `${JSON.stringify({ action })}\n`);
  return { role: "secondary", action };
}

export function takeInstanceRequest(directory: string): InstanceAction | null {
  const requestPath = path.join(directory, REQUEST_NAME);
  let text: string;
  try {
    text = readFileSync(requestPath, "utf8");
  } catch {
    return null;
  }
  rmSync(requestPath, { force: true });
  try {
    const parsed = JSON.parse(text) as { action?: unknown };
    return parsed.action === "tray" ? "tray" : "show";
  } catch {
    return "show";
  }
}

function readLockPid(lockPath: string): number | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    return typeof parsed.pid === "number" && Number.isInteger(parsed.pid) ? parsed.pid : null;
  } catch {
    return null;
  }
}
