#!/usr/bin/env node
// Tauri の --config に渡す、Windows のコード署名コマンド。
// パスワードは入れない。署名スクリプトが環境変数から読む。
import { writeFileSync } from "node:fs";

const [scriptPath, outPath, extra] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!scriptPath || !outPath || extra !== undefined) {
  fail("使い方: node scripts/sign-config.mjs <sign-windows.ps1 のパス> <出力 json>");
}

const config = {
  bundle: {
    windows: {
      signCommand: {
        cmd: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "%1"],
      },
    },
  },
};

writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`署名設定を書きました: ${outPath}`);
