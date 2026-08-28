import { readFile, writeFile, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { buildWorkflowContent } from "./generate-workflows";
import { readEmbarkConfig } from "./embark-config";
import {
  extractCustomBlocks,
  mergeCustomBlocksIntoTemplate,
} from "./sync-workflows";
import { gitEnv } from "./git-env";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");

/**
 * Finds packages whose .embark.jsonc was modified in the current git staging area.
 */
export function getChangedEmbarkConfigs(): string[] {
  try {
    const staged = execSync("git diff --cached --name-only", {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      env: gitEnv(),
    });

    const packages: string[] = [];
    for (const line of staged.split("\n")) {
      const match = line.trim().match(/^packages\/([^/]+)\/.embark\.jsonc$/);
      if (match?.[1]) packages.push(match[1]);
    }
    return packages;
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * For a given package with a changed .embark.jsonc, regenerate its workflow
 * preserving any EMBARK:CUSTOM blocks.
 */
export async function syncWorkflowForPackage(
  packageName: string,
  packagesDir = PACKAGES_DIR,
  workflowsDir = WORKFLOWS_DIR,
): Promise<boolean> {
  const workflowPath = join(workflowsDir, `${packageName}.yml`);
  if (!(await exists(workflowPath))) return false;

  const pkgDir = join(packagesDir, packageName);
  const config = await readEmbarkConfig(pkgDir);
  if (!config?.deploy?.appDeployment) return false;

  // Read current workflow and extract custom blocks
  const currentContent = await readFile(workflowPath, "utf-8");
  const customBlocks = extractCustomBlocks(currentContent);

  // Generate fresh content from updated config
  const freshContent = await buildWorkflowContent(
    packageName,
    config.deploy.appDeployment,
    config.deploy.cloudflareUse ?? false,
    config.subdomain,
    config.rootDomain,
    config.useSubmodule,
  );

  // Merge custom blocks back in
  const mergedContent = mergeCustomBlocksIntoTemplate(freshContent, customBlocks);

  if (currentContent === mergedContent) return false;

  await writeFile(workflowPath, mergedContent, "utf-8");
  return true;
}

async function main() {
  const changed = getChangedEmbarkConfigs();
  if (changed.length === 0) return;

  let synced = 0;
  for (const pkg of changed) {
    const updated = await syncWorkflowForPackage(pkg);
    if (updated) {
      console.log(`[sync-changed-configs] ✅ ${pkg}.yml updated from .embark.jsonc`);
      synced++;
    }
  }

  if (synced > 0) {
    execSync("git add .github/workflows/", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("[sync-changed-configs] error:", error);
    process.exit(1);
  });
}
