# 秘書

Notion から手で書き出した CSV を、この PC の中だけで読む小さな予定ウィンドウです。Notion の API も MCP も使いません。ネットワークで Notion に接続しません。

進行中の予定があれば終了までのカウントダウン、なければ次の予定を開始までのカウントダウンで出します。場所と参加リンク、今日残っている予定も出します。ファイルが無い、読めない、古すぎるときは画面で知らせます。

書き出し手順と日付のルールは [docs/notion-csv.md](docs/notion-csv.md) にあります。

## 動作環境

- Windows 10 以降（WebView2。Windows 11 には入っています）
- 開発には Node.js 22 と Rust の stable（1.90 以上）

画面の文言は日本語です。時刻にタイムゾーンが無い CSV は、初期設定では日本時間（Asia/Tokyo）として読みます。

## インストール

公開済みの [Releases](https://github.com/mongolyy/windows-secretary-app/releases) から、64 ビット Windows 用のインストーラを入れます。ファイル名は `Secretary_<バージョン>_x64-setup.exe` です。例: `Secretary_0.1.0_x64-setup.exe`。

1. 最新リリースの `Secretary_*_x64-setup.exe` をダウンロードする。
2. ダウンロードしたファイルを実行する。
3. インストール後、スタートメニューの「Secretary」から起動する。

このインストーラはコード署名していません。ブラウザや GitHub から保存した実行ファイルには「インターネットから取得した」印が付くため、Windows の SmartScreen が警告することがあります。

- 「Windows によって PC が保護されました」または「Microsoft Defender SmartScreen により、認識されていないアプリの起動が防止されました」と出たら、「詳細情報」を押す。
- 発行元は不明と表示されます。このリポジトリの Releases から取ったファイルだと確認できたら、「実行」を押す。インストーラが続きます。
- 会社の PC で、未署名のアプリをポリシーが禁止しているときは、このインストーラでは入れられません。

インストールは現在のユーザー向けです。管理者権限は要りません。削除は Windows の「設定 → アプリ」から「Secretary」を選びます。

WebView2 は Windows 11 には入っています。Windows 10 で入っていないときは、インストーラが初回だけダウンロードします。そのときだけネットワークが要ります。

初回起動時、予定ファイルがまだ無いときは画面で知らせます。Notion から書き出した CSV を次の場所に置きます。

```powershell
mkdir $env:USERPROFILE\secretary
copy 書き出した.csv $env:USERPROFILE\secretary\schedule.csv
```

設定で別のパスも指定できます。書き出し方は [docs/notion-csv.md](docs/notion-csv.md) です。

## セットアップ

```powershell
npm ci
```

## 開発

デスクトップアプリ:

```powershell
npm run tauri dev
```

枠のない、常に手前のウィンドウが開きます。タイトル部分をドラッグして移動できます。「前」で手前固定、「–」で最小化、「×」は初期設定では終了せずトレイにしまいます。トレイを左クリックすると再表示、右クリックで「表示 / 常に手前に表示を切り替え / 終了」です。もう一度起動すると、既存のウィンドウを前面に出します。

ブラウザだけで画面を見る（サンプル CSV。ファイル監視とトレイはありません）:

```bash
npm run dev
```

`http://localhost:1420` を開きます。下のバーで日本語 CSV、英語 CSV、ファイルなし、壊れた CSV、古い更新を切り替えられます。

サンプルをデスクトップ版で読むときは、設定で `samples/notion-ja.csv` を選ぶか、次の場所へコピーします。

```powershell
mkdir $env:USERPROFILE\secretary
copy samples\notion-ja.csv $env:USERPROFILE\secretary\schedule.csv
```

初期パスは `%USERPROFILE%\secretary\schedule.csv` です。設定ファイルは `%APPDATA%\secretary\settings.json` です。開発時だけ `SECRETARY_SCHEDULE_PATH` を置くと、設定より優先されます。

## テスト

```bash
npm test
npm run test:coverage
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm test` は CSV、Notion の日付（日本語・英語・終日・タイムゾーン）、列の自動判定、次の予定と残り時間です。Rust 側はパス、文字コード（UTF-8 BOM と UTF-16）、ファイルの読み分けです。`npm run test:coverage` は同じ Vitest を、カバレッジ付きで実行します。

リントと型:

```bash
npm run lint
npm run format:check
npm run typecheck
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

## CI

ブランチへの push と、フォークからの pull_request で、次の 3 ジョブが `windows-latest` で並行して動きます。同じリポジトリからの pull_request は、同じコミットの push ですでに走っているので繰り返しません。タグの push ではこの CI は動かず、下のリリース用ワークフローだけがインストーラを作ります。新しい push が来ると、同じブランチでまだ走っている実行はキャンセルします。

npm は `actions/setup-node` の cache、Cargo は `swatinem/rust-cache` を使います。ジョブごとにキャッシュのキーが分かれるので、テスト用の debug ビルドとリリースビルドが互いを上書きしません。使う Action はコミット SHA で固定しています。

| ジョブ | 内容 |
| --- | --- |
| フロントエンド | 6 箇所のバージョンが揃っていること、その確認スクリプトのテスト、Prettier、ESLint、`tsc --noEmit`、Vitest のカバレッジ、`npm audit` |
| Rust | `cargo fmt --check`、`cargo clippy -D warnings`、`cargo audit`、`cargo llvm-cov`（単体テストをカバレッジ付きで実行） |
| Windows ビルド | `npm run tauri build`（NSIS） |

カバレッジは Actions のアーティファクトに 14 日残します。フロントエンドは `coverage-frontend`（HTML と lcov）、Rust は `coverage-rust`（lcov）です。しきい値では失敗させません。

`npm audit --audit-level=moderate` は指摘があれば失敗します。いまの lock では 0 件です。

`cargo audit` は脆弱性があれば失敗します。未メンテナンスや unsound の警告はログに残しますが、失敗にはしません。いまの lock では推移的依存に警告が 6 件あります（chrono、proc-macro-error、zbus 系、glib）。直す版がアプリから選べないか、Windows の実行では使わない Linux 側のクレートです。`--deny warnings` にすると毎回赤くなるので、警告はレポートだけにしています。

Dependabot（`.github/dependabot.yml`）は npm、Cargo（`src-tauri`）、GitHub Actions の更新を、月曜起点の週次でプルリクエストにします。

## ビルド

Windows で NSIS インストーラを作ります。

```powershell
npm run tauri build
```

成果物は `src-tauri/target/release/bundle/nsis/` です。配布用は、次の手順でタグを push すると GitHub Release の下書きに付きます。

## リリースの切り方

アプリのバージョンは、次の 6 箇所を同じ SemVer に揃えます。`0.1.0` や `0.2.0-rc.1` の形で、先頭に `v` は付けません。タグを push したとき、ワークフローがこの 6 箇所とタグを比べます。1 つでも違えばビルドせずに失敗します。インストーラに入るバージョンは、タグおよびこれらのファイルと一致します。

- `package.json` の `version`
- `package-lock.json` の先頭と `packages[""]` の `version`
- `src-tauri/tauri.conf.json` の `version`
- `src-tauri/Cargo.toml` の `[package] version`
- `src-tauri/Cargo.lock` の `secretary` の `version`

まとめて書き換えるコマンドです。リポジトリのルートで実行します。

```powershell
node scripts/version.mjs set 0.1.0
```

手順:

1. 上のコマンドでバージョンを上げ、差分を `main` にコミットして push する。CI が通るのを待つ。
2. `.github/workflows/release.yml` が含まれるそのコミットに、タグを打って push する。タグは `v` に SemVer を続けます。

```powershell
git switch main
git pull
git tag v0.1.0
git push origin v0.1.0
```

3. GitHub Actions の「リリース」が `windows-latest` で NSIS インストーラだけをビルドする。
4. 同じタグの GitHub Release を**下書き**として作り、`Secretary_0.1.0_x64-setup.exe` を添付する。`-` を含むタグ（例: `v0.2.0-rc.1`）は、下書きかつプレリリースになる。
5. Releases の下書きを開き、ファイル名を確認してから「Publish release」で公開する。公開するまで、インストール手順のダウンロード対象にはならない。

下書きにしているのは、インストーラが未署名だからです。タグの push だけで利用者向けの最新版にはせず、公開前に人が成果物を確認します。

`v1` のように SemVer でないタグや、6 箇所と一致しないタグは、ワークフローが失敗して Release を作りません。そのときはタグを消して、バージョンを揃えたコミットに打ち直します。

```powershell
git push origin :refs/tags/v0.1.0
git tag -d v0.1.0
```

ワークフローは、タグが指すコミットに `release.yml` があるときだけ動きます。この手順を `main` へ入れたあとのコミットにタグを打ってください。

## データの流れ

1. 利用者が Notion の「エクスポート → CSV」でファイルを作る（ZIP なら展開する）。
2. アプリがその CSV を読み、変更を監視する。
3. 列名は自動判定するか、設定でタイトル・日時・終了・場所・URL を指定する。
4. 日付セルの `→` を期間として解釈する。ゾーンが無ければ日本時間。

アプリは予定ファイルを書き換えません。
