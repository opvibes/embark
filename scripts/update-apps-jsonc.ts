import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readEmbarkConfig, hasCompleteEmbarkConfig } from "./embark-config";
import type { AppDeployment } from "../shared/types/deploy";
import { gitEnv } from "./git-env";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

export interface AppEntry {
  name: string;
  folderName: string;
  rootDomain: boolean;
  subdomain: string;
  appDeployment: AppDeployment;
  cloudflareUse: boolean;
}

export async function buildAppsEntries(
  packagesDir = PACKAGES_DIR,
): Promise<AppEntry[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const apps: AppEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, String(entry.name));
    if (!(await hasCompleteEmbarkConfig(pkgDir))) continue;

    const config = await readEmbarkConfig(pkgDir);
    if (!config?.name) continue;

    apps.push({
      name: config.name,
      folderName: String(entry.name),
      rootDomain: config.rootDomain ?? false,
      subdomain: config.subdomain ?? "",
      appDeployment: config.deploy?.appDeployment ?? "gcp",
      cloudflareUse: config.deploy?.cloudflareUse ?? false,
    });
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

export async function updateAppsJsonc(
  packagesDir = PACKAGES_DIR,
  root = ROOT,
): Promise<boolean> {
  const appsPath = join(root, "apps.jsonc");

  let existingContent = "";
  try {
    await access(appsPath);
    existingContent = await readFile(appsPath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  // Build entries only from packages that currently exist
  const sortedEntries = await buildAppsEntries(packagesDir);

  const newContent = JSON.stringify(sortedEntries, null, 2) + "\n";

  if (existingContent === newContent) {
    console.log("[update-apps-jsonc] apps.jsonc is already up to date");
    return false;
  }

  await writeFile(appsPath, newContent);

  try {
    execSync("git add apps.jsonc", { cwd: root, stdio: "ignore", env: gitEnv() });
  } catch {
    // May fail in test environments without git
  }

  console.log(`[update-apps-jsonc] apps.jsonc updated with ${sortedEntries.length} entry/entries`);
  return true;
}

if (import.meta.main) {
  updateAppsJsonc().catch((error) => {
    console.error("[update-apps-jsonc] error:", error);
    process.exit(1);
  });
}
