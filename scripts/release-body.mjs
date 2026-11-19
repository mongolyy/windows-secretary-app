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
const setup = `Secretary_${version}_x64-setup.exe`;
const portable = `Secretary_${version}_x64-portable.zip`;
const signNote = signed
  ? "このビルドはコード署名しています。"
  : "このビルドはコード署名していません。WINDOWS_CERTIFICATE と WINDOWS_CERTIFICATE_PASSWORD が無いため、署名をスキップしました。SmartScreen が出たら「詳細情報」を開き、「実行」を選びます。未署名のアプリを禁止している PC では入れられません。";

const body = `タグ ${tag} から作った下書きです。添付ファイルを確認してから Publish release で公開してください。公開するまで、利用者向けの最新版にはなりません。

${signNote}

## ファイル

- \`${setup}\` は NSIS インストーラです。現在のユーザー向けで、管理者権限は要りません。
- \`${portable}\` は \`secretary.exe\` だけのポータブル版です。インストールは不要です。WebView2 は同梱しません。Windows 11 には入っています。Windows 10 で未導入のときは、先に WebView2 ランタイムが必要です。この zip はランタイムをダウンロードしません。
- \`SHA256SUMS.txt\` は上の 2 ファイルの SHA256 です。

インストーラは、WebView2 が無い PC で初回だけダウンロードします。そのときだけネットワークが要ります。自動アップデートはありません。

## 確認

PowerShell:

\`\`\`powershell
Get-FileHash .\\${setup} -Algorithm SHA256
Get-Content .\\SHA256SUMS.txt
gh attestation verify .\\${setup} --repo ${repo}
gh attestation verify .\\${portable} --repo ${repo}
\`\`\`

Git Bash では \`sha256sum -c SHA256SUMS.txt\` も使えます。来歴の確認は、このリポジトリの Actions でビルドされたことを見ます。

予定の CSV は \`%USERPROFILE%\\secretary\\schedule.csv\` に置きます。
`;

writeFileSync(out, body);
console.log(`リリース本文を書きました: ${out}`);
