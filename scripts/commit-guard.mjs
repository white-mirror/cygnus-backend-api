#!/usr/bin/env node
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const gitDir = resolveGitDir();
const metadataPath = path.join(gitDir, "cygnus-commit.json");

const [, , messageFile] = process.argv;

function resolveGitDir() {
  const gitPath = path.join(projectRoot, ".git");
  const stats = statSync(gitPath);
  if (stats.isFile()) {
    const content = readFileSync(gitPath, "utf8").trim();
    const match = content.match(/gitdir:\s*(.*)/i);
    if (!match) {
      throw new Error(`Unable to resolve gitdir from ${gitPath}`);
    }
    return path.resolve(projectRoot, match[1].trim());
  }
  return gitPath;
}

function readCommitMessage(file) {
  return readFileSync(file, "utf8").trim();
}

function isMergeCommit() {
  const result = spawnSync(
    "git",
    ["rev-parse", "-q", "--verify", "MERGE_HEAD"],
    {
      stdio: "ignore",
    },
  );
  return result.status === 0;
}

function determineReleaseType(message) {
  const breakingFooter = /\bBREAKING[\s-]CHANGES?\b/i.test(message);
  const conventional = /^(?<type>[\w-]+)(?<breaking>!)?(?:\([^)]*\))?:/.exec(
    message,
  );
  const type = conventional?.groups?.type;
  const isBreaking = breakingFooter || Boolean(conventional?.groups?.breaking);

  if (isBreaking) {
    return "major";
  }

  if (type === "feat") {
    return "minor";
  }

  if (!type) {
    return "patch";
  }

  if (
    [
      "fix",
      "perf",
      "refactor",
      "chore",
      "ci",
      "build",
      "docs",
      "style",
      "test",
    ].includes(type)
  ) {
    return "patch";
  }

  return "patch";
}

function runScript(scriptName) {
  const result = spawnSync("npm", ["run", scriptName], {
    stdio: "inherit",
    cwd: projectRoot,
    env: process.env,
  });

  if (result.status !== 0) {
    console.error(
      `[versioning] Script "${scriptName}" failed with code ${result.status}`,
    );
    process.exit(result.status || 1);
  }
}

function persistMetadata(payload) {
  writeFileSync(metadataPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function clearMetadata() {
  if (existsSync(metadataPath)) {
    rmSync(metadataPath);
  }
}

if (process.env.CYGNUS_SKIP_VERSIONING === "1") {
  process.exit(0);
}

const message = readCommitMessage(messageFile);

if (!message) {
  clearMetadata();
  process.exit(0);
}

if (message.toLowerCase().startsWith("wip:")) {
  clearMetadata();
  process.exit(0);
}

if (isMergeCommit() || message.startsWith("Merge ")) {
  clearMetadata();
  process.exit(0);
}

const releaseType = determineReleaseType(message);

["format", "lint", "typecheck", "build:app"].forEach((script) =>
  runScript(script),
);

persistMetadata({ releaseType });
