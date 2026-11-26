#!/usr/bin/env node
// Electrobun がアプリを包む前に、Vite で画面を dist へ出す。
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["run", "build:web"], { stdio: "inherit" });
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
