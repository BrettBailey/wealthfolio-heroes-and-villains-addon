#!/usr/bin/env node
// Publish pipeline for the addon zip: format -> lint (eslint + tsc) -> test -> build -> repackage.
// Each step only runs if the previous one succeeded; the zip is only replaced once everything passes.
//
// Usage (prefer the npm scripts — npm swallows bare `--flags` after `--`):
//   npm run publish-addon    full pipeline, produces the installable zip
//   npm run check            format + lint + test, no zip
//   npm run check:test       tests only     (skips the formatter, which rewrites files)
//   npm run check:lint       eslint + tsc   (likewise)
//
// Output is deliberately terse — one line per step — so it never needs piping
// through Select-String/head to be readable. Each step's full output is shown
// only when it fails, which is the only time it is worth reading.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { writeZip } from "./writeZip.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const zipPath = path.join(rootDir, "heroes-villains-addon.zip");

const flags = new Set(process.argv.slice(2));
const testOnly = flags.has("--test");
const lintOnly = flags.has("--lint");
const checkOnly = flags.has("--check");

// A bare run does everything. `--test`/`--lint` narrow to a single step for fast
// iteration (and deliberately skip the formatter, which rewrites files); `--check`
// runs every gate but stops short of producing a zip.
const runFormat = !testOnly && !lintOnly;
const runLint = !testOnly;
const runTests = !lintOnly;
const runBuildAndZip = !testOnly && !lintOnly && !checkOnly;

/**
 * Runs a step, capturing its output so a passing step stays quiet. On failure
 * the captured output is replayed in full and the pipeline stops — a broken
 * step must never reach the build or leave a stale zip behind.
 *
 * @param summarise picks a short detail out of the step's output for the ✓ line
 */
function runStep(label, command, args, summarise) {
  process.stdout.write(`  ${label.padEnd(8)} `);

  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    shell: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  if (result.status !== 0) {
    console.log("✗");
    console.error(`\n${output.trim()}\n`);
    console.error(`✗ ${label} failed — stopping.`);
    process.exit(result.status ?? 1);
  }

  const detail = summarise?.(output) ?? "";
  console.log(`✓ ${detail}`);
}

function countChangedFiles(output) {
  // Prettier lists only the files it rewrote once --log-level warn is set.
  const changed = output.split("\n").filter((line) => line.trim().length > 0).length;
  return changed === 0 ? "" : `(${changed} reformatted)`;
}

function summariseTests(output) {
  // Vitest reports e.g. "Tests  82 passed (82)" — take just the leading count.
  const match = stripAnsi(output).match(/Tests\s+(\d+\s+\w+)/);
  return match ? `(${match[1]})` : "";
}

function summariseBuild(output) {
  // Vite colourises its output, so strip ANSI escapes before matching.
  const plain = stripAnsi(output);
  const match = plain.match(/addon\.js\s+([\d.]+\s*kB)/);
  return match ? `(${match[1]})` : "";
}

// eslint-disable-next-line no-control-regex -- matching ANSI escape sequences requires them
const ANSI_PATTERN = /\[[0-9;]*m/g;

function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, "");
}

console.log("");

if (runFormat) {
  runStep("Format", "npx", ["prettier", "--write", "--log-level", "warn", "."], countChangedFiles);
}
if (runLint) {
  runStep("Lint", "npm", ["run", "lint"]);
}
if (runTests) {
  runStep("Test", "npm", ["test"], summariseTests);
}

if (!runBuildAndZip) {
  console.log("\nChecks complete (zip not rebuilt).");
  process.exit(0);
}

runStep("Build", "npm", ["run", "build"], summariseBuild);

process.stdout.write(`  ${"Zip".padEnd(8)} `);
if (existsSync(zipPath)) {
  rmSync(zipPath);
}
writeZip(zipPath, [
  { entryName: "manifest.json", sourcePath: path.join(rootDir, "manifest.json") },
  { entryName: "dist/addon.js", sourcePath: path.join(rootDir, "dist", "addon.js") },
]);
console.log(`✓ ${path.relative(rootDir, zipPath)}`);

console.log("\nPublish complete — ready to install.");
