import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./supply-chain.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const HARDEN = "a".repeat(40);
const CHECKOUT = "b".repeat(40);
const FORK_SKIP =
  "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository";

function writeTree(root, files) {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

function baseFiles(workflow) {
  return {
    ".npmrc": "registry=https://registry.npmjs.org/\npackage-lock=true\nignore-scripts=true\n",
    "package.json": JSON.stringify({
      name: "fixture",
      version: "0.0.0",
      devDependencies: { electrobun: "2.0.6", "left-pad": "^1.0.0" },
    }),
    "hutch.config.ts": 'export default { electrobun: { version: "2.0.6" } };\n',
    "bun.lock": JSON.stringify({
      lockfileVersion: 1,
      packages: {
        "left-pad": ["left-pad@1.0.0", "", {}, "sha512-abc"],
        electrobun: ["electrobun@2.0.6", "", {}, "sha512-def"],
      },
    }),
    ".github/workflows/ci.yml": workflow,
  };
}

function ciWorkflow(steps) {
  return `name: CI
on:
  push:
  pull_request:

permissions: {}

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    if: ${FORK_SKIP}
    steps:
${steps}`;
}

const goodSteps = `      - name: ランナーの通信を監査する
        uses: step-security/harden-runner@${HARDEN} # v2.23.0
        with:
          egress-policy: audit
      - uses: actions/checkout@${CHECKOUT} # v4
        with:
          persist-credentials: false
`;

function run(root) {
  return spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
}

function withFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "secretary-supply-"));
  try {
    writeTree(root, files);
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("方針を満たすワークフローは成功する", () => {
  const result = withFixture(baseFiles(ciWorkflow(goodSteps)));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /確認しました/);
});

test("タグ参照の uses は失敗する", () => {
  const steps = goodSteps.replace(`actions/checkout@${CHECKOUT}`, "actions/checkout@v4");
  const result = withFixture(baseFiles(ciWorkflow(steps)));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /フル SHA/);
});

test("短い SHA は失敗する", () => {
  const steps = goodSteps.replace(CHECKOUT, "bbbbbbb");
  const result = withFixture(baseFiles(ciWorkflow(steps)));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /フル SHA/);
});

test("ローカルの再利用ワークフローは SHA 不要", () => {
  const workflow = `name: 呼び出し
on:
  workflow_dispatch:

permissions: {}

jobs:
  call:
    permissions:
      contents: read
    uses: ./.github/workflows/ci.yml
`;
  const result = withFixture({ ...baseFiles(ciWorkflow(goodSteps)), ".github/workflows/call.yml": workflow });
  assert.equal(result.status, 0, result.stderr);
});

test("persist-credentials が無い checkout は失敗する", () => {
  const steps = goodSteps.replace("          persist-credentials: false\n", "");
  const result = withFixture(baseFiles(ciWorkflow(steps)));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /persist-credentials: false/);
});

test("push するジョブだけ資格情報を残せる", () => {
  const release = `name: バージョンを指定してリリースする
on:
  workflow_dispatch:

permissions: {}

jobs:
  prepare:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: ランナーの通信を監査する
        uses: step-security/harden-runner@${HARDEN} # v2.23.0
        with:
          egress-policy: audit
      # main への push に資格情報を残す。
      - uses: actions/checkout@${CHECKOUT} # v4
        with:
          persist-credentials: true
`;
  const ok = withFixture({
    ...baseFiles(ciWorkflow(goodSteps)),
    ".github/workflows/release-dispatch.yml": release,
  });
  assert.equal(ok.status, 0, ok.stderr);

  const missingReason = release.replace(/.*資格情報を残す。\n/, "");
  const bad = withFixture({
    ...baseFiles(ciWorkflow(goodSteps)),
    ".github/workflows/release-dispatch.yml": missingReason,
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /資格情報を残す/);
});

test("ワークフロー既定の書き込み権限は失敗する", () => {
  const workflow = ciWorkflow(goodSteps).replace("permissions: {}", "permissions:\n  contents: write");
  const result = withFixture(baseFiles(workflow));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ワークフロー既定 permissions/);
});

