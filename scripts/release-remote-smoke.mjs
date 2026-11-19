#!/usr/bin/env node
// gh release view --json の結果と、手元の配布ディレクトリを突き合わせる。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [jsonPath, directory, extra] = process.argv.slice(2);
if (!jsonPath || !directory || extra !== undefined) {
  fail("使い方: node scripts/release-remote-smoke.mjs <gh-release.json> <配布ディレクトリ>");
}

let release;
try {
  release = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch (error) {
  fail(`リリース情報を読めません: ${error.message}`);
}

if (release.isDraft !== true) {
  fail("Release が下書きではありません。公開前にファイルを確認するため、下書きのままにします。");
}
const tag = release.tagName;
if (typeof tag !== "string" || !tag.startsWith("v")) {
  fail(`タグ名が不正です: ${tag}`);
}
const prerelease = tag.includes("-");
if (release.isPrerelease !== prerelease) {
  fail(prerelease ? `タグ ${tag} はプレリリースである必要があります。` : `タグ ${tag} はプレリリースではありません。`);
}

const localNames = readdirSync(directory).sort();
const assets = Array.isArray(release.assets) ? release.assets : [];
const remoteNames = assets.map((asset) => asset.name).sort();
if (localNames.join("\n") !== remoteNames.join("\n")) {
  fail(`Release の添付が手元のファイルと違います。手元: ${localNames.join(", ")} / Release: ${remoteNames.join(", ")}`);
}

for (const asset of assets) {
  const size = statSync(join(directory, asset.name)).size;
  if (Number(asset.size) !== size) {
    fail(`${asset.name} のサイズが違います。手元 ${size} バイト、Release ${asset.size} バイト。`);
  }
  if (typeof asset.digest === "string" && asset.digest.length > 0) {
    const hash = createHash("sha256")
      .update(readFileSync(join(directory, asset.name)))
      .digest("hex");
    if (asset.digest !== `sha256:${hash}`) {
      fail(`${asset.name} の digest が SHA256 と一致しません。`);
    }
  }
}

console.log(`下書き Release ${tag} の添付 ${assets.length} 件は、手元のファイルと一致しました。`);
