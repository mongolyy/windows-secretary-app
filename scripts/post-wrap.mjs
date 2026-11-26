#!/usr/bin/env node
// セットアップ用のラッパーが出来たあと、証明書があるときだけ署名する。
import { spawnSync } from "node:child_process";

const target = process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH;
if (!target) process.exit(0);
const result = spawnSync(process.execPath, ["scripts/sign-if-configured.mjs", target], { stdio: "inherit" });
process.exit(result.status ?? 1);
