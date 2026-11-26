#!/usr/bin/env node
// アプリのバージョンをタグと揃える。
//
// 対象は次の 2 箇所。リリース用のタグ（例: v0.1.0）は、先頭の v を除いた値と
// これらが全部一致している必要がある。
//   package.json の version
//   electrobun.config.ts の app.version（secretary-app-version）
//
// 使い方（リポジトリのルートで）:
//   node scripts/version.mjs check-consistent
//   node scripts/version.mjs check v0.1.0
//   node scripts/version.mjs validate 0.1.0
//   node scripts/version.mjs set 0.1.0
//
// check は引数を省くと環境変数 RELEASE_TAG を読む。

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PATHS = { packageJson: "package.json", electrobun: "electrobun.config.ts" };
const VERSION_LABELS = ["package.json", "electrobun.config.ts"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertSemver(version, label) {
  if (!SEMVER.test(version)) fail(`${label}が SemVer ではありません: ${version}`);
}

function versionFromTag(tag) {
  if (!tag.startsWith("v")) fail(`タグは v で始めてください: ${tag}`);
  const version = tag.slice(1);
  assertSemver(version, "タグのバージョン");
  return version;
}

function readText(relativePath) {
  try {
    return readFileSync(join(process.cwd(), relativePath), "utf8");
  } catch (error) {
    fail(`${relativePath} を読めません: ${error.message}`);
  }
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    fail(`${relativePath} の JSON を解釈できません: ${error.message}`);
  }
}

function electrobunVersion(text) {
  return text.match(/version:\s*"([^"]+)",\s*\/\/\s*secretary-app-version/)?.[1];
}

function readVersions() {
  const pkg = readJson(PATHS.packageJson);
  const versions = {
    "package.json": pkg.version,
    "electrobun.config.ts": electrobunVersion(readText(PATHS.electrobun)),
  };
  const missing = Object.entries(versions)
    .filter(([, value]) => typeof value !== "string" || value.length === 0)
    .map(([label]) => label);
  if (missing.length > 0) fail(`バージョンの欄が見つかりません: ${missing.join("、")}`);
  return versions;
}

function formatVersions(versions) {
  return VERSION_LABELS.map((label) => `  ${label}: ${versions[label]}`).join("\n");
}

function checkConsistent() {
  const versions = readVersions();
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) fail(`バージョンが揃っていません。\n${formatVersions(versions)}`);
  const version = [...unique][0];
  assertSemver(version, "バージョン");
  console.log(`バージョンは ${version} で揃っています。`);
}

function checkTag(tag) {
  const expected = versionFromTag(tag);
  const versions = readVersions();
  const mismatches = VERSION_LABELS.filter((label) => versions[label] !== expected);
  if (mismatches.length > 0) {
    const lines = mismatches.map((label) => `  ${label}: ${versions[label]}（期待: ${expected}）`).join("\n");
    fail(
      `タグ ${tag} とアプリのバージョンが一致しません。リリース手順に従って揃えてから、タグを打ち直してください。\n${lines}`,
    );
  }
  console.log(`タグ ${tag} とアプリのバージョン ${expected} は一致しています。`);
}

function replaceOnce(text, pattern, replacer, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const found = text.match(new RegExp(pattern.source, flags));
  if (!found || found.length !== 1) fail(`${label} の version を特定できません（${found ? found.length : 0} 件）。`);
  return text.replace(pattern, replacer);
}

function writeVersion(version) {
  assertSemver(version, "指定したバージョン");
  const packageJson = replaceOnce(
    readText(PATHS.packageJson),
    /"version"\s*:\s*"[^"]+"/g,
    (found) => found.replace(/"[^"]+"$/, `"${version}"`),
    PATHS.packageJson,
  );
  const electrobun = replaceOnce(
    readText(PATHS.electrobun),
    /version:\s*"[^"]+",\s*\/\/\s*secretary-app-version/g,
    () => `version: "${version}", // secretary-app-version`,
    PATHS.electrobun,
  );
  writeFileSync(join(process.cwd(), PATHS.packageJson), packageJson);
  writeFileSync(join(process.cwd(), PATHS.electrobun), electrobun);
  console.log(`バージョンを ${version} に揃えました。`);
  console.log(`  ${PATHS.packageJson}`);
  console.log(`  ${PATHS.electrobun}`);
}

function validateVersion(version) {
  assertSemver(version, "指定したバージョン");
  console.log(`バージョン ${version} は SemVer です。`);
}

function printUsage() {
  fail(
    [
      "使い方:",
      "  node scripts/version.mjs check-consistent",
      "  node scripts/version.mjs check v0.1.0",
      "  node scripts/version.mjs validate 0.1.0",
      "  node scripts/version.mjs set 0.1.0",
    ].join("\n"),
  );
}

const [command, arg, extra] = process.argv.slice(2);
if (extra !== undefined) fail("引数が多すぎます。");

if (command === "check-consistent") {
  if (arg !== undefined) fail("check-consistent に引数は要りません。");
  checkConsistent();
} else if (command === "check") {
  const tag = arg ?? process.env.RELEASE_TAG;
  if (!tag) fail("確認するタグを指定してください。例: node scripts/version.mjs check v0.1.0");
  checkTag(tag);
} else if (command === "validate") {
  if (!arg) fail("検証するバージョンを指定してください。例: node scripts/version.mjs validate 0.1.0");
  validateVersion(arg);
} else if (command === "set") {
  if (!arg) fail("設定するバージョンを指定してください。例: node scripts/version.mjs set 0.1.0");
  writeVersion(arg);
} else {
  printUsage();
}
