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
2. 同じ Release の `SHA256SUMS.txt` と突き合わせ、必要ならビルド来歴も確認する（下の「ファイルの確認」）。
3. ダウンロードしたファイルを実行する。
4. インストール後、スタートメニューの「Secretary」から起動する。

証明書の Secrets を設定して切ったリリースは、コード署名されています。Secrets が無いリリースは未署名です。未署名の実行ファイルには「インターネットから取得した」印が付くため、Windows の SmartScreen が警告することがあります。

- 「Windows によって PC が保護されました」または「Microsoft Defender SmartScreen により、認識されていないアプリの起動が防止されました」と出たら、「詳細情報」を押す。
- 発行元は不明と表示されます。このリポジトリの Releases から取ったファイルだと確認できたら、「実行」を押す。インストーラが続きます。
- 会社の PC で、未署名のアプリをポリシーが禁止していて、署名用の証明書も無いときは、このインストーラでは入れられません。

インストールは現在のユーザー向けです。管理者権限は要りません。削除は Windows の「設定 → アプリ」から「Secretary」を選びます。

WebView2 は Windows 11 には入っています。Windows 10 で入っていないときは、インストーラが初回だけダウンロードします。そのときだけネットワークが要ります。

### ポータブル版

インストーラが使えないときは、同じ Release の `Secretary_<バージョン>_x64-portable.zip` を展開します。中にあるのは `secretary.exe` だけです。インストールは不要で、その exe を起動します。

ポータブル版は WebView2 を同梱しません。ダウンロードもしません。Windows 11 には WebView2 が入っています。Windows 10 で未導入のときは、先に WebView2 の Evergreen ランタイムを入れてください。ネットワークを使わない PC では、WebView2 が入っていることを確認してからこの zip を使います。

### ファイルの確認

`SHA256SUMS.txt` は、インストーラとポータブル版の SHA256 です。PowerShell では次のように比べます。表示されたハッシュが、`SHA256SUMS.txt` の該当行と一致すれば、ファイルは Release のものと同一です。

```powershell
Get-FileHash .\Secretary_0.1.0_x64-setup.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Git Bash では、同じフォルダで `sha256sum -c SHA256SUMS.txt` も使えます。

ビルド来歴は、GitHub がそのファイルをこのリポジトリの Actions でビルドしたことの証明です。ワークフローは `actions/attest-build-provenance` でインストーラ、ポータブル版、`SHA256SUMS.txt` を記録します。記録できたリリースは、GitHub CLI で確認します。

```powershell
gh attestation verify .\Secretary_0.1.0_x64-setup.exe --repo mongolyy/windows-secretary-app
gh attestation verify .\Secretary_0.1.0_x64-portable.zip --repo mongolyy/windows-secretary-app
```

`gh` は、このリポジトリを読めるアカウントでログインしている必要があります。来歴が「このリポジトリのワークフローでビルドされた」と出れば、手元のファイルと一致しています。

いまのリポジトリは個人アカウントの非公開リポジトリです。GitHub はこの種類のリポジトリに来歴を保存しないため、ワークフローは記録をスキップし、ログに「ビルド来歴の記録をスキップします」と出します。そのリリースの同一性は `SHA256SUMS.txt` で確認します。組織のリポジトリ、または公開リポジトリでは記録し、失敗したらリリースも失敗します。

自動アップデートはありません。新しい版は Releases から取ります。

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

設定の「Windowsにログインしたとき、トレイに起動する」をオンにすると、サインイン時にウィンドウを出さずトレイへ起動します。オフにすると、そのログイン項目を消します。登録先は今サインインしているユーザーだけで、管理者権限は要りません。

次の時刻付きの予定が始まる前に、デスクトップ通知を出します。初期値は 5 分前で、1 分から 180 分まで変えられます。オフにもできます。通知にはタイトル、開始時刻、場所を出します。参加リンクがあるときは、通知の「参加する」からブラウザで開けます。画面の「参加する」からも開けます。終日の予定は対象にしません。

同じ予定には一度だけ知らせます。CSV を同じ内容で書き直しても、もう一度は出しません。開始時刻を変えて書き出すと、新しい時刻で知らせます。知らせた記録は `%APPDATA%\secretary\notified.json` に残り、アプリを再起動しても同じ予定を繰り返しません。通知の判断も表示も、この PC の中だけで行います。

デスクトップ通知は、インストールしたアプリで出ます。`tauri dev` の途中では Windows が出さないことがあります。

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
node --test scripts/*.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm test` は CSV、Notion の日付（日本語・英語・終日・タイムゾーン）、列の自動判定、次の予定と残り時間、開始前の通知（同じ予定は一度、時刻が変わったら新しい時刻）です。Rust 側はパス、文字コード（UTF-8 BOM と UTF-16）、ファイルの読み分け、ログイン時の起動コマンド、通知の記録です。`npm run test:coverage` は同じ Vitest を、カバレッジ付きで実行します。

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
| フロントエンド | 6 箇所のバージョンが揃っていること、スクリプトのテスト、Prettier、ESLint、`tsc --noEmit`、Vitest のカバレッジ、`npm audit` |
| Rust | `cargo fmt --check`、`cargo clippy -D warnings`、`cargo audit`、`cargo llvm-cov`（単体テストをカバレッジ付きで実行） |
| Windows ビルド | `npm run tauri build`（NSIS）。ポータブル版の zip とチェックサムを作り、スモークチェックする。`main` への push では開発版を成果物 `secretary-dev-<sha>` に 3 日残す |

