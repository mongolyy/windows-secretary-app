// 依存を増やさず、exe を 1 つ入れた zip を読み書きする。
import { deflateRawSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const UTF8 = 0x0800;
// 2026-01-01 00:00。DOS 日付の 0 は不正なので、固定の妥当な日時を書く。
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function fail(message) {
  throw new Error(message);
}

function validZipName(name) {
  if (!name || name.includes("\\") || name.startsWith("/") || name.endsWith("/")) return false;
  return name.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return ~crc >>> 0;
}

export function writeZip(entries, outPath) {
  if (!Array.isArray(entries) || entries.length === 0) {
    fail("ZIP に入れるファイルがありません。");
  }
  const parts = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    if (typeof entry.name !== "string" || !validZipName(entry.name)) {
      fail(`ZIP 内の名前が不正です: ${entry.name}`);
    }
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const compressed = deflateRawSync(data);
    const method = compressed.length < data.length ? 8 : 0;
    const payload = method === 8 ? compressed : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    parts.push(local, payload);
    centrals.push(central);
    offset += local.length + payload.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.concat([...parts, centralDir, eocd]));
}

export function listZipEntries(zipPath) {
  const data = readFileSync(zipPath);
  if (data.length < 22) {
    fail(`ZIP が短すぎます: ${zipPath}`);
  }
  const eocd = data.length - 22;
  if (data.readUInt32LE(eocd) !== EOCD) {
    fail(`ZIP の終端が見つかりません: ${zipPath}`);
  }
  if (data.readUInt16LE(eocd + 20) !== 0) {
    fail(`ZIP コメントは空である必要があります: ${zipPath}`);
  }
  const count = data.readUInt16LE(eocd + 10);
  const centralSize = data.readUInt32LE(eocd + 12);
  const centralOffset = data.readUInt32LE(eocd + 16);
  const names = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== CENTRAL) {
      fail(`ZIP の中央ディレクトリが壊れています: ${zipPath}`);
    }
    const nameLen = data.readUInt16LE(cursor + 28);
    const extraLen = data.readUInt16LE(cursor + 30);
    const commentLen = data.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    const name = data.subarray(nameStart, nameStart + nameLen).toString("utf8");
    names.push(name);
    cursor = nameStart + nameLen + extraLen + commentLen;
  }
  if (cursor !== centralOffset + centralSize) {
    fail(`ZIP の中央ディレクトリの長さが合いません: ${zipPath}`);
  }
  return names;
}
