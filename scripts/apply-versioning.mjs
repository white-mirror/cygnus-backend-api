#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import semver from "semver";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const packageLockPath = path.join(projectRoot, "package-lock.json");
const gitDir = resolveGitDir();
const metadataPath = path.join(gitDir, "cygnus-commit.json");
const originalPackage = existsSync(packageJsonPath)
  ? readFileSync(packageJsonPath, "utf8")
  : null;
const originalLock = existsSync(packageLockPath)
  ? readFileSync(packageLockPath, "utf8")
  : null;

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

function bumpVersion(releaseType) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const nextVersion = semver.inc(pkg.version, releaseType);

  if (!nextVersion) {
    throw new Error(
      `[versioning] Unable to bump version ${pkg.version} (${releaseType})`,
    );
  }

  pkg.version = nextVersion;
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  if (existsSync(packageLockPath)) {
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
  }
}

function stageFiles(files) {
  const existing = files.filter((file) =>
    existsSync(path.join(projectRoot, file)),
  );
  if (existing.length === 0) {
    return;
  }
  const result = spawnSync("git", ["add", ...existing], {
    stdio: "inherit",
    cwd: projectRoot,
  });
  if (result.status !== 0) {
    throw new Error("[versioning] Unable to stage version files");
  }
}

function runScript(scriptName, env = process.env) {
  const result = spawnSync("npm", ["run", scriptName], {
    stdio: "inherit",
    cwd: projectRoot,
    env,
  });
  if (result.status !== 0) {
    throw new Error(`[versioning] Script "${scriptName}" failed`);
  }
}

function cleanMetadata() {
  if (existsSync(metadataPath)) {
    rmSync(metadataPath);
  }
}

if (process.env.CYGNUS_SKIP_VERSIONING === "1") {
  process.exit(0);
}

if (!existsSync(metadataPath)) {
  process.exit(0);
}

try {
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (!metadata.releaseType) {
    cleanMetadata();
    process.exit(0);
  }

  bumpVersion(metadata.releaseType);
  stageFiles(["package.json", "package-lock.json"]);

  runScript("build", {
    ...process.env,
    CYGNUS_SKIP_VERSIONING: "1",
  });

  stageFiles(["package.json", "package-lock.json"]);

  const amendResult = spawnSync("git", ["commit", "--amend", "--no-edit"], {
    stdio: "inherit",
    cwd: projectRoot,
    env: {
      ...process.env,
      CYGNUS_SKIP_VERSIONING: "1",
    },
  });

  if (amendResult.status !== 0) {
    throw new Error("[versioning] Unable to amend commit with new version");
  }
} catch (error) {
  console.error(error.message ?? error);
  if (originalPackage !== null) {
    writeFileSync(packageJsonPath, originalPackage, "utf8");
  }
  if (originalLock !== null) {
    writeFileSync(packageLockPath, originalLock, "utf8");
  }
  cleanMetadata();
  process.exit(1);
}

cleanMetadata();
