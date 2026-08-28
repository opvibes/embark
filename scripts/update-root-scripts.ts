import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readEmbarkConfig, hasCompleteEmbarkConfig } from "./embark-config";
import { gitEnv } from "./git-env";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

const PACKAGE_SCRIPT_PATTERN = /^bun run --filter @embark\/.+ dev$/;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function buildPackageScripts(
  packagesDir = PACKAGES_DIR,
): Promise<Record<string, string>> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return {};
  }

  const scripts: Record<string, string> = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);
    if (!(await hasCompleteEmbarkConfig(pkgDir))) continue;

    const config = await readEmbarkConfig(pkgDir);
    if (!config?.name) continue;

    scripts[config.name] = `bun run --filter @embark/${entry.name} dev`;
  }

  return scripts;
}

export async function updateRootScripts(
  packagesDir = PACKAGES_DIR,
  root = ROOT,
): Promise<boolean> {
  const rootPkgJsonPath = join(root, "package.json");
  if (!(await exists(rootPkgJsonPath))) return false;

  const raw = await readFile(rootPkgJsonPath, "utf-8");
  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }

  const currentScripts = (pkgJson["scripts"] ?? {}) as Record<string, string>;
  const packageScripts = await buildPackageScripts(packagesDir);

  // Keep only non-package scripts, then add current package scripts
  const baseScripts: Record<string, string> = {};
  for (const [key, value] of Object.entries(currentScripts)) {
    if (!PACKAGE_SCRIPT_PATTERN.test(value)) {
      baseScripts[key] = value;
    }
  }

  const newScripts = { ...baseScripts, ...packageScripts };

  if (JSON.stringify(newScripts) === JSON.stringify(currentScripts)) {
    console.log("[update-root-scripts] root package.json scripts are already up to date");
    return false;
  }

  pkgJson["scripts"] = newScripts;
  await writeFile(rootPkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");

  try {
    execSync("git add package.json", { cwd: root, stdio: "ignore", env: gitEnv() });
  } catch {
    // May fail in test environments without git
  }

  const added = Object.keys(packageScripts);
  if (added.length > 0) {
    console.log(`[update-root-scripts] added ${added.length} package script(s) to package.json:`);
    for (const [name, cmd] of Object.entries(packageScripts)) {
      console.log(`[update-root-scripts]   "${name}": "${cmd}"`);
    }
  } else {
    console.log("[update-root-scripts] removed stale package scripts from package.json");
  }

  return true;
}

if (import.meta.main) {
  updateRootScripts().catch((error) => {
    console.error("[update-root-scripts] error:", error);
    process.exit(1);
  });
}
