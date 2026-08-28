import { rmSync } from "node:fs";
import { join } from "node:path";
import { readdir, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { gitEnv } from "./git-env";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

function getTrackedPackages(): Set<string> {
  const names = new Set<string>();

  try {
    // List direct subdirectories of packages/ committed in HEAD
    const headOutput = execSync("git ls-tree --name-only HEAD packages/", { cwd: ROOT, encoding: "utf-8", env: gitEnv() });
    headOutput
      .split("\n")
      .map((line) => line.trim().replace(/^packages\//, ""))
      .filter((name) => name.length > 0)
      .forEach((name) => names.add(name));
  } catch {
    // HEAD may not exist yet (fresh repo before first commit)
  }

  try {
    // Also include packages staged in the index (git add'd but not yet committed)
    const indexOutput = execSync("git diff --name-only --cached --diff-filter=A -- packages/", {
      cwd: ROOT,
      encoding: "utf-8",
      env: gitEnv(),
    });
    indexOutput
      .split("\n")
      .map((line) => line.trim().replace(/^packages\//, "").split("/")[0])
      .filter((name) => name.length > 0)
      .forEach((name) => names.add(name));
  } catch {
    // ignore errors
  }

  return names;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function cleanTestArtifacts() {
  console.log("[cleanup-test] cleaning test artifacts...");

  if (await exists(PACKAGES_DIR)) {
    const trackedPackages = getTrackedPackages();
    const entries = await readdir(PACKAGES_DIR, { withFileTypes: true });
    const packageDirs = entries.filter((e) => e.isDirectory());

    // Safety guard: if git returned no tracked packages but directories exist,
    // something went wrong (fresh repo, detached HEAD, git error) — skip deletion
    // to avoid destroying real packages.
    if (trackedPackages.size === 0 && packageDirs.length > 0) {
      console.log("[cleanup-test] git returned no tracked packages — skipping package cleanup to avoid data loss");
    } else {
      for (const entry of packageDirs) {
        if (!trackedPackages.has(entry.name)) {
          const path = join(PACKAGES_DIR, entry.name);
          try {
            rmSync(path, { recursive: true, force: true });
            console.log(`[cleanup-test] removed temporary package: packages/${entry.name}`);
          } catch (error) {
            console.error(`[cleanup-test] error removing ${entry.name}:`, error);
          }
        }
      }
    }
  } else {
    console.log("[cleanup-test] no packages found");
  }

  // Clean up cleanup-orphan-workflows test directory if it exists
  const testDirCleanup = join(ROOT, ".test-cleanup");
  if (await exists(testDirCleanup)) {
    try {
      rmSync(testDirCleanup, { recursive: true, force: true });
      console.log("[cleanup-test] removed test directory .test-cleanup");
    } catch (error) {
      console.error("[cleanup-test] error removing .test-cleanup:", error);
    }
  }

  console.log("[cleanup-test] cleanup complete");
}

if (import.meta.main) {
  cleanTestArtifacts().catch((error) => {
    console.error("[cleanup-test] error:", error);
    process.exit(1);
  });
}
