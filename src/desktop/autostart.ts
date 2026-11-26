// Windows のログイン時起動。Electrobun には自動起動 API が無いので、現在のユーザーの Run キーを書く。
// 全ユーザー向けの登録はしない。管理者権限は要らない。

export const TRAY_ARG = "--minimized";
export const RUN_VALUE_NAME = "Secretary";

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
/** タスク マネージャーのスタートアップで有効を表す。末尾 8 バイトが 0 以外だと無効になる。 */
const APPROVED_ENABLED = "020000000000000000000000";

export type RegResult = { code: number; stderr: string };
export type RegRunner = (args: string[]) => Promise<RegResult>;

export function launchedInTray(args: readonly string[]): boolean {
  return args.includes(TRAY_ARG);
}

/** Run キーへ書くコマンド。空白を含むパスでも割れないよう、実行ファイルは引用符で囲む。 */
export function loginCommand(exe: string): string {
  if (exe.length === 0 || exe.includes('"') || exe.includes("\n") || exe.includes("\r")) {
    throw new Error("実行ファイルのパスを自動起動に使えません");
  }
  return `"${exe}" ${TRAY_ARG}`;
}

export function autostartCommands(enabled: boolean, exe: string): string[][] {
  if (enabled) {
    const command = loginCommand(exe);
    return [
      ["add", RUN_KEY, "/v", RUN_VALUE_NAME, "/t", "REG_SZ", "/d", command, "/f"],
      ["add", APPROVED_KEY, "/v", RUN_VALUE_NAME, "/t", "REG_BINARY", "/d", APPROVED_ENABLED, "/f"],
    ];
  }
  return [
    ["delete", RUN_KEY, "/v", RUN_VALUE_NAME, "/f"],
    ["delete", APPROVED_KEY, "/v", RUN_VALUE_NAME, "/f"],
  ];
}

export async function applyLaunchAtLogin(enabled: boolean, exe: string, run: RegRunner): Promise<void> {
  const [runCommand, approvedCommand] = autostartCommands(enabled, exe);
  if (!runCommand || !approvedCommand) throw new Error("自動起動のコマンドを作れません");
  const runResult = await run(runCommand);
  if (runResult.code !== 0 && !(enabled === false && isMissingValue(runResult))) {
    throw new Error(
      enabled
        ? `自動起動を有効にできません: ${runResult.stderr.trim()}`
        : `自動起動を無効にできません: ${runResult.stderr.trim()}`,
    );
  }
  // StartupApproved が無い環境では、Run の値だけでログイン時に起動する。失敗しても設定は戻さない。
  await run(approvedCommand);
}

function isMissingValue(result: RegResult): boolean {
  const text = result.stderr.toLowerCase();
  return (
    text.includes("unable to find") ||
    text.includes("not found") ||
    text.includes("見つかりません") ||
    text.includes("を見つけることができません") ||
    text.includes("0x80070002")
  );
}
