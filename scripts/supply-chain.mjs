#!/usr/bin/env node
// ロックファイルと GitHub Actions の方針を検査する。
//
// 使い方（リポジトリのルートで）:
//   node scripts/supply-chain.mjs
//   node scripts/supply-chain.mjs --root <ディレクトリ>
//
// ワークフローは .github/workflows/*.yml と *.yaml を全部見る。
// ファイル名の一覧は持たない。後からワークフローが増えても、同じ SHA 固定、
// persist-credentials、permissions の検査が掛かる。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SHA = /^[0-9a-f]{40}$/;
const USES_REF = /^[\w.-]+(?:\/[\w.-]+){1,2}@[0-9a-f]{40}$/;
const FORK_SKIP =
  "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name != github.repository";
const PULL_REQUEST_ALWAYS = "supply-chain-allow: pull-request-always";
const NPM_REGISTRY = "https://registry.npmjs.org/";
const CARGO_SOURCES = new Set([
  "registry+https://github.com/rust-lang/crates.io-index",
  "sparse+https://index.crates.io/",
]);
const NO_CACHE_WORKFLOWS = new Set([".github/workflows/release.yml", ".github/workflows/release-dispatch.yml"]);
// リリースの prepare だけ git push する。それ以外の checkout は資格情報を残さない。
const PERSIST_ALLOWS = [
  {
    file: ".github/workflows/release-dispatch.yml",
    job: "prepare",
    comment: "資格情報を残す",
  },
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function posix(path) {
  return path.split(sep).join("/");
}

function indentOf(line) {
  const match = /^ */.exec(line);
  return match ? match[0].length : 0;
}

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function commentsAbove(lines, index) {
  const found = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("#")) {
      found.unshift(trimmed);
      continue;
    }
    break;
  }
  return found;
}

function readPermissions(lines, index) {
  const indent = indentOf(lines[index]);
  const stripped = stripInlineComment(lines[index]).trim();
  const value = stripped.slice(stripped.indexOf(":") + 1).trim();
  if (value === "{}") return { inline: "empty", entries: [] };
  if (value === "read-all" || value === "write-all") return { inline: value, entries: [] };
  if (value !== "") return { inline: value, entries: [] };

  const entries = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (indentOf(raw) <= indent) break;
    if (indentOf(raw) !== indent + 2) continue;
    const text = stripInlineComment(raw).trim();
    const colon = text.indexOf(":");
    if (colon === -1) continue;
    entries.push({ key: text.slice(0, colon).trim(), value: unquote(text.slice(colon + 1)) });
  }
  return { inline: null, entries };
}

function assignStep(step, key, value) {
  if (key === "uses") step.uses = unquote(value);
  else if (key === "if") step.if = unquote(value);
}

function parseSteps(lines, stepsLineIndex) {
  const itemIndent = indentOf(lines[stepsLineIndex]) + 2;
  const steps = [];
  let i = stepsLineIndex + 1;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    if (indentOf(raw) < itemIndent) break;
    if (!(indentOf(raw) === itemIndent && raw.trimStart().startsWith("- "))) {
      i += 1;
      continue;
    }

    const step = { line: i + 1, uses: "", if: "", with: {}, comments: commentsAbove(lines, i) };
    const head = stripInlineComment(raw).trim().slice(1).trim();
    const headColon = head.indexOf(":");
    if (headColon !== -1) assignStep(step, head.slice(0, headColon).trim(), head.slice(headColon + 1));

    i += 1;
    const propIndent = itemIndent + 2;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "" || line.trim().startsWith("#")) {
        i += 1;
        continue;
      }
      const ind = indentOf(line);
      if (ind < propIndent) break;
      if (ind > propIndent) {
        i += 1;
        continue;
      }
      const text = stripInlineComment(line).trim();
      const colon = text.indexOf(":");
      if (colon === -1) {
        i += 1;
        continue;
      }
      const key = text.slice(0, colon).trim();
      const value = text.slice(colon + 1).trim();
      if (value === "|" || value === ">" || value === "|-" || value === ">-" || value === "|+") {
        assignStep(step, key, "");
        i += 1;
        while (i < lines.length && (lines[i].trim() === "" || indentOf(lines[i]) > propIndent)) i += 1;
        continue;
      }
      assignStep(step, key, value);
      i += 1;
      if (key !== "with") continue;
      const withIndent = propIndent + 2;
      while (i < lines.length) {
        const withLine = lines[i];
        if (withLine.trim() === "" || withLine.trim().startsWith("#")) {
          i += 1;
          continue;
        }
        if (indentOf(withLine) < withIndent) break;
        if (indentOf(withLine) === withIndent) {
          const withText = stripInlineComment(withLine).trim();
          const withColon = withText.indexOf(":");
          if (withColon !== -1) {
            step.with[withText.slice(0, withColon).trim()] = unquote(withText.slice(withColon + 1));
          }
        }
        i += 1;
      }
    }
    steps.push(step);
  }
  return { steps, next: i };
}

