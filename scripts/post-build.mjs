#!/usr/bin/env node
// ラッパーに包む前の実行ファイルへ、証明書があるときだけ署名する。
import { spawnSync } from "node:child_process";

const directory = process.env.ELECTROBUN_BUILD_DIR;
if (!directory) process.exit(0);
const result = spawnSync(process.execPath, ["scripts/sign-if-configured.mjs", directory], { stdio: "inherit" });
process.exit(result.status ?? 1);
