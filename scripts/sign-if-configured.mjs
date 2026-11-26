#!/usr/bin/env node
// WINDOWS_PFX とパスワードが両方あるときだけ、exe に署名する。パスワードは引数に載せない。
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./sign-windows.ps1", import.meta.url));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function walk(target, found) {
  let info;
  try {
    info = statSync(target);
  } catch (error) {
    fail(`署名対象を読めません: ${target}（${error.message}）`);
  }
  if (info.isFile()) {
    if (target.toLowerCase().endsWith(".exe")) found.push(target);
    return;
  }
  if (!info.isDirectory()) return;
  for (const name of readdirSync(target)) walk(join(target, name), found);
}

const pfx = process.env.WINDOWS_PFX ?? "";
const password = process.env.WINDOWS_CERTIFICATE_PASSWORD ?? "";
if (!pfx && !password) {
  console.log("署名をスキップします。成果物は未署名です。");
  process.exit(0);
}
if (!pfx || !password) {
  fail(
    "署名用の Secret が片方だけです。WINDOWS_CERTIFICATE と WINDOWS_CERTIFICATE_PASSWORD は、両方設定するか、両方空にしてください。",
  );
}
if (process.platform !== "win32") {
  fail("コード署名は Windows のビルドだけで実行します。");
}

const target = process.argv[2];
if (!target || process.argv.length !== 3) {
  fail("使い方: node scripts/sign-if-configured.mjs <exe またはディレクトリ>");
}
const files = [];
walk(target, files);
if (files.length === 0) {
  console.log("署名する exe はありませんでした。");
  process.exit(0);
}
for (const file of files) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, file],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`署名しました: ${files.length} 件`);
