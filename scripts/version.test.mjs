import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./version.mjs", import.meta.url));

function fixture(version = "0.1.0") {
  return {
    "package.json": `{
  "name": "secretary",
  "private": true,
  "version": "${version}"
}
`,
    "package-lock.json": `{
  "name": "secretary",
  "version": "${version}",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "secretary",
      "version": "${version}",
      "dependencies": {
        "left-pad": "0.1.0"
      }
    },
    "node_modules/left-pad": {
      "version": "0.1.0"
    }
  }
}
`,
    "src-tauri/tauri.conf.json": `{
  "productName": "Secretary",
  "version": "${version}",
  "identifier": "app.secretary.desktop"
}
`,
    "src-tauri/Cargo.toml": `[package]
name = "secretary"
version = "${version}"
description = "テスト"

[dependencies]
serde = { version = "1", features = ["derive"] }
tauri = { version = "2", features = ["tray-icon"] }
`,
    "src-tauri/Cargo.lock": `[[package]]
name = "secretary"
version = "${version}"
dependencies = [
 "serde",
]

[[package]]
name = "vswhom"
version = "0.1.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"
`,
  };
}

function writeFixture(version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "secretary-version-"));
  const files = fixture(version);
  for (const [relativePath, text] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

function run(args, cwd, env = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.RELEASE_TAG;
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...baseEnv, ...env },
  });
}

test("6 箇所が同じバージョンなら check-consistent が通る", () => {
  const root = writeFixture();
  try {
    const result = run(["check-consistent"], root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0\.1\.0 で揃っています/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("タグ v0.1.0 は揃った 0.1.0 と一致する", () => {
  const root = writeFixture();
  try {
    const result = run(["check", "v0.1.0"], root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /タグ v0\.1\.0 とアプリのバージョン 0\.1\.0 は一致しています/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("タグとバージョンが違うときは失敗し、期待値を出す", () => {
  const root = writeFixture();
  try {
    const result = run(["check", "v0.2.0"], root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /一致しません/);
    assert.match(result.stderr, /package\.json: 0\.1\.0（期待: 0\.2\.0）/);
    assert.match(result.stderr, /src-tauri\/Cargo\.toml: 0\.1\.0（期待: 0\.2\.0）/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("1 箇所だけ違うと check-consistent が失敗する", () => {
  const root = writeFixture();
  try {
    const tauriPath = join(root, "src-tauri/tauri.conf.json");
    writeFileSync(tauriPath, readFileSync(tauriPath, "utf8").replace("0.1.0", "0.9.9"));
    const result = run(["check-consistent"], root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /揃っていません/);
    assert.match(result.stderr, /src-tauri\/tauri\.conf\.json: 0\.9\.9/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v の無いタグと、SemVer でないタグは拒否する", () => {
  const root = writeFixture();
  try {
    const missingV = run(["check", "0.1.0"], root);
    assert.equal(missingV.status, 1);
    assert.match(missingV.stderr, /v で始めてください/);

    const short = run(["check", "v1"], root);
    assert.equal(short.status, 1);
    assert.match(short.stderr, /SemVer ではありません/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check は引数が無いとき RELEASE_TAG を読む。引数の方が優先される", () => {
  const root = writeFixture();
  try {
    const fromEnv = run(["check"], root, { RELEASE_TAG: "v0.1.0" });
    assert.equal(fromEnv.status, 0, fromEnv.stderr);

    const wrongEnv = run(["check"], root, { RELEASE_TAG: "v9.9.9" });
    assert.equal(wrongEnv.status, 1);

    const argWins = run(["check", "v0.1.0"], root, { RELEASE_TAG: "v9.9.9" });
    assert.equal(argWins.status, 0, argWins.stderr);

    const missing = run(["check"], root);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /タグを指定してください/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("set は 6 箇所を書き換え、依存パッケージの version は残す", () => {
  const root = writeFixture();
  try {
    const result = run(["set", "0.2.0"], root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0\.2\.0 に揃えました/);

    const checked = run(["check", "v0.2.0"], root);
    assert.equal(checked.status, 0, checked.stderr);

    const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
    assert.match(cargo, /version = "0\.2\.0"/);
    assert.match(cargo, /serde = \{ version = "1"/);
    assert.match(cargo, /tauri = \{ version = "2"/);

    const cargoLock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
    assert.match(cargoLock, /name = "secretary"\nversion = "0\.2\.0"/);
    assert.match(cargoLock, /name = "vswhom"\nversion = "0\.1\.0"/);

    const packageLock = readFileSync(join(root, "package-lock.json"), "utf8");
    assert.match(packageLock, /"left-pad": "0\.1\.0"/);
    assert.match(packageLock, /node_modules\/left-pad": \{\n\s+"version": "0\.1\.0"/);
    const lock = JSON.parse(packageLock);
    assert.equal(lock.version, "0.2.0");
    assert.equal(lock.packages[""].version, "0.2.0");
    assert.equal(lock.packages["node_modules/left-pad"].version, "0.1.0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("プレリリースのバージョンをタグと揃えられる", () => {
  const root = writeFixture();
  try {
    const result = run(["set", "0.2.0-rc.1"], root);
    assert.equal(result.status, 0, result.stderr);
    const checked = run(["check", "v0.2.0-rc.1"], root);
    assert.equal(checked.status, 0, checked.stderr);
    const consistent = run(["check-consistent"], root);
    assert.equal(consistent.status, 0, consistent.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("不正な set はファイルを変えない", () => {
  const root = writeFixture();
  try {
    const before = readFileSync(join(root, "package.json"), "utf8");
    for (const version of ["v0.2.0", "01.2.3", "0.2", "0.2.0+build"]) {
      const result = run(["set", version], root);
      assert.equal(result.status, 1, version);
      assert.match(result.stderr, /SemVer ではありません/);
    }
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
    const still = run(["check", "v0.1.0"], root);
    assert.equal(still.status, 0, still.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("同じバージョンへの set は成功する", () => {
  const root = writeFixture();
  try {
    const result = run(["set", "0.1.0"], root);
    assert.equal(result.status, 0, result.stderr);
    const checked = run(["check-consistent"], root);
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("未知のコマンドと余分な引数は拒否する", () => {
  const root = writeFixture();
  try {
    const unknown = run(["help"], root);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /使い方/);

    const extra = run(["check-consistent", "0.1.0"], root);
    assert.equal(extra.status, 1);
    assert.match(extra.stderr, /引数は要りません/);

    const tooMany = run(["set", "0.2.0", "extra"], root);
    assert.equal(tooMany.status, 1);
    assert.match(tooMany.stderr, /引数が多すぎます/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