カバレッジは Actions のアーティファクトに 14 日残します。フロントエンドは `coverage-frontend`（HTML と lcov）、Rust は `coverage-rust`（lcov）です。しきい値では失敗させません。`main` への push では、同じ Windows ビルドからインストーラ、ポータブル版、チェックサムを `secretary-dev-<sha>` として 3 日残します。開発版であり、正式な Release ではありません。

`npm audit --audit-level=moderate` は指摘があれば失敗します。いまの lock では 0 件です。

`cargo audit` は脆弱性があれば失敗します。未メンテナンスや unsound の警告はログに残しますが、失敗にはしません。いまの lock では推移的依存に警告が 6 件あります（chrono、proc-macro-error、zbus 系、glib）。直す版がアプリから選べないか、Windows の実行では使わない Linux 側のクレートです。`--deny warnings` にすると毎回赤くなるので、警告はレポートだけにしています。

Dependabot（`.github/dependabot.yml`）は npm、Cargo（`src-tauri`）、GitHub Actions の更新を、月曜起点の週次でプルリクエストにします。

## コードスキャン（CodeQL）

CodeQL は、リポジトリ設定の default setup で動いています。解析用のワークフローファイルはリポジトリに無く、Actions の「CodeQL」（`dynamic/github-code-scanning/codeql`）が実行します。`.github/workflows/codeql.yml` は置いていません。default setup が入っているリポジトリに advanced setup のワークフローを足すと、結果のアップロードが衝突します。

対象は JavaScript/TypeScript、Rust、GitHub Actions です。いずれもソースをビルドせずに解析します。クエリスイートは default（精度の高い既定のクエリ）です。件数は増える代わりに誤検知も増えやすい extended にはしていません。

default branch への push、そのブランチ向けの pull request、週次のスケジュールで動きます。週次は、直近 180 日に push か pull request の解析があったときです。

