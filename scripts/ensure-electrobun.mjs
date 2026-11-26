#!/usr/bin/env node
// Electrobun 2.0.6 の Hutch を、ピンした URL と SHA256 で取って展開する。
// bun install --ignore-scripts では配布物を落とさない。ビルドの前にこれを明示的に実行する。
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootOfScript = fileURLToPath(new URL("..", import.meta.url));

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function platformKey(platform = process.platform, arch = process.arch) {
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : "";
  const os = platform === "win32" ? "windows" : platform === "linux" ? "linux" : platform === "darwin" ? "macos" : "";
  if (!os || !cpu) fail(`この OS とアーキテクチャには Electrobun のピンがありません: ${platform} ${arch}`);
  return `${os}-${cpu}`;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    fail(`ダウンロードに失敗しました: ${url} (${response.status})`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  await pipeline(response.body, createWriteStream(destination));
}

function verifyFile(file, expected) {
  const size = statSync(file).size;
  if (expected.size != null && size !== expected.size) {
    fail(`${file} のサイズが違います。期待 ${expected.size}、実際 ${size}`);
  }
  const hash = sha256(file);
  if (hash !== expected.sha256) {
    fail(`${file} の SHA256 が違います。期待 ${expected.sha256}、実際 ${hash}`);
  }
}

function findBinary(directory, name) {
  const wanted = new Set([name, `${name}.exe`]);
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (wanted.has(entry.name)) return absolute;
    }
  }
  return "";
}

export async function ensureElectrobun(projectRoot = rootOfScript) {
  const pin = JSON.parse(readFileSync(join(projectRoot, "scripts/electrobun-pin.json"), "utf8"));
  if (pin.version !== "2.0.6") fail(`Electrobun のピンが 2.0.6 ではありません: ${pin.version}`);
  const key = platformKey();
  const hutchPin = pin.hutch?.[key];
  const corePin = pin.core?.[key];
  if (!hutchPin || !corePin) fail(`Electrobun ${pin.version} に ${key} のピンがありません。`);

  const cache = join(projectRoot, ".electrobun");
  const downloadDir = join(cache, "downloads");
  mkdirSync(downloadDir, { recursive: true });

  const hutchIndex = join(downloadDir, "hutch-artifacts.json");
  const coreIndex = join(downloadDir, "electrobun-artifacts.json");
  const hutchArchive = join(downloadDir, `hutch-${key}.tar.gz`);
  const coreArchive = join(downloadDir, `core-${key}.tar.gz`);
  await download(pin.hutchIndex.url, hutchIndex);
  await download(pin.electrobunIndex.url, coreIndex);
  verifyFile(hutchIndex, pin.hutchIndex);
  verifyFile(coreIndex, pin.electrobunIndex);

  const hutchIndexJson = JSON.parse(readFileSync(hutchIndex, "utf8"));
  const coreIndexJson = JSON.parse(readFileSync(coreIndex, "utf8"));
  if (hutchIndexJson.platforms?.[key]?.archive?.sha256 !== hutchPin.sha256) {
    fail("Hutch の索引に書かれた SHA256 が、リポジトリのピンと違います。");
  }
  if (coreIndexJson.platforms?.[key]?.core?.sha256 !== corePin.sha256) {
    fail("Electrobun core の索引に書かれた SHA256 が、リポジトリのピンと違います。");
  }

  await download(hutchPin.url, hutchArchive);
  await download(corePin.url, coreArchive);
  verifyFile(hutchArchive, hutchPin);
  verifyFile(coreArchive, corePin);

  const hutchDir = join(cache, "hutch");
  mkdirSync(hutchDir, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", hutchArchive, "-C", hutchDir], { encoding: "utf8" });
  if (extracted.status !== 0) fail(`Hutch を展開できませんでした: ${extracted.stderr}`);
  const binary = findBinary(hutchDir, "hutch");
  if (!binary) fail("展開した Hutch に実行ファイルがありません。");
  writeFileSync(join(cache, "hutch-path.txt"), `${binary}\n`);
  console.log(`Electrobun ${pin.version} の Hutch を確認しました: ${binary}`);
  return binary;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invoked === import.meta.url) {
  await ensureElectrobun();
}
