#!/usr/bin/env node
// Electrobun のセットアップ zip と、アプリ一式のポータブル zip、SHA256SUMS を揃える。
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
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
    if (!token.startsWith("--") || token.length < 3) fail(`引数を解釈できません: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${token} の値がありません。`);
    if (Object.hasOwn(args, name)) fail(`引数が重複しています: ${token}`);
    args[name] = value;
    index += 1;
  }
  return args;
}

function readIdentity(args) {
  let product = args.product;
  let version = args.version;
  if (!product || !version) {
    const configPath = args.config ?? "electrobun.config.ts";
    let text;
    try {
      text = readFileSync(configPath, "utf8");
    } catch (error) {
      fail(`${configPath} を読めません: ${error.message}`);
    }
    product ??= text.match(/name:\s*"([^"]+)"/)?.[1];
    version ??= text.match(/version:\s*"([^"]+)",\s*\/\/\s*secretary-app-version/)?.[1];
  }
  if (typeof product !== "string" || product.length === 0 || /[\\/]/.test(product))
    fail(`product が不正です: ${product}`);
  if (typeof version !== "string" || version.length === 0 || /[\\/]/.test(version))
    fail(`version が不正です: ${version}`);
  return { product, version };
}

function artifactBase({ product, version, arch, channel, revision }) {
  let base = `${product}_${version}_${arch}`;
  if (channel) base += `-${channel}`;
  if (revision) base += `-${revision}`;
  return base;
}

function walk(directory, found = []) {
  try {
    if (!statSync(directory).isDirectory()) return found;
  } catch {
    return found;
  }
  for (const name of readdirSync(directory)) {
    const absolute = join(directory, name);
    let info;
    try {
      info = statSync(absolute);
    } catch {
      continue;
    }
    if (info.isDirectory()) walk(absolute, found);
    else if (info.isFile()) found.push(absolute);
  }
  return found;
}

function discover(artifactsDir, buildDir) {
  const setups = walk(artifactsDir).filter((file) => /Setup\.zip$/i.test(basename(file)));
  const windows = setups.filter((file) => file.includes(`${sep}win-`) || basename(file).startsWith("win-"));
  const setup = (windows.length > 0 ? windows : setups).sort()[0];
  if (!setup) fail(`インストーラがありません: ${artifactsDir}\n${walk(artifactsDir).slice(0, 40).join("\n")}`);
  const exes = walk(buildDir).filter((file) => basename(file) === "Secretary.exe");
  const preferred = exes.find((file) => file.includes(`${sep}bin${sep}`)) ?? exes[0];
  if (!preferred) fail(`Secretary.exe がありません: ${buildDir}\n${walk(buildDir).slice(0, 40).join("\n")}`);
  const parent = dirname(preferred);
  const appDir = basename(parent).toLowerCase() === "bin" ? dirname(parent) : parent;
  return { setup, appDir };
}

function zipDirectory(directory) {
  const entries = [];
  function visit(current, prefix) {
    for (const name of readdirSync(current)) {
      const absolute = join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = statSync(absolute);
      if (info.isDirectory()) visit(absolute, relative);
      else if (info.isFile()) entries.push({ name: relative, data: readFileSync(absolute) });
    }
  }
  visit(directory, "");
  if (entries.length === 0) fail(`ポータブル版に入れるファイルがありません: ${directory}`);
  return entries;
}

const ALLOWED = new Set([
  "setup",
  "app-dir",
  "artifacts",
  "build",
  "out",
  "product",
  "version",
  "config",
  "tag",
  "channel",
  "revision",
  "arch",
]);

const args = parseArgs(process.argv.slice(2));
for (const key of Object.keys(args)) {
  if (!ALLOWED.has(key)) fail(`不明な引数です: --${key}`);
}
if (!args.out) {
  fail(
    "使い方: node scripts/collect-release-assets.mjs --out <dir> (--setup と --app-dir、または --artifacts と --build)",
  );
}

let setupPath = args.setup;
let appDir = args["app-dir"];
if (!setupPath || !appDir) {
  if (!args.artifacts || !args.build) {
    fail("インストーラとアプリの場所を、--setup と --app-dir、または --artifacts と --build で指定してください。");
  }
  const found = discover(args.artifacts, args.build);
  setupPath ??= found.setup;
  appDir ??= found.appDir;
}

const arch = args.arch ?? "x64";
if (!/^[a-z0-9]+$/.test(arch)) fail(`arch が不正です: ${arch}`);
const channel = args.channel;
if (channel !== undefined && !/^[a-z][a-z0-9-]{0,20}$/.test(channel)) fail(`channel が不正です: ${channel}`);
const revision = args.revision;
if (revision !== undefined && !/^[0-9a-f]{7,40}$/.test(revision)) {
  fail(`revision は 7 文字以上の16進数にしてください: ${revision}`);
}
if (revision && !channel) fail("revision を付けるときは channel も指定してください。");

const { product, version } = readIdentity(args);
if (args.tag && (!args.tag.startsWith("v") || args.tag.slice(1) !== version)) {
  fail(`タグ ${args.tag} とバージョン ${version} が一致しません。`);
}

try {
  if (!statSync(setupPath).isFile()) fail(`インストーラがファイルではありません: ${setupPath}`);
} catch (error) {
  fail(`インストーラがありません: ${setupPath}（${error.message}）`);
}
try {
  if (!statSync(appDir).isDirectory()) fail(`アプリのフォルダがありません: ${appDir}`);
} catch (error) {
  fail(`アプリのフォルダがありません: ${appDir}（${error.message}）`);
}

const base = artifactBase({ product, version, arch, channel, revision });
const setupName = `${base}-setup.zip`;
const zipName = `${base}-portable.zip`;
rmSync(args.out, { recursive: true, force: true });
mkdirSync(args.out, { recursive: true });
copyFileSync(setupPath, join(args.out, setupName));
writeZip(zipDirectory(appDir), join(args.out, zipName));

const entries = [setupName, zipName]
  .sort((left, right) => left.localeCompare(right))
  .map((name) => ({ name, hash: sha256File(join(args.out, name)) }));
writeFileSync(join(args.out, "SHA256SUMS.txt"), formatChecksums(entries));
console.log(`配布物を揃えました: ${args.out}`);
console.log(`  ${setupName}`);
console.log(`  ${zipName}（アプリ一式。実行ファイルは Secretary.exe）`);
console.log("  SHA256SUMS.txt");