結果は [Security の Code scanning](https://github.com/mongolyy/windows-secretary-app/security/code-scanning) で見ます。アラートが無いときは一覧が空です。あるときはルール名、深刻度、ファイルと行が出ます。閉じるまで残ります。ジョブが成功してもアラートは消えません。ジョブの成否は Actions の CodeQL の実行で見ます。アラートがあっても、その実行自体は失敗にしません。

## ビルド

Windows で NSIS インストーラを作ります。

```powershell
npm run tauri build
```

成果物は `src-tauri/target/release/bundle/nsis/` です。配布用は、次の手順で GitHub Release の下書きに付きます。`main` へ push するたびに、同じビルドの開発版が Actions の成果物 `secretary-dev-<コミット>` に 3 日残ります。正式なリリースではありません。

## リリースの切り方

通常は Actions の「バージョンを指定してリリースする」を使います。ブランチは `main` を選び、バージョンは `0.1.0` や `0.2.0-rc.1` のように SemVer で渡します。先頭の `v` は付けません。`v0.1.0` や `1.2` は、ワークフローがコミットする前に拒否します。

このワークフローは次を順に行います。

1. `node scripts/version.mjs validate` で形式を確認する。
2. 次の 6 箇所をそのバージョンに揃え、差分があれば `main` にコミットする。
3. タグ `v` + バージョンを打ち、`main` とタグを push する。
4. 同じ「リリース」ワークフローを直接呼ぶ。`windows-latest` で NSIS とポータブル版をビルドし、下書き Release に添付する。

`GITHUB_TOKEN` で push したタグは、他のワークフローの `push` を起動しません。そのため、タグの push を待たず、バージョンを上げたワークフローが `.github/workflows/release.yml` を再利用ワークフローとして呼びます。人がタグを push したときは、これまでどおりその `push` で「リリース」が動きます。

アプリのバージョンは、次の 6 箇所が同じ SemVer です。タグの `v` を除いた値と 1 つでも違えば、ビルドせずに失敗します。

- `package.json` の `version`
- `package-lock.json` の先頭と `packages[""]` の `version`
- `src-tauri/tauri.conf.json` の `version`
- `src-tauri/Cargo.toml` の `[package] version`
- `src-tauri/Cargo.lock` の `secretary` の `version`

手元で揃えるときは、リポジトリのルートで次を実行します。

```powershell
node scripts/version.mjs set 0.1.0
```

人がタグを打つときの手順です。`release.yml` が含まれるコミットにタグを打ちます。

```powershell
git switch main
git pull
git tag v0.1.0
git push origin v0.1.0
```

`-` を含むタグ（例: `v0.2.0-rc.1`）は、下書きかつプレリリースです。`v1` のように SemVer でないタグは失敗します。失敗したタグは消して、バージョンを揃えたコミットに打ち直します。

```powershell
git push origin :refs/tags/v0.1.0
git tag -d v0.1.0
```

`main` への push には、Actions の `GITHUB_TOKEN` がコミットとタグを作れる必要があります。ブランチ保護で拒否されるときは、GitHub Actions に `main` への push を許可してください。許可が無いと、バージョンのコミットの前で止まり、Release は作られません。

### 下書きに付くもの

- `Secretary_<バージョン>_x64-setup.exe`
- `Secretary_<バージョン>_x64-portable.zip`（中は `secretary.exe` だけ。WebView2 は同梱しない）
- `SHA256SUMS.txt`

ワークフローは、ファイルが揃っていること、サイズが想定の範囲であること、チェックサムがファイルと一致すること、下書きの添付サイズが手元と一致することを確認してから成功にします。ビルド来歴は `actions/attest-build-provenance` で付けます。個人アカウントの非公開リポジトリでは GitHub が保存を拒否するため、そのときはスキップしてログに理由を出します。組織のリポジトリか公開リポジトリで記録に失敗したときは、リリースも失敗します。確認コマンドは [ファイルの確認](#ファイルの確認) です。ポータブル版の前提は [ポータブル版](#ポータブル版) に書いてあります。

Release の説明には、前のタグからのプルリクエストを [.github/release.yml](.github/release.yml) の見出しで付けます。ラベル `enhancement` / `feature` は「新機能」、`bug` / `fix` は「不具合修正」、`dependencies` は「依存関係」、それ以外は「その他の変更」です。

下書きを開き、ファイルを確認してから「Publish release」で公開します。公開するまで、インストール手順のダウンロード対象にはなりません。自動アップデートはありません。

### コード署名

リポジトリの Actions Secrets に次の両方があるときだけ、ビルド中にインストーラと exe を署名します。タイムスタンプは `http://timestamp.digicert.com` です。

- `WINDOWS_CERTIFICATE`: コード署名証明書（`.pfx`）を base64 にした文字列
- `WINDOWS_CERTIFICATE_PASSWORD`: その pfx のパスワード

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx"))
```

pfx はリポジトリに置かず、Secret だけに入れます。両方空なら署名をスキップし、ログに「署名をスキップします。成果物は未署名です。」と出します。片方だけだと、未署名のファイルを出さずに失敗します。開発版の成果物は署名しません。

## データの流れ

1. 利用者が Notion の「エクスポート → CSV」でファイルを作る（ZIP なら展開する）。
2. アプリがその CSV を読み、変更を監視する。
3. 列名は自動判定するか、設定でタイトル・日時・終了・場所・URL を指定する。
4. 日付セルの `→` を期間として解釈する。ゾーンが無ければ日本時間。

アプリは予定ファイルを書き換えません。