test("pull_request_target は失敗する", () => {
  const workflow = ciWorkflow(goodSteps).replace("pull_request:", "pull_request_target:");
  const result = withFixture(baseFiles(workflow));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pull_request_target/);
});

test("pull_request のワークフローはシークレットを参照できない", () => {
  const steps = `${goodSteps}      - name: 秘密\n        run: echo "$TOKEN"\n        env:\n          TOKEN: \${{ secrets.TOKEN }}\n`;
  const result = withFixture(baseFiles(ciWorkflow(steps)));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /シークレット/);
});

test("フォークの pull_request ではキャッシュを保存しない", () => {
  const steps = `${goodSteps}      - uses: swatinem/rust-cache@${"d".repeat(40)} # v2\n        with:\n          workspaces: src-tauri -> target\n`;
  const bad = withFixture(baseFiles(ciWorkflow(steps)));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /フォークの pull_request/);

  const gated = ciWorkflow(
    `${goodSteps}      - uses: swatinem/rust-cache@${"d".repeat(40)} # v2\n        if: github.event_name != 'pull_request'\n        with:\n          workspaces: src-tauri -> target\n`,
  ).replace("    permissions:\n      contents: read", "    permissions:\n      contents: read\n      actions: write");
  const ok = withFixture(baseFiles(gated));
  assert.equal(ok.status, 0, ok.stderr);
});

test("同一リポジトリの PR を無条件に実行するジョブは失敗する", () => {
  const workflow = ciWorkflow(goodSteps).replace(`    if: ${FORK_SKIP}\n`, "");
  const result = withFixture(baseFiles(workflow));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /フォークの pull_request/);
});

test("依存差分のジョブは全 pull_request で動ける", () => {
  const workflow = `name: CI
on:
  pull_request:

permissions: {}

jobs:
  dependency-review:
    # supply-chain-allow: pull-request-always
    runs-on: ubuntu-latest
    permissions:
      contents: read
    if: github.event_name == 'pull_request'
    steps:
      - name: ランナーの通信を監査する
        uses: step-security/harden-runner@${HARDEN} # v2.23.0
        with:
          egress-policy: audit
      - uses: actions/checkout@${CHECKOUT} # v4
        with:
          persist-credentials: false
`;
  const result = withFixture(baseFiles(workflow));
  assert.equal(result.status, 0, result.stderr);
});

test("リリースのビルドはキャッシュを使わない", () => {
  const release = `name: リリース
on:
  push:

permissions: {}

jobs:
  release:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - name: ランナーの通信を監査する
        uses: step-security/harden-runner@${HARDEN} # v2.23.0
        with:
          egress-policy: audit
      - uses: actions/checkout@${CHECKOUT} # v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@${"e".repeat(40)} # v4
        with:
          node-version: "22"
          cache: npm
`;
  const result = withFixture({
    ...baseFiles(ciWorkflow(goodSteps)),
    ".github/workflows/release.yml": release,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /キャッシュ/);
});

test("registry.npmjs.org 以外の bun.lock は失敗する", () => {
  const files = baseFiles(ciWorkflow(goodSteps));
  const lock = JSON.parse(files["bun.lock"]);
  lock.packages["left-pad"][1] = "https://example.invalid/left-pad.tgz";
  files["bun.lock"] = JSON.stringify(lock);
  const npmResult = withFixture(files);
  assert.equal(npmResult.status, 1);
  assert.match(npmResult.stderr, /registry\.npmjs\.org/);

  const rustFiles = baseFiles(ciWorkflow(goodSteps));
  rustFiles["Cargo.toml"] = '[package]\nname = "fixture"\nversion = "0.0.0"\n';
  const rustResult = withFixture(rustFiles);
  assert.equal(rustResult.status, 1);
  assert.match(rustResult.stderr, /Rust のファイルが残っています/);
});

test("このリポジトリを検査する", () => {
  const result = run(repoRoot);
  assert.equal(result.status, 0, result.stderr);
});
