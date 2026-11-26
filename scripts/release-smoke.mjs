#!/usr/bin/env node
// 配布ディレクトリのファイル構成、サイズ、チェックサム、zip の中身を確認する。
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { verifyChecksumFile } from "./checksums.mjs";
import { listZipEntries } from "./zip.mjs";

const DEFAULT_MIN_SETUP = 300 * 1024;
const DEFAULT_MIN_PORTABLE = 400 * 1024;
const DEFAULT_MAX_SETUP = 150 * 1024 * 1024;
const DEFAULT_MAX_PORTABLE = 150 * 1024 * 1024;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const value = argv[index + 1];
      if (!name || value === undefined || value.startsWith("--")) {
        fail(`${token} の値がありません。`);
      }
      if (Object.hasOwn(flags, name)) {
        fail(`引数が重複しています: ${token}`);
      }
      flags[name] = value;
      index += 1;
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function numberFlag(flags, name, fallback) {
  if (flags[name] === undefined) {
    return fallback;
  }
  if (!/^[0-9]+$/.test(flags[name])) {
    fail(`${name} は 0 以上の整数にしてください: ${flags[name]}`);
  }
  return Number(flags[name]);
}

function requireSize(name, size, min, max) {
  if (size < min || size > max) {
    fail(`${name} のサイズが範囲外です: ${size} バイト（${min} から ${max}）`);
  }
}

const ALLOWED = new Set(["min-setup", "min-portable", "max-setup", "max-portable", "exe-name"]);
const { positional, flags } = parseArgs(process.argv.slice(2));
for (const key of Object.keys(flags)) {
  if (!ALLOWED.has(key)) {
    fail(`不明な引数です: --${key}`);
  }
}
if (positional.length !== 1) {
  fail("使い方: node scripts/release-smoke.mjs <配布ディレクトリ> [--min-setup N] [--exe-name Secretary.exe]");
}

const directory = positional[0];
const exeName = flags["exe-name"] ?? "Secretary.exe";
const minSetup = numberFlag(flags, "min-setup", DEFAULT_MIN_SETUP);
const minPortable = numberFlag(flags, "min-portable", DEFAULT_MIN_PORTABLE);
const maxSetup = numberFlag(flags, "max-setup", DEFAULT_MAX_SETUP);
const maxPortable = numberFlag(flags, "max-portable", DEFAULT_MAX_PORTABLE);

let names;
try {
  names = readdirSync(directory);
} catch (error) {
  fail(`配布ディレクトリを読めません: ${directory}（${error.message}）`);
}
names.sort();
const expected = ["SHA256SUMS.txt"];
const setupNames = names.filter((name) => name.endsWith("-setup.zip"));
const zipNames = names.filter((name) => name.endsWith("-portable.zip"));
if (setupNames.length !== 1 || zipNames.length !== 1) {
  fail(`インストーラとポータブル版が 1 件ずつ必要です。見つかったファイル: ${names.join(", ") || "(なし)"}`);
}
const setupName = setupNames[0];
const zipName = zipNames[0];
const expectedNames = [setupName, zipName, ...expected].sort();
if (names.join("\n") !== expectedNames.join("\n")) {
  fail(`配布ディレクトリのファイルが想定と違います: ${names.join(", ")}`);
}

const setupSize = statSync(join(directory, setupName)).size;
const zipSize = statSync(join(directory, zipName)).size;
requireSize(setupName, setupSize, minSetup, maxSetup);
requireSize(zipName, zipSize, minPortable, maxPortable);

let checksums;
try {
  checksums = verifyChecksumFile(join(directory, "SHA256SUMS.txt"), directory);
} catch (error) {
  fail(error.message);
}
const checksumNames = checksums.map((entry) => entry.name).sort();
if (checksumNames.join("\n") !== [setupName, zipName].sort().join("\n")) {
  fail(`チェックサムの対象が配布ファイルと一致しません: ${checksumNames.join(", ")}`);
}

let entries;
try {
  entries = listZipEntries(join(directory, zipName));
} catch (error) {
  fail(error.message);
}
const hasExe = entries.some((entry) => entry === exeName || entry.endsWith(`/${exeName}`));
if (!hasExe) {
  fail(`ポータブル版に ${exeName} がありません。実際: ${entries.join(", ") || "(なし)"}`);
}

console.log("スモークチェックに通りました。");
console.log(`  ${setupName}: ${setupSize} バイト`);
console.log(`  ${zipName}: ${zipSize} バイト`);
console.log(`  zip の中: ${exeName}`);
