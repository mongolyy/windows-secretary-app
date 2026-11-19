import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./sign-config.mjs", import.meta.url));

test("署名設定はパスワードを含まず、%1 を引数として渡す", () => {
  const root = mkdtempSync(join(tmpdir(), "secretary-sign-"));
  try {
    const scriptPath = join(root, "sign-windows.ps1");
    const outPath = join(root, "tauri.sign.json");
    const result = spawnSync(process.execPath, [script, scriptPath, outPath], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(readFileSync(outPath, "utf8"));
    const command = config.bundle.windows.signCommand;
    assert.equal(command.cmd, "powershell.exe");
    assert.deepEqual(command.args.slice(-2), [scriptPath, "%1"]);
    assert.equal(JSON.stringify(config).includes("PASSWORD"), false);
    assert.equal(command.args.includes("%1"), true);

    const missing = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /使い方/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