function parseWorkflow(text) {
  const lines = text.split(/\r?\n/);
  const workflow = {
    lines,
    triggers: new Set(),
    permissions: null,
    jobs: [],
    secretsInherit: false,
  };

  let mode = "";
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const comment = raw.trim().startsWith("#") || raw.trim() === "";
    if (!comment) {
      const stripped = stripInlineComment(raw).trim();
      const indent = indentOf(raw);
      if (indent === 0 && stripped.startsWith("on:")) {
        const rest = stripped.slice(3).trim();
        mode = rest === "" ? "on" : "";
        if (rest.startsWith("[")) {
          for (const name of rest.slice(1, rest.indexOf("]")).split(",")) {
            const trigger = unquote(name.trim());
            if (trigger) workflow.triggers.add(trigger);
          }
        }
      } else if (indent === 0 && stripped.startsWith("permissions:")) {
        workflow.permissions = readPermissions(lines, i);
        mode = "";
      } else if (indent === 0 && stripped === "jobs:") {
        mode = "jobs";
      } else if (indent === 0) {
        mode = "";
      } else if (mode === "on" && indent === 2) {
        const name = stripped.split(":")[0].trim();
        if (name) workflow.triggers.add(name);
      } else if (
        mode === "jobs" &&
        indent === 2 &&
        /^[\w-]+$/.test(stripped.split(":")[0].trim()) &&
        stripped.endsWith(":")
      ) {
        const name = stripped.slice(0, -1).trim();
        const job = {
          name,
          line: i + 1,
          permissions: null,
          if: "",
          uses: "",
          steps: [],
          marker: false,
          text: "",
        };
        const start = i;
        i += 1;
        while (i < lines.length) {
          const jobLine = lines[i];
          if (jobLine.trim() !== "" && !jobLine.trim().startsWith("#") && indentOf(jobLine) <= 2) break;
          if (jobLine.includes(PULL_REQUEST_ALWAYS)) job.marker = true;
          if (!(jobLine.trim() === "" || jobLine.trim().startsWith("#")) && indentOf(jobLine) === 4) {
            const jobText = stripInlineComment(jobLine).trim();
            const colon = jobText.indexOf(":");
            if (colon !== -1) {
              const key = jobText.slice(0, colon).trim();
              const value = jobText.slice(colon + 1).trim();
              if (key === "if") job.if = unquote(value);
              else if (key === "uses") job.uses = unquote(value);
              else if (key === "permissions") job.permissions = readPermissions(lines, i);
              else if (key === "secrets" && unquote(value) === "inherit") workflow.secretsInherit = true;
              else if (key === "steps") {
                const parsed = parseSteps(lines, i);
                job.steps = parsed.steps;
                i = parsed.next;
                continue;
              }
            }
          }
          i += 1;
        }
        job.text = lines.slice(start, i).join("\n");
        workflow.jobs.push(job);
        continue;
      }
    }
    if (/secrets:\s*inherit\b/.test(stripInlineComment(raw))) workflow.secretsInherit = true;
    i += 1;
  }
  return workflow;
}

