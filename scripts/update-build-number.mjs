#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "build-number-generator";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const packageJsonPath = path.join(projectRoot, "package.json");

try {
  const buildNumber = generate();
  const raw = await readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.buildNumber = buildNumber;
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`[versioning] Build number set to ${buildNumber}`);
} catch (error) {
  console.error("[versioning] Unable to update build number", error);
  process.exit(1);
}
