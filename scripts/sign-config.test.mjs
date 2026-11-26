import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./sign-if-configured.mjs", import.meta.url));

function run(env) {
  const base = { ...process.env };
  delete base.WINDOWS_PFX;
  delete base.WINDOWS_CERTIFICATE_PASSWORD;
  return spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...base, ...env } });
}

test("証明書が無ければ署名をスキップする", () => {
  const result = run({});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /署名をスキップします/);
});

test("証明書が片方だけなら失敗する", () => {
  assert.equal(run({ WINDOWS_PFX: join(tmpdir(), "certificate.pfx") }).status, 1);
  assert.match(run({ WINDOWS_CERTIFICATE_PASSWORD: "secret" }).stderr, /片方だけ/);
});

test("使い方を誤ると失敗する", () => {
  const root = mkdtempSync(join(tmpdir(), "secretary-sign-"));
  try {
    const result = spawnSync(process.execPath, [script, root, "extra"], {
      encoding: "utf8",
      env: { ...process.env, WINDOWS_PFX: join(root, "certificate.pfx"), WINDOWS_CERTIFICATE_PASSWORD: "secret" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /使い方|Windows/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