function permissionWrites(permissions) {
  if (!permissions) return { missing: true, writes: [], writeAll: false, readAll: false, empty: false };
  if (permissions.inline === "write-all")
    return { missing: false, writes: ["write-all"], writeAll: true, readAll: false, empty: false };
  if (permissions.inline === "read-all")
    return { missing: false, writes: [], writeAll: false, readAll: true, empty: false };
  if (permissions.inline === "empty")
    return { missing: false, writes: [], writeAll: false, readAll: false, empty: true };
  if (permissions.inline)
    return { missing: false, writes: [permissions.inline], writeAll: false, readAll: false, empty: false };
  const writes = permissions.entries.filter((entry) => entry.value === "write").map((entry) => entry.key);
  return { missing: false, writes, writeAll: false, readAll: false, empty: permissions.entries.length === 0 };
}

function isLocalUses(uses) {
  // ./ と、同一リポジトリを指す $/ の両方をローカル呼び出しとして扱う。
  return uses.startsWith("./") || uses.startsWith("$/");
}

function checkUses(uses, where, errors) {
  if (!uses) return;
  if (isLocalUses(uses)) return;
  if (uses.startsWith("docker://")) {
    errors.push(`${where} の docker 参照は sha256 ダイジェストで固定してください: ${uses}`);
    return;
  }
  if (!USES_REF.test(uses) || !SHA.test(uses.slice(uses.lastIndexOf("@") + 1))) {
    errors.push(`${where} の uses がフル SHA でありません: ${uses}`);
  }
}

function explicitNpmCache(step) {
  if (!Object.prototype.hasOwnProperty.call(step.with, "cache")) return false;
  const value = step.with.cache.trim();
  return value !== "" && value !== "false";
}

function usesCache(step) {
  const uses = step.uses;
  if (
    uses.startsWith("swatinem/rust-cache@") ||
    uses.startsWith("actions/cache@") ||
    uses.startsWith("actions/cache/")
  ) {
    return true;
  }
  // setup-node v7 は package-manager-cache の既定が true。false を書かないとキャッシュし得る。
  if (uses.startsWith("actions/setup-node@")) {
    if (explicitNpmCache(step)) return true;
    return step.with["package-manager-cache"] !== "false";
  }
  return false;
}

function isUpload(step) {
  return step.uses.startsWith("actions/upload-artifact@") || step.uses.startsWith("github/codeql-action/upload-sarif@");
}

function skipsPullRequest(ifExpr) {
  if (!ifExpr) return false;
  if (
    ifExpr.includes("github.event_name != 'pull_request'") ||
    ifExpr.includes('github.event_name != "pull_request"')
  ) {
    return true;
  }
  return /github\.event_name\s*==\s*['"]push['"]/.test(ifExpr) && !ifExpr.includes("pull_request");
}

function checkNpmrc(root, errors) {
  const path = join(root, ".npmrc");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    errors.push(`.npmrc を読めません: ${error.message}`);
    return;
  }
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = stripInlineComment(line).trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  if (values.get("registry") !== "https://registry.npmjs.org/") {
    errors.push(".npmrc の registry は https://registry.npmjs.org/ にしてください。");
  }
  if (values.get("package-lock") !== "true") {
    errors.push(".npmrc の package-lock は true にしてください。");
  }
  if (values.get("ignore-scripts") !== "true") {
    errors.push(".npmrc の ignore-scripts は true にしてください。");
  }
}

function checkPackageJson(root, errors) {
  const path = join(root, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`package.json を読めません: ${error.message}`);
    return;
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (typeof spec !== "string") continue;
      if (/^(git\+|git:|github:|file:|link:|http:|https:|npm:)/.test(spec)) {
        errors.push(`package.json の ${field}.${name} が公式レジストリ以外を指しています: ${spec}`);
      }
    }
  }
}

