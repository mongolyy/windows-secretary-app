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
  "version": "${version}",
  "devDependencies": {
    "electrobun": "2.0.6"
  }
}
`,
    "electrobun.config.ts": `export default {
  app: {
    name: "Secretary",
    version: "${version}", // secretary-app-version
  },
};
`,
  };
}

function writeFixture(version = "0.1.0") {
  const root = mkdtempSync(join(tmpdir(), "secretary-version-"));
  for (const [relativePath, text] of Object.entries(fixture(version))) {
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

test("2 箇所が同じバージョンなら check-consistent が通る", () => {
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("タグとバージョンが違うときは失敗し、期待値を出す", () => {
  const root = writeFixture();
  try {
    const result = run(["check", "v0.2.0"], root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /package\.json: 0\.1\.0（期待: 0\.2\.0）/);
    assert.match(result.stderr, /electrobun\.config\.ts: 0\.1\.0（期待: 0\.2\.0）/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("1 箇所だけ違うと check-consistent が失敗する", () => {
  const root = writeFixture();
  try {
    const configPath = join(root, "electrobun.config.ts");
    writeFileSync(configPath, readFileSync(configPath, "utf8").replace("0.1.0", "0.9.9"));
    const result = run(["check-consistent"], root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /electrobun\.config\.ts: 0\.9\.9/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v の無いタグと、SemVer でないタグは拒否する", () => {
  const root = writeFixture();
  try {
    assert.equal(run(["check", "0.1.0"], root).status, 1);
    assert.match(run(["check", "v1"], root).stderr, /SemVer ではありません/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check は引数が無いとき RELEASE_TAG を読む。引数の方が優先される", () => {
  const root = writeFixture();
  try {
    assert.equal(run(["check"], root, { RELEASE_TAG: "v0.1.0" }).status, 0);
    assert.equal(run(["check"], root, { RELEASE_TAG: "v9.9.9" }).status, 1);
    assert.equal(run(["check", "v0.1.0"], root, { RELEASE_TAG: "v9.9.9" }).status, 0);
    assert.match(run(["check"], root).stderr, /タグを指定してください/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("set は 2 箇所を書き換え、Electrobun のピンは残す", () => {
  const root = writeFixture();
  try {
    assert.equal(run(["set", "0.2.0"], root).status, 0);
    assert.equal(run(["check", "v0.2.0"], root).status, 0);
    const pkg = readFileSync(join(root, "package.json"), "utf8");
    assert.match(pkg, /"version": "0\.2\.0"/);
    assert.match(pkg, /"electrobun": "2\.0\.6"/);
    assert.match(
      readFileSync(join(root, "electrobun.config.ts"), "utf8"),
      /version: "0\.2\.0", \/\/ secretary-app-version/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("プレリリースのバージョンをタグと揃えられる", () => {
  const root = writeFixture();
  try {
    assert.equal(run(["set", "0.2.0-rc.1"], root).status, 0);
    assert.equal(run(["check", "v0.2.0-rc.1"], root).status, 0);
    assert.equal(run(["check-consistent"], root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("不正な set はファイルを変えない", () => {
  const root = writeFixture();
  try {
    const before = readFileSync(join(root, "package.json"), "utf8");
    for (const version of ["v0.2.0", "01.2.3", "0.2", "0.2.0+build"]) {
      assert.equal(run(["set", version], root).status, 1);
    }
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
    assert.equal(run(["check", "v0.1.0"], root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("同じバージョンへの set は成功する", () => {
  const root = writeFixture();
  try {
    assert.equal(run(["set", "0.1.0"], root).status, 0);
    assert.equal(run(["check-consistent"], root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validate は SemVer だけを受け、ファイルは変えない", () => {
  const root = writeFixture();
  try {
    const before = readFileSync(join(root, "package.json"), "utf8");
    for (const version of ["0.1.0", "0.2.0-rc.1", "0.0.0-test.1"]) {
      const result = run(["validate", version], root);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(run(["validate", "v0.1.0"], root).status, 1);
    assert.equal(run(["validate"], root).status, 1);
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("未知のコマンドと余分な引数は拒否する", () => {
  const root = writeFixture();
  try {
    assert.match(run(["help"], root).stderr, /使い方/);
    assert.match(run(["check-consistent", "0.1.0"], root).stderr, /引数は要りません/);
    assert.match(run(["set", "0.2.0", "extra"], root).stderr, /引数が多すぎます/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
