import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { rm, access } from "node:fs/promises";

const ROOT = join(import.meta.dirname, "..");
const DEMO_PACKAGE_DIR = join(ROOT, "packages", "embark");
const DEMO_WORKFLOW = join(ROOT, ".github", "workflows", "embark.yml");

// ANSI colors
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[90m",
} as const;

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function getUpstreamUrl(root: string): string | null {
  try {
    return execSync("git remote get-url upstream", { cwd: root, stdio: "pipe" })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function getCommitsBehind(root: string, ref: string = "upstream/main"): number {
  try {
    const count = execSync(`git rev-list HEAD..${ref} --count`, { cwd: root, stdio: "pipe" })
      .toString()
      .trim();
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

export function hasMergeConflicts(root: string): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd: root, stdio: "pipe" }).toString();
    return /^(UU|AA|DD|AU|UA|DU|UD)/m.test(status);
  } catch {
    return false;
  }
}

export async function removeDemoArtifacts(root: string): Promise<string[]> {
  const removed: string[] = [];

  const demoPackage = join(root, "packages", "embark");
  if (await fileExists(demoPackage)) {
    await rm(demoPackage, { recursive: true, force: true });
    try {
      execSync("git rm -r --cached packages/embark 2>/dev/null || true", { cwd: root, stdio: "ignore" });
    } catch {
      // ignore
    }
    removed.push("packages/embark");
  }

  const demoWorkflow = join(root, ".github", "workflows", "embark.yml");
  if (await fileExists(demoWorkflow)) {
    await rm(demoWorkflow, { force: true });
    try {
      execSync("git rm --cached .github/workflows/embark.yml 2>/dev/null || true", { cwd: root, stdio: "ignore" });
    } catch {
      // ignore
    }
    removed.push(".github/workflows/embark.yml");
  }

  return removed;
}

export function buildSyncCommitMessage(sha: string): string {
  return `chore(upstream): sync changes from embark@${sha}`;
}

export async function syncUpstream(root: string = ROOT): Promise<"up-to-date" | "synced" | "nothing-to-commit"> {
  console.log(`\n${C.bold}🔄 Sync from upstream${C.reset}\n`);

  // 1. Check upstream remote exists
  const upstreamUrl = getUpstreamUrl(root);
  if (!upstreamUrl) {
    throw new Error(
      `No 'upstream' remote found.\n` +
      `   Run: git remote add upstream https://github.com/opvibes/embark.git\n` +
      `   Then: git remote set-url --push upstream DISABLED`,
    );
  }
  console.log(`${C.dim}upstream → ${upstreamUrl}${C.reset}`);

  // 2. Fetch upstream
  console.log(`\n${C.cyan}📡 Fetching upstream...${C.reset}`);
  execSync("git fetch upstream", { cwd: root, stdio: "inherit" });

  // 3. Check if already up to date
  const behind = getCommitsBehind(root);
  if (behind === 0) {
    console.log(`\n${C.green}✨ Already up to date with upstream.${C.reset}\n`);
    return "up-to-date";
  }
  /* c8 ignore start */
  console.log(`${C.dim}${behind} new commit(s) from upstream${C.reset}`);

  // 4. Merge without committing
  console.log(`\n${C.cyan}🔀 Merging upstream/main...${C.reset}`);
  const mergeResult = spawnSync(
    "git",
    ["merge", "upstream/main", "--no-commit", "--no-ff"],
    { cwd: root, stdio: "inherit" },
  );

  if (mergeResult.status !== 0 && hasMergeConflicts(root)) {
    throw new Error(
      `Merge has unresolved conflicts.\n` +
      `   Resolve them manually, then run: bun run sync-upstream again\n` +
      `   Or abort: git merge --abort`,
    );
  }

  // 5. Remove demo artifacts if re-introduced
  const removed = await removeDemoArtifacts(root);
  for (const path of removed) {
    console.log(`${C.yellow}🗑️  Removed re-introduced: ${path}${C.reset}`);
  }

  // 6. Normalize derived config files
  console.log(`\n${C.cyan}🔧 Normalizing config files...${C.reset}`);
  execSync("bun run scripts/update-apps-jsonc.ts", { cwd: root, stdio: "inherit" });
  execSync("bun run scripts/normalize-package-json.ts", { cwd: root, stdio: "inherit" });
  execSync("bun run scripts/update-root-scripts.ts", { cwd: root, stdio: "inherit" });
  execSync("bun run scripts/update-readme-packages.ts", { cwd: root, stdio: "inherit" });

  // 7. Stage all changes
  execSync("git add -u", { cwd: root, stdio: "ignore" });
  execSync("git add .github/workflows/ 2>/dev/null || true", { cwd: root, stdio: "ignore" });
  execSync("git add packages/ 2>/dev/null || true", { cwd: root, stdio: "ignore" });

  // 8. Check if there's anything to commit
  const statusOutput = execSync("git status --porcelain", { cwd: root, stdio: "pipe" }).toString().trim();
  if (!statusOutput) {
    console.log(`\n${C.green}✨ Nothing to commit after sync.${C.reset}\n`);
    return "nothing-to-commit";
  }

  // 9. Commit (skip hooks since we already ran the normalization scripts)
  const upstreamSha = execSync("git rev-parse --short upstream/main", { cwd: root, stdio: "pipe" })
    .toString()
    .trim();

  execSync(
    `git commit -m "${buildSyncCommitMessage(upstreamSha)}" --no-verify`,
    { cwd: root, stdio: "inherit" },
  );

  console.log(`\n${C.green}✅ Upstream sync complete!${C.reset}\n`);
  return "synced";
  /* c8 ignore stop */
}

/* c8 ignore next 5 */
if (import.meta.main) {
  await syncUpstream().catch((err: Error) => {
    console.error(`${C.red}❌ ${err.message}${C.reset}`);
    process.exit(1);
  });
}