function checkPackageLock(root, errors) {
  const path = join(root, "package-lock.json");
  let lock;
  try {
    lock = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`package-lock.json を読めません: ${error.message}`);
    return;
  }
  if (lock.lockfileVersion !== 3) {
    errors.push(`package-lock.json の lockfileVersion が 3 ではありません: ${lock.lockfileVersion}`);
  }
  const packages = lock.packages ?? {};
  let resolvedCount = 0;
  for (const [name, meta] of Object.entries(packages)) {
    if (!meta || typeof meta.resolved !== "string") continue;
    resolvedCount += 1;
    if (!meta.resolved.startsWith(NPM_REGISTRY)) {
      errors.push(`package-lock.json の ${name || "(root)"} が registry.npmjs.org 以外です: ${meta.resolved}`);
    }
  }
  if (resolvedCount === 0) errors.push("package-lock.json に resolved がありません。");
}

function checkCargo(root, errors) {
  const tomlPath = join(root, "src-tauri", "Cargo.toml");
  const lockPath = join(root, "src-tauri", "Cargo.lock");
  let toml;
  let lock;
  try {
    toml = readFileSync(tomlPath, "utf8");
  } catch (error) {
    errors.push(`src-tauri/Cargo.toml を読めません: ${error.message}`);
    toml = "";
  }
  try {
    lock = readFileSync(lockPath, "utf8");
  } catch (error) {
    errors.push(`src-tauri/Cargo.lock を読めません: ${error.message}`);
    return;
  }
  for (const line of toml.split(/\r?\n/)) {
    const stripped = stripInlineComment(line).trim();
    if (/^git\s*=/.test(stripped)) errors.push(`src-tauri/Cargo.toml に git 依存があります: ${stripped}`);
  }
  const sources = [...lock.matchAll(/^source = "([^"]+)"/gm)].map((match) => match[1]);
  if (sources.length === 0) errors.push("src-tauri/Cargo.lock に source がありません。");
  for (const source of sources) {
    if (!CARGO_SOURCES.has(source)) {
      errors.push(`src-tauri/Cargo.lock の source が crates.io 以外です: ${source}`);
    }
  }
}

