#!/usr/bin/env node
// NSIS インストーラと exe 単体の zip、SHA256SUMS を 1 つのディレクトリに揃える。
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { formatChecksums, sha256File } from "./checksums.mjs";
import { writeZip } from "./zip.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || token.length < 3) {
      fail(`引数を解釈できません: ${token}`);
    }
    const name = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`${token} の値がありません。`);
    }
    if (Object.hasOwn(args, name)) {
      fail(`引数が重複しています: ${token}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

function readIdentity(args) {
  let product = args.product;
  let version = args.version;
  if (!product || !version) {
    const tauriPath = args.tauri ?? "src-tauri/tauri.conf.json";
    let tauri;
    try {
      tauri = JSON.parse(readFileSync(tauriPath, "utf8"));
    } catch (error) {
      fail(`${tauriPath} を読めません: ${error.message}`);
    }
    product ??= tauri.productName;
    version ??= tauri.version;
  }
  if (typeof product !== "string" || product.length === 0 || /[\\/]/.test(product)) {
    fail(`productName が不正です: ${product}`);
  }
  if (typeof version !== "string" || version.length === 0 || /[\\/]/.test(version)) {
    fail(`version が不正です: ${version}`);
  }
  return { product, version };
}

function artifactBase({ product, version, arch, channel, revision }) {
  let base = `${product}_${version}_${arch}`;
  if (channel) {
    base += `-${channel}`;
  }
  if (revision) {
    base += `-${revision}`;
  }
  return base;
}

const ALLOWED = new Set([
  "exe",
  "setup-dir",
  "out",
  "product",
  "version",
  "tauri",
  "tag",
  "channel",
  "revision",
  "arch",
]);

const args = parseArgs(process.argv.slice(2));
for (const key of Object.keys(args)) {
  if (!ALLOWED.has(key)) {
    fail(`不明な引数です: --${key}`);
  }
}
if (!args.exe || !args["setup-dir"] || !args.out) {
  fail("使い方: node scripts/collect-release-assets.mjs --exe <exe> --setup-dir <nsis> --out <dir>");
}

const arch = args.arch ?? "x64";
if (!/^[a-z0-9]+$/.test(arch)) {
  fail(`arch が不正です: ${arch}`);
}
const channel = args.channel;
if (channel !== undefined && !/^[a-z][a-z0-9-]{0,20}$/.test(channel)) {
  fail(`channel が不正です: ${channel}`);
}
const revision = args.revision;
if (revision !== undefined && !/^[0-9a-f]{7,40}$/.test(revision)) {
  fail(`revision は 7 文字以上の16進数にしてください: ${revision}`);
}
if (revision && !channel) {
  fail("revision を付けるときは channel も指定してください。");
}

const { product, version } = readIdentity(args);
if (args.tag) {
  if (!args.tag.startsWith("v") || args.tag.slice(1) !== version) {
    fail(`タグ ${args.tag} とバージョン ${version} が一致しません。`);
  }
}

const sourceSetupName = `${product}_${version}_${arch}-setup.exe`;
const sourceSetup = join(args["setup-dir"], sourceSetupName);
try {
  if (!statSync(sourceSetup).isFile()) {
    fail(`インストーラがファイルではありません: ${sourceSetup}`);
  }
} catch (error) {
  fail(`インストーラがありません: ${sourceSetup}（${error.message}）`);
}
try {
  if (!statSync(args.exe).isFile()) {
    fail(`exe がファイルではありません: ${args.exe}`);
  }
} catch (error) {
  fail(`exe がありません: ${args.exe}（${error.message}）`);
}

const base = artifactBase({ product, version, arch, channel, revision });
const setupName = `${base}-setup.exe`;
const zipName = `${base}-portable.zip`;
const exeName = basename(args.exe);

rmSync(args.out, { recursive: true, force: true });
mkdirSync(args.out, { recursive: true });
copyFileSync(sourceSetup, join(args.out, setupName));
writeZip([{ name: exeName, data: readFileSync(args.exe) }], join(args.out, zipName));

const checksumPath = join(args.out, "SHA256SUMS.txt");
const entries = [setupName, zipName]
  .sort((left, right) => left.localeCompare(right))
  .map((name) => ({ name, hash: sha256File(join(args.out, name)) }));
writeFileSync(checksumPath, formatChecksums(entries));

console.log(`配布物を揃えました: ${args.out}`);
console.log(`  ${setupName}`);
console.log(`  ${zipName}（中のファイルは ${exeName} だけ）`);
console.log("  SHA256SUMS.txt");
