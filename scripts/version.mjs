#!/usr/bin/env node
// アプリのバージョンをタグと揃える。
//
// 対象は次の 6 箇所。リリース用のタグ（例: v0.1.0）は、先頭の v を除いた値と
// これらが全部一致している必要がある。
//   package.json の version
//   package-lock.json の先頭と packages[""] の version
//   src-tauri/tauri.conf.json の version
//   src-tauri/Cargo.toml の [package] version
//   src-tauri/Cargo.lock の secretary の version
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

// Cargo が受け付ける SemVer。ビルドメタデータ（+ 以降）は付けない。
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const PATHS = {
  packageJson: "package.json",
  packageLock: "package-lock.json",
  tauriConf: "src-tauri/tauri.conf.json",
  cargoToml: "src-tauri/Cargo.toml",
  cargoLock: "src-tauri/Cargo.lock",
};

const VERSION_LABELS = [
  "package.json",
  "package-lock.json",
  "package-lock.json (packages)",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertSemver(version, label) {
  if (!SEMVER.test(version)) {
    fail(`${label}が SemVer ではありません: ${version}`);
  }
}

function versionFromTag(tag) {
  if (!tag.startsWith("v")) {
    fail(`タグは v で始めてください: ${tag}`);
  }
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
  const text = readText(relativePath);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${relativePath} の JSON を解釈できません: ${error.message}`);
  }
}

function readVersions() {
  const pkg = readJson(PATHS.packageJson);
  const lock = readJson(PATHS.packageLock);
  const tauri = readJson(PATHS.tauriConf);
  const cargoToml = readText(PATHS.cargoToml);
  const cargoLock = readText(PATHS.cargoLock);
  const cargoVersion = cargoToml.match(/^version = "([^"]+)"/m)?.[1];
  const cargoLockVersion = cargoLock.match(/name = "secretary"\r?\nversion = "([^"]+)"/)?.[1];

  const versions = {
    "package.json": pkg.version,
    "package-lock.json": lock.version,
    "package-lock.json (packages)": lock.packages?.[""]?.version,
    "src-tauri/tauri.conf.json": tauri.version,
    "src-tauri/Cargo.toml": cargoVersion,
    "src-tauri/Cargo.lock": cargoLockVersion,
  };

  const missing = Object.entries(versions)
    .filter(([, value]) => typeof value !== "string" || value.length === 0)
    .map(([label]) => label);
  if (missing.length > 0) {
    fail(`バージョンの欄が見つかりません: ${missing.join("、")}`);
  }
  return versions;
}

function formatVersions(versions) {
  return VERSION_LABELS.map((label) => `  ${label}: ${versions[label]}`).join("\n");
}

function checkConsistent() {
  const versions = readVersions();
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    fail(`バージョンが揃っていません。\n${formatVersions(versions)}`);
  }
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

function replacePackageLockVersions(text, version) {
  // lockfileVersion 3 のルートパッケージは、先頭と packages[""] の 2 箇所。
  // 依存パッケージの version は、この形に一致しないので触らない。
  const root = /^\{[ \t]*\r?\n([ \t]+)"name": "secretary",[ \t]*\r?\n\1"version": "[^"]+"/;
  const packages =
    /"packages": \{[ \t]*\r?\n[ \t]+"": \{[ \t]*\r?\n[ \t]+"name": "secretary",[ \t]*\r?\n[ \t]+"version": "[^"]+"/;
  if (!root.test(text) || !packages.test(text)) {
    fail("package-lock.json の先頭、または packages の version を特定できません。");
  }
  const replaceVersion = (chunk) => chunk.replace(/"version": "[^"]+"/, `"version": "${version}"`);
  return text.replace(root, replaceVersion).replace(packages, replaceVersion);
}

function replaceOnce(text, pattern, replacer, label) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const found = text.match(new RegExp(pattern.source, flags));
  if (!found || found.length !== 1) {
    fail(`${label} の version を特定できません（${found ? found.length : 0} 件）。`);
  }
  // 置換文字列の $1 とバージョン先頭の数字がつながると、別の参照になる。関数で返す。
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
  const tauriConf = replaceOnce(
    readText(PATHS.tauriConf),
    /"version"\s*:\s*"[^"]+"/g,
    (found) => found.replace(/"[^"]+"$/, `"${version}"`),
    PATHS.tauriConf,
  );
  const cargoToml = replaceOnce(
    readText(PATHS.cargoToml),
    /^version = "[^"]+"/gm,
    () => `version = "${version}"`,
    PATHS.cargoToml,
  );
  const cargoLock = replaceOnce(
    readText(PATHS.cargoLock),
    /(name = "secretary"\r?\nversion = ")[^"]+(")/g,
    (_found, prefix, suffix) => `${prefix}${version}${suffix}`,
    PATHS.cargoLock,
  );
  const updatedLock = replacePackageLockVersions(readText(PATHS.packageLock), version);

  const writes = [
    [PATHS.packageJson, packageJson],
    [PATHS.packageLock, updatedLock],
    [PATHS.tauriConf, tauriConf],
    [PATHS.cargoToml, cargoToml],
    [PATHS.cargoLock, cargoLock],
  ];
  for (const [relativePath, text] of writes) {
    writeFileSync(join(process.cwd(), relativePath), text);
  }
  console.log(`バージョンを ${version} に揃えました。`);
  for (const [relativePath] of writes) {
    console.log(`  ${relativePath}`);
  }
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
if (extra !== undefined) {
  fail("引数が多すぎます。");
}

if (command === "check-consistent") {
  if (arg !== undefined) {
    fail("check-consistent に引数は要りません。");
  }
  checkConsistent();
} else if (command === "check") {
  const tag = arg ?? process.env.RELEASE_TAG;
  if (!tag) {
    fail("確認するタグを指定してください。例: node scripts/version.mjs check v0.1.0");
  }
  checkTag(tag);
} else if (command === "validate") {
  if (!arg) {
    fail("検証するバージョンを指定してください。例: node scripts/version.mjs validate 0.1.0");
  }
  validateVersion(arg);
} else if (command === "set") {
  if (!arg) {
    fail("設定するバージョンを指定してください。例: node scripts/version.mjs set 0.1.0");
  }
  writeVersion(arg);
} else {
  printUsage();
}