function checkWorkflowFile(root, file, errors) {
  const relPath = posix(relative(root, file));
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    errors.push(`${relPath} を読めません: ${error.message}`);
    return;
  }
  const workflow = parseWorkflow(text);
  const where = relPath;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    if (/\bpull_request_target\b/.test(stripInlineComment(line))) {
      errors.push(
        `${where} に pull_request_target があります。フォークのコードに書き込み権限を渡さないため、使いません。`,
      );
    }
  }
  if (workflow.secretsInherit) {
    errors.push(`${where} の secrets: inherit は、必要なシークレットだけを明示してください。`);
  }

  const workflowPerms = permissionWrites(workflow.permissions);
  if (workflowPerms.missing)
    errors.push(`${where} のワークフロー既定 permissions がありません。{} か読み取り専用にしてください。`);
  if (workflowPerms.writeAll || workflowPerms.writes.length > 0) {
    errors.push(
      `${where} のワークフロー既定 permissions に書き込みがあります（${workflowPerms.writes.join(", ")}）。ジョブ単位で付けてください。`,
    );
  }

  const runsOnPullRequest = workflow.triggers.has("pull_request");
  if (runsOnPullRequest) {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim().startsWith("#")) continue;
      if (/\bsecrets\b/.test(stripInlineComment(line))) {
        errors.push(`${where} は pull_request で動きます。シークレットを参照できません。`);
        break;
      }
    }
  }

  for (const job of workflow.jobs) {
    const jobWhere = `${where} のジョブ ${job.name}`;
    checkUses(job.uses, `${jobWhere}:${job.line}`, errors);
    const jobPerms = permissionWrites(job.permissions);
    if (jobPerms.missing) errors.push(`${jobWhere} の permissions がありません。`);
    if (jobPerms.writeAll) errors.push(`${jobWhere} の permissions が write-all です。必要な範囲だけにしてください。`);

    // FORK_SKIP は「同一リポジトリの PR はスキップ、フォークの PR は実行」。
    // 条件の前半だけを見ると pull_request を除外しているように見えるので、ジョブ単位では式全体で判断する。
    const forkJob = runsOnPullRequest && (job.marker || job.if.includes(FORK_SKIP));
    if (runsOnPullRequest && !job.marker && !job.if.includes(FORK_SKIP)) {
      errors.push(
        `${jobWhere} は、同一リポジトリの pull_request をスキップしフォークの pull_request は実行する条件がありません。`,
      );
    }
    if (job.marker) {
      if (job.if !== "github.event_name == 'pull_request'") {
        errors.push(`${jobWhere} は pull_request だけで動く印がありますが、if がそれ以外です: ${job.if}`);
      }
      if (job.if.includes(FORK_SKIP)) {
        errors.push(
          `${jobWhere} は依存差分のように全 pull_request で動くジョブです。同一リポジトリの PR をスキップしません。`,
        );
      }
    }
    if (forkJob) {
      for (const key of jobPerms.writes) {
        if (key !== "actions") {
          errors.push(`${jobWhere} はフォークの pull_request でも動きます。${key}: write は渡せません。`);
        }
      }
    }

    if (job.steps.length > 0) {
      const first = job.steps[0];
      if (!first.uses.startsWith("step-security/harden-runner@")) {
        errors.push(`${jobWhere} の最初のステップが step-security/harden-runner ではありません。`);
      } else if (first.with["egress-policy"] !== "audit") {
        errors.push(`${jobWhere} の harden-runner は egress-policy: audit から始めてください。`);
      }
    }

    for (const step of job.steps) {
      const stepWhere = `${jobWhere}:${step.line}`;
      checkUses(step.uses, stepWhere, errors);
      if (step.uses.startsWith("actions/checkout@")) {
        const persist = step.with["persist-credentials"];
        const allowed = PERSIST_ALLOWS.find((entry) => entry.file === relPath && entry.job === job.name);
        if (allowed && persist === "true") {
          const comments = step.comments.join("\n");
          if (!comments.includes(allowed.comment)) {
            errors.push(
              `${stepWhere} は資格情報を残す例外です。直前のコメントに「${allowed.comment}」と理由を書いてください。`,
            );
          }
        } else if (persist !== "false") {
          errors.push(`${stepWhere} の actions/checkout は persist-credentials: false が必要です。`);
        }
      }
      const cached = usesCache(step);
      const upload = isUpload(step);
      if (NO_CACHE_WORKFLOWS.has(relPath) && (cached || upload)) {
        errors.push(`${stepWhere} はリリースのワークフローです。キャッシュも、ビルド以外のアップロードも使いません。`);
      }
      if (forkJob && (cached || (upload && jobPerms.writes.includes("actions")))) {
        if (!skipsPullRequest(step.if)) {
          errors.push(`${stepWhere} はフォークの pull_request では実行しない if が必要です。`);
        }
      }
      if (forkJob && upload && !skipsPullRequest(step.if)) {
        errors.push(`${stepWhere} の成果物アップロードは pull_request では実行しません。`);
      }
    }
  }
}

function listWorkflows(root) {
  const dir = join(root, ".github", "workflows");
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    return { error: `.github/workflows を読めません: ${error.message}`, files: [] };
  }
  const files = names
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(dir, name))
    .filter((file) => statSync(file).isFile())
    .sort();
  return { error: "", files };
}

function checkRoot(root) {
  const errors = [];
  checkNpmrc(root, errors);
  checkPackageJson(root, errors);
  checkPackageLock(root, errors);
  checkCargo(root, errors);
  const workflows = listWorkflows(root);
  if (workflows.error) errors.push(workflows.error);
  if (!workflows.error && workflows.files.length === 0) errors.push(".github/workflows にワークフローがありません。");
  for (const file of workflows.files) checkWorkflowFile(root, file, errors);
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--root") {
      root = args[i + 1];
      if (!root) fail("使い方: node scripts/supply-chain.mjs [--root ディレクトリ]");
      i += 1;
      continue;
    }
    fail("使い方: node scripts/supply-chain.mjs [--root ディレクトリ]");
  }
  const errors = checkRoot(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
  console.log("ロックファイル、レジストリ、ワークフローの方針を確認しました。");
}

if (process.argv[1] && process.argv[1].endsWith("supply-chain.mjs")) main();
