import { readFile, writeFile, access, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readEmbarkConfig, hasCompleteEmbarkConfig } from "./embark-config";
import { gitEnv } from "./git-env";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function normalizePackageJson(
  pkgDir: string,
  pkgName: string,
): Promise<boolean> {
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!(await exists(pkgJsonPath))) return false;

  const config = await readEmbarkConfig(pkgDir);
  if (!config?.name) return false;

  const raw = await readFile(pkgJsonPath, "utf-8");
  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }

  let changed = false;
  const expectedName = `@embark/${pkgName}`;

  if (pkgJson["name"] !== expectedName) {
    pkgJson["name"] = expectedName;
    changed = true;
    console.log(`[normalize-package] ${pkgName}: name → ${expectedName}`);
  }

  if (config.description && pkgJson["description"] !== config.description) {
    pkgJson["description"] = config.description;
    changed = true;
    console.log(`[normalize-package] ${pkgName}: description synced from .embark.jsonc`);
  }

  if (changed) {
    await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
    return true;
  }

  return false;
}

export async function normalizeAllPackages(
  packagesDir = PACKAGES_DIR,
  root = ROOT,
): Promise<void> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    console.log("[normalize-package] packages directory not found");
    return;
  }

  let hasChanges = false;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);

    // Only normalize packages that have a complete .embark.jsonc
    if (!(await hasCompleteEmbarkConfig(pkgDir))) continue;

    const changed = await normalizePackageJson(pkgDir, entry.name);
    if (changed) hasChanges = true;
  }

  if (hasChanges) {
    try {
      execSync("git add packages/*/package.json", { cwd: root, stdio: "ignore", env: gitEnv() });
    } catch {
      // May fail in test environments without git
    }
  } else {
    console.log("[normalize-package] all package.json files are already normalized");
  }
}

if (import.meta.main) {
  normalizeAllPackages().catch((error) => {
    console.error("[normalize-package] error:", error);
    process.exit(1);
  });
}
