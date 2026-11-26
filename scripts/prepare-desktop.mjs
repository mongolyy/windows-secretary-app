#!/usr/bin/env node
// 型チェックと開発の前に、ピンした Hutch で Electrobun の devkit を用意する。
import { spawnSync } from "node:child_process";
import { delimiter, dirname } from "node:path";

import { ensureElectrobun } from "./ensure-electrobun.mjs";

const hutch = await ensureElectrobun();
const result = spawnSync(hutch, ["electrobun", "prepare"], {
  stdio: "inherit",
  env: { ...process.env, PATH: `${dirname(hutch)}${delimiter}${process.env.PATH ?? ""}` },
});
process.exit(result.status ?? 1);
