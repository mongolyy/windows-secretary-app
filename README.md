# 秘書

Notion から手で書き出した CSV を、この PC の中だけで読む小さな予定ウィンドウです。Notion の API も MCP も使いません。ネットワークで Notion に接続しません。

進行中の予定があれば終了までのカウントダウン、なければ次の予定を開始までのカウントダウンで出します。場所と参加リンク、今日残っている予定も出します。ファイルが無い、読めない、古すぎるときは画面で知らせます。

書き出し手順と日付のルールは [docs/notion-csv.md](docs/notion-csv.md) にあります。

## 動作環境

- Windows 10 以降（WebView2。Windows 11 には入っています）
- 開発には Node.js 22 と Rust の stable（1.90 以上）

画面の文言は日本語です。時刻にタイムゾーンが無い CSV は、初期設定では日本時間（Asia/Tokyo）として読みます。

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
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm test` は CSV、Notion の日付（日本語・英語・終日・タイムゾーン）、列の自動判定、次の予定と残り時間です。Rust 側はパス、文字コード（UTF-8 BOM と UTF-16）、ファイルの読み分けです。

## ビルド

Windows で NSIS インストーラを作ります。

```powershell
npm run tauri build
```

成果物は `src-tauri/target/release/bundle/nsis/` です。

## データの流れ

1. 利用者が Notion の「エクスポート → CSV」でファイルを作る（ZIP なら展開する）。
2. アプリがその CSV を読み、変更を監視する。
3. 列名は自動判定するか、設定でタイトル・日時・終了・場所・URL を指定する。
4. 日付セルの `→` を期間として解釈する。ゾーンが無ければ日本時間。

アプリは予定ファイルを書き換えません。
