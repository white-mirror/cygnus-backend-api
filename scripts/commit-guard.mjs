#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import semver from "semver";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");

const [, , messageFile] = process.argv;

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

function bumpVersion(releaseType) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const nextVersion = semver.inc(pkg.version, releaseType);

  if (!nextVersion) {
    console.error(
      `[versioning] Unable to bump version ${pkg.version} (${releaseType})`,
    );
    process.exit(1);
  }

  pkg.version = nextVersion;
  const serialized = `${JSON.stringify(pkg, null, 2)}\n`;
  writeFileSync(packageJsonPath, serialized, "utf8");

  const filesToStage = ["package.json"];

  if (existsSync(packageLockPath)) {
    try {
      const lock = JSON.parse(readFileSync(packageLockPath, "utf8"));
      lock.version = nextVersion;
      if (lock.packages && lock.packages[""]) {
        lock.packages[""].version = nextVersion;
      }
      writeFileSync(
        packageLockPath,
        `${JSON.stringify(lock, null, 2)}\n`,
        "utf8",
      );
      filesToStage.push("package-lock.json");
    } catch (error) {
      console.error("[versioning] Unable to update package-lock.json", error);
      process.exit(1);
    }
  }

  const addResult = spawnSync("git", ["add", ...filesToStage], {
    stdio: "inherit",
    cwd: projectRoot,
  });
  if (addResult.status !== 0) {
    console.error("[versioning] Failed to stage package.json");
    process.exit(addResult.status || 1);
  }
}

const message = readCommitMessage(messageFile);

if (!message) {
  process.exit(0);
}

if (message.toLowerCase().startsWith("wip:")) {
  process.exit(0);
}

if (isMergeCommit() || message.startsWith("Merge ")) {
  process.exit(0);
}

const releaseType = determineReleaseType(message);

["format", "lint", "typecheck", "build"].forEach((script) => runScript(script));

bumpVersion(releaseType);
