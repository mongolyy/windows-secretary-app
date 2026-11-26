// 設定と予定ファイルの場所。Windows では今までの %APPDATA% と %USERPROFILE% を維持する。
import { homedir } from "node:os";
import path from "node:path";

export type PathContext = {
  home: string | null;
  /** 設定と通知記録の親。Windows では %APPDATA%。 */
  configDir: string | null;
  envSchedulePath: string | null;
};

export function defaultPathContext(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): PathContext {
  const home = homedir() || null;
  const configDir = resolveConfigDir(env, platform, home);
  return {
    home,
    configDir,
    envSchedulePath: env.SECRETARY_SCHEDULE_PATH ?? null,
  };
}

function resolveConfigDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string | null): string | null {
  if (platform === "win32") {
    const appData = env.APPDATA?.trim();
    return appData ? appData : null;
  }
  if (platform === "darwin") {
    return home ? path.join(home, "Library", "Application Support") : null;
  }
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) return xdg;
  return home ? path.join(home, ".config") : null;
}

export function defaultSchedulePath(home: string | null): string {
  if (!home) return path.join("secretary", "schedule.csv");
  return path.join(home, "secretary", "schedule.csv");
}

export function settingsFilePath(configDir: string | null): string | null {
  if (!configDir) return null;
  return path.join(configDir, "secretary", "settings.json");
}

export function notifiedFilePath(configDir: string | null): string | null {
  if (!configDir) return null;
  return path.join(configDir, "secretary", "notified.json");
}
