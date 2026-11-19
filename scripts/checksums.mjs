#!/usr/bin/env node
// SHA256SUMS を書き、sha256sum -c と同じ「ハッシュ、空白 2 つ、ファイル名」で照合する。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LINE = /^([0-9a-f]{64})  (.+)$/;

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function formatChecksums(entries) {
  const lines = entries.map((entry) => {
    if (!/^[0-9a-f]{64}$/.test(entry.hash)) {
      throw new Error(`SHA256 ではありません: ${entry.hash}`);
    }
    if (typeof entry.name !== "string" || entry.name.length === 0 || /[\r\n]/.test(entry.name)) {
      throw new Error(`チェックサムのファイル名が不正です: ${entry.name}`);
    }
    return `${entry.hash}  ${entry.name}`;
  });
  return `${lines.join("\n")}\n`;
}

export function parseChecksums(text) {
  if (text.includes("\r")) {
    throw new Error("チェックサムは LF のみにしてください。");
  }
  if (!text.endsWith("\n")) {
    throw new Error("チェックサムの末尾に改行がありません。");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error("チェックサムが空か、空行があります。");
  }
  return lines.map((line) => {
    const match = LINE.exec(line);
    if (!match) {
      throw new Error(`チェックサムの行を解釈できません: ${line}`);
    }
    return { hash: match[1], name: match[2] };
  });
}

export function verifyChecksumFile(checksumPath, directory = dirname(checksumPath)) {
  const entries = parseChecksums(readFileSync(checksumPath, "utf8"));
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new Error(`チェックサムのファイル名が重複しています: ${entry.name}`);
    }
    seen.add(entry.name);
    if (entry.name.includes("/") || entry.name.includes("\\") || entry.name === "SHA256SUMS.txt") {
      throw new Error(`チェックサムの対象にできない名前です: ${entry.name}`);
    }
    const actual = sha256File(join(directory, entry.name));
    if (actual !== entry.hash) {
      throw new Error(`${entry.name} の SHA256 が一致しません。`);
    }
  }
  return entries;
}

function printUsage() {
  throw new Error(
    [
      "使い方:",
      "  node scripts/checksums.mjs write <SHA256SUMS.txt> <file>...",
      "  node scripts/checksums.mjs verify <SHA256SUMS.txt> [directory]",
    ].join("\n"),
  );
}

function writeCommand(outputPath, files) {
  if (files.length === 0) {
    throw new Error("ハッシュを計算するファイルを指定してください。");
  }
  const names = files.map((file) => basename(file));
  if (new Set(names).size !== names.length) {
    throw new Error("同じファイル名が複数あります。別々のディレクトリのファイルは同時に書けません。");
  }
  const entries = files.map((file, index) => ({ hash: sha256File(file), name: names[index] }));
  entries.sort((left, right) => left.name.localeCompare(right.name));
  writeFileSync(outputPath, formatChecksums(entries));
  console.log(`チェックサムを書きました: ${outputPath}`);
  for (const entry of entries) {
    console.log(`  ${entry.hash}  ${entry.name}`);
  }
}

function main() {
  const [command, first, ...rest] = process.argv.slice(2);
  if (command === "write") {
    if (!first) {
      printUsage();
    }
    writeCommand(first, rest);
    return;
  }
  if (command === "verify") {
    if (!first || rest.length > 1) {
      printUsage();
    }
    const entries = verifyChecksumFile(first, rest[0]);
    console.log(`チェックサムは ${entries.length} 件とも一致しました。`);
    return;
  }
  printUsage();
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const fromArgv = pathToFileURL(resolve(entry)).href;
  return process.platform === "win32"
    ? fromArgv.toLowerCase() === import.meta.url.toLowerCase()
    : fromArgv === import.meta.url;
}

if (invokedDirectly()) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
