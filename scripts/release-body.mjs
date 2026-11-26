#!/usr/bin/env node
// 下書き Release の説明文。自動生成ノートの前に付く。
import { writeFileSync } from "node:fs";

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const tag = process.env.RELEASE_TAG ?? "";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const out = process.env.BODY_PATH ?? "";
const signed = process.env.SIGN_ENABLED === "true";
const attested = process.env.ATTEST_ENABLED === "true";

if (!TAG.test(tag)) {
  fail(`タグの形式が不正です: ${tag}`);
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  fail(`リポジトリ名が不正です: ${repo}`);
}
if (!out) {
  fail("BODY_PATH が必要です。");
}

const version = tag.slice(1);
const setup = `Secretary_${version}_x64-setup.zip`;
const portable = `Secretary_${version}_x64-portable.zip`;
const signNote = signed
  ? "このビルドはコード署名しています。"
  : "このビルドはコード署名していません。WINDOWS_CERTIFICATE と WINDOWS_CERTIFICATE_PASSWORD が無いため、署名をスキップしました。SmartScreen が出たら「詳細情報」を開き、「実行」を選びます。未署名のアプリを禁止している PC では入れられません。";
const attestNote = attested
  ? `ビルド来歴も記録しています。\`gh attestation verify\` で、このリポジトリの Actions でビルドされたことを確認できます。`
  : "このリポジトリは個人アカウントの非公開リポジトリのため、GitHub がビルド来歴を保存できません。来歴の記録はスキップしています。ファイルの同一性は SHA256 で確認してください。";
const attestCommands = attested
  ? `
gh attestation verify .\\${setup} --repo ${repo}
gh attestation verify .\\${portable} --repo ${repo}`
  : "";

const body = `タグ ${tag} から作った下書きです。添付ファイルを確認してから Publish release で公開してください。公開するまで、利用者向けの最新版にはなりません。

${signNote}

${attestNote}

## ファイル

- \`${setup}\` は Electrobun のセットアップ一式です。展開して中のセットアップを実行します。現在のユーザー向けで、管理者権限は要りません。
- \`${portable}\` はアプリ一式のポータブル版です。インストールは不要で、中の \`bin/launcher.exe\` を起動します。WebView2 は同梱しません。Windows 11 には入っています。Windows 10 で未導入のときは、先に WebView2 ランタイムが必要です。この zip はランタイムをダウンロードしません。
- \`SHA256SUMS.txt\` は上の 2 ファイルの SHA256 です。

WebView2 が無い Windows 10 では、先にランタイムを入れてから使います。アプリ自身は WebView2 をダウンロードしません。自動アップデートはありません。

## 確認

PowerShell:

\`\`\`powershell
Get-FileHash .\\${setup} -Algorithm SHA256
Get-Content .\\SHA256SUMS.txt${attestCommands}
\`\`\`

Git Bash では \`sha256sum -c SHA256SUMS.txt\` も使えます。

予定の CSV は \`%USERPROFILE%\\secretary\\schedule.csv\` に置きます。
`;

writeFileSync(out, body);
console.log(`リリース本文を書きました: ${out}`);
