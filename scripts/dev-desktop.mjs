#!/usr/bin/env node
// 画面の開発サーバーと Electrobun を同時に起動する。配布ビルドでは使わない。
import { spawn, spawnSync } from "node:child_process";
import { delimiter, dirname } from "node:path";

import { ensureElectrobun } from "./ensure-electrobun.mjs";

const hutch = await ensureElectrobun();
const env = {
  ...process.env,
  PATH: `${dirname(hutch)}${delimiter}${process.env.PATH ?? ""}`,
  SECRETARY_DEV_SERVER: "http://127.0.0.1:1420",
};

const prepared = spawnSync(hutch, ["electrobun", "prepare"], { stdio: "inherit", env });
if (prepared.status !== 0) process.exit(prepared.status ?? 1);

const vite = spawn(process.execPath, ["run", "dev"], { stdio: "inherit", env });
const deadline = Date.now() + 30_000;
let ready = false;
while (Date.now() < deadline) {
  try {
    await fetch("http://127.0.0.1:1420");
    ready = true;
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
if (!ready) {
  vite.kill();
  console.error("開発サーバーが起動しませんでした。");
  process.exit(1);
}

const app = spawn(hutch, ["electrobun", "dev"], { stdio: "inherit", env });
const stop = () => {
  vite.kill();
  app.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
