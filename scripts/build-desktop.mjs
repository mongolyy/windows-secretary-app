#!/usr/bin/env node
// 画面を Vite で作り、Electrobun の安定版ビルドで Windows 向け配布物を出す。
import { spawnSync } from "node:child_process";
import { delimiter, dirname } from "node:path";

import { ensureElectrobun } from "./ensure-electrobun.mjs";

const hutch = await ensureElectrobun();
const env = {
  ...process.env,
  PATH: `${dirname(hutch)}${delimiter}${process.env.PATH ?? ""}`,
};

function run(args) {
  const result = spawnSync(hutch, args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["electrobun", "prepare"]);
run(["electrobun", "build", "--env=stable"]);
