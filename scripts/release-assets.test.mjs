import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL(".", import.meta.url));

function runNode(script, args) {
  return spawnSync(process.execPath, [join(scripts, script), ...args], { encoding: "utf8" });
}

function pythonCommand() {
  for (const command of ["python3", "python"]) {
    const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      return command;
    }
  }
  return null;
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "secretary-release-"));
}

function writeBytes(file, size, seed) {
  const data = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    data[index] = (seed + index) % 251;
  }
  writeFileSync(file, data);
}

test("チェックサムの書き出しと照合ができる", () => {
  const root = tempRoot();
  try {
    const first = join(root, "a.exe");
    const second = join(root, "b.zip");
    writeFileSync(first, "alpha");
    writeFileSync(second, "beta");
    const checksum = join(root, "SHA256SUMS.txt");
    const written = runNode("checksums.mjs", ["write", checksum, second, first]);
    assert.equal(written.status, 0, written.stderr);
    const text = readFileSync(checksum, "utf8");
    assert.match(text, /^[0-9a-f]{64} {2}a\.exe\n[0-9a-f]{64} {2}b\.zip\n$/);
    const verified = runNode("checksums.mjs", ["verify", checksum, root]);
    assert.equal(verified.status, 0, verified.stderr);

    writeFileSync(first, "changed");
    const broken = runNode("checksums.mjs", ["verify", checksum, root]);
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /一致しません/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("配布物を揃え、ポータブル版に exe があり、スモークが通る", () => {
  const root = tempRoot();
  try {
    const app = join(root, "app");
    mkdirSync(join(app, "bin"), { recursive: true });
    mkdirSync(join(app, "Resources"), { recursive: true });
    writeBytes(join(app, "bin", "Secretary.exe"), 5000, 3);
    writeBytes(join(app, "Resources", "marker.txt"), 20, 4);
    const setup = join(root, "win-x64-Secretary-Setup.zip");
    writeBytes(setup, 4000, 9);
    const out = join(root, "out");
    const collected = runNode("collect-release-assets.mjs", [
      "--setup",
      setup,
      "--app-dir",
      app,
      "--out",
      out,
      "--product",
      "Secretary",
      "--version",
      "0.1.0",
      "--tag",
      "v0.1.0",
      "--nope",
      "1",
    ]);
    assert.equal(collected.status, 1, collected.stdout);
    assert.match(collected.stderr, /不明な引数/);

    const again = runNode("collect-release-assets.mjs", [
      "--setup",
      setup,
      "--app-dir",
      app,
      "--out",
      out,
      "--product",
      "Secretary",
      "--version",
      "0.1.0",
      "--tag",
      "v0.1.0",
    ]);
    assert.equal(again.status, 0, again.stderr);

    const strict = runNode("release-smoke.mjs", [out]);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /範囲外/);

    const smoke = runNode("release-smoke.mjs", [out, "--min-setup", "1", "--min-portable", "1"]);
    assert.equal(smoke.status, 0, smoke.stderr);
    assert.match(smoke.stdout, /Secretary\.exe/);

    const python = pythonCommand();
    assert.ok(python, "python が必要です");
    const listed = spawnSync(
      python,
      [
        "-c",
        "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); bad = z.testzip(); print('' if bad is None else bad); print('\\n'.join(sorted(z.namelist()))); data = z.read('bin/Secretary.exe'); print(len(data))",
        join(out, "Secretary_0.1.0_x64-portable.zip"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /bin\/Secretary\.exe/);
    assert.match(listed.stdout, /5000/);

    const zipHash = createHash("sha256")
      .update(readFileSync(join(out, "Secretary_0.1.0_x64-portable.zip")))
      .digest("hex");
    const sums = readFileSync(join(out, "SHA256SUMS.txt"), "utf8");
    assert.match(sums, new RegExp(`${zipHash}  Secretary_0\\.1\\.0_x64-portable\\.zip`));
    assert.match(sums, /Secretary_0\.1\.0_x64-setup\.zip/);
    assert.doesNotMatch(sums, /SHA256SUMS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("開発版の名前と、タグ不一致、インストーラ名のずれを拒否する", () => {
  const root = tempRoot();
  try {
    const app = join(root, "app");
    mkdirSync(join(app, "bin"), { recursive: true });
    writeBytes(join(app, "bin", "Secretary.exe"), 32, 1);
    const setup = join(root, "win-x64-Secretary-Setup.zip");
    writeBytes(setup, 32, 2);
    const out = join(root, "out");
    const collected = runNode("collect-release-assets.mjs", [
      "--setup",
      setup,
      "--app-dir",
      app,
      "--out",
      out,
      "--product",
      "Secretary",
      "--version",
      "0.2.0-rc.1",
      "--channel",
      "dev",
      "--revision",
      "abc1234",
    ]);
    assert.equal(collected.status, 0, collected.stderr);
    assert.equal(
      readFileSync(join(out, "SHA256SUMS.txt"), "utf8").includes("Secretary_0.2.0-rc.1_x64-dev-abc1234-setup.zip"),
      true,
    );

    const mismatch = runNode("collect-release-assets.mjs", [
      "--setup",
      setup,
      "--app-dir",
      app,
      "--out",
      out,
      "--product",
      "Secretary",
      "--version",
      "0.2.0-rc.1",
      "--tag",
      "v0.2.0",
    ]);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /一致しません/);

    const missing = runNode("collect-release-assets.mjs", [
      "--setup",
      join(root, "missing-setup.zip"),
      "--app-dir",
      app,
      "--out",
      out,
      "--product",
      "Secretary",
      "--version",
      "9.9.9",
    ]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /インストーラがありません/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("下書き Release の添付サイズと digest を手元と照合する", () => {
  const root = tempRoot();
  try {
    const out = join(root, "out");
    mkdirSync(out);
    writeFileSync(join(out, "Secretary_0.1.0_x64-setup.zip"), "setup");
    writeFileSync(join(out, "Secretary_0.1.0_x64-portable.zip"), "zip");
    writeFileSync(join(out, "SHA256SUMS.txt"), "checksum\n");
    const digest = (name) =>
      createHash("sha256")
        .update(readFileSync(join(out, name)))
        .digest("hex");
    const release = {
      tagName: "v0.1.0",
      isDraft: true,
      isPrerelease: false,
      assets: ["Secretary_0.1.0_x64-setup.zip", "Secretary_0.1.0_x64-portable.zip", "SHA256SUMS.txt"].map((name) => ({
        name,
        size: readFileSync(join(out, name)).length,
        digest: `sha256:${digest(name)}`,
      })),
    };
    const json = join(root, "release.json");
    writeFileSync(json, JSON.stringify(release));
    const ok = runNode("release-remote-smoke.mjs", [json, out]);
    assert.equal(ok.status, 0, ok.stderr);

    release.isDraft = false;
    writeFileSync(json, JSON.stringify(release));
    const published = runNode("release-remote-smoke.mjs", [json, out]);
    assert.equal(published.status, 1);
    assert.match(published.stderr, /下書きではありません/);

    release.isDraft = true;
    release.assets[0].size = 1;
    writeFileSync(json, JSON.stringify(release));
    const size = runNode("release-remote-smoke.mjs", [json, out]);
    assert.equal(size.status, 1);
    assert.match(size.stderr, /サイズが違います/);

    release.tagName = "v0.2.0-rc.1";
    release.assets[0].size = readFileSync(join(out, release.assets[0].name)).length;
    writeFileSync(json, JSON.stringify(release));
    const pre = runNode("release-remote-smoke.mjs", [json, out]);
    assert.equal(pre.status, 1);
    assert.match(pre.stderr, /プレリリースである必要があります/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("リリース本文は署名の有無とタグを文面に入れる", () => {
  const root = tempRoot();
  try {
    const out = join(root, "body.md");
    const runBody = (extra) =>
      spawnSync(process.execPath, [join(scripts, "release-body.mjs")], {
        encoding: "utf8",
        env: {
          ...process.env,
          RELEASE_TAG: "v0.1.0",
          GITHUB_REPOSITORY: "mongolyy/windows-secretary-app",
          BODY_PATH: out,
          ...extra,
        },
      });
    const unsigned = runBody({ SIGN_ENABLED: "false", ATTEST_ENABLED: "false" });
    assert.equal(unsigned.status, 0, unsigned.stderr);
    const text = readFileSync(out, "utf8");
    assert.match(text, /署名をスキップしました/);
    assert.match(text, /来歴の記録はスキップしています/);
    assert.match(text, /Secretary_0\.1\.0_x64-setup\.zip/);
    assert.match(text, /bin\/launcher\.exe/);
    assert.doesNotMatch(text, /gh attestation verify/);

    const signed = runBody({ SIGN_ENABLED: "true", ATTEST_ENABLED: "true", RELEASE_TAG: "v0.2.0-rc.1" });
    assert.equal(signed.status, 0, signed.stderr);
    const signedText = readFileSync(out, "utf8");
    assert.match(signedText, /コード署名しています/);
    assert.match(signedText, /Secretary_0\.2\.0-rc\.1_x64-portable\.zip/);
    assert.match(
      signedText,
      /gh attestation verify \.\\Secretary_0\.2\.0-rc\.1_x64-setup\.zip --repo mongolyy\/windows-secretary-app/,
    );
    assert.doesNotMatch(signedText, /署名をスキップしました/);
    assert.doesNotMatch(signedText, /来歴の記録はスキップしています/);

    const bad = runBody({ RELEASE_TAG: "v1" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /形式が不正/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
