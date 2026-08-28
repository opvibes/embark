import { rm, access, readdir, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as tty from "node:tty";
import { gitEnv } from "./git-env";

const ROOT = join(import.meta.dirname, "..");
const GIT_DIR = join(ROOT, ".git");
const SEP = "─".repeat(50);

// ── ANSI ────────────────────────────────────────────────────
const COLOR = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  gray:    "\x1b[90m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  red:     "\x1b[31m",
} as const;

const CURSOR = {
  hide:      "\x1b[?25l",
  show:      "\x1b[?25h",
  clearLine: "\x1b[2K\r",
  moveUp:    "\x1b[1A",
} as const;

// ── TTY ─────────────────────────────────────────────────────
let ttyInput: tty.ReadStream | null = null;

function initTty() {
  if (ttyInput) return;
  try {
    const fd = fs.openSync("/dev/tty", "r+");
    ttyInput = new tty.ReadStream(fd);
  } catch {
    // TTY unavailable (CI, hooks)
  }
}

function write(text: string) {
  process.stdout.write(text);
}

async function readKey(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof process.stdin.setRawMode === "function" && process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        try { process.stdin.setRawMode(false); } catch {}
        process.stdin.pause();
        resolve(data.toString());
      });
    } else {
      reject(new Error("TTY unavailable"));
    }
  });
}

function renderMenu(title: string, options: string[], index: number, totalLines: number) {
  for (let i = 0; i < totalLines; i++) {
    write(CURSOR.moveUp + CURSOR.clearLine);
  }
  write(`  ${title}\n`);
  write(`  ${COLOR.dim}↑/↓ navigate  │  Enter select  │  q cancel${COLOR.reset}\n`);
  write(`\n`);
  for (let i = 0; i < options.length; i++) {
    if (i === index) {
      write(`  ${COLOR.cyan}${COLOR.bold}❯ ${options[i]}${COLOR.reset}\n`);
    } else {
      write(`  ${COLOR.gray}  ${options[i]}${COLOR.reset}\n`);
    }
  }
}

async function selectMenu(title: string, options: string[]): Promise<number> {
  if (typeof process.stdin.setRawMode !== "function" || !process.stdin.isTTY) {
    write(`${title}\n`);
    for (let i = 0; i < options.length; i++) {
      write(`  ${i + 1}. ${options[i]}\n`);
    }
    write(`\n`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`Choose [1-${options.length}] (default 1): `, (answer) => {
        rl.close();
        const n = parseInt(answer.trim(), 10);
        resolve(Number.isFinite(n) && n >= 1 && n <= options.length ? n - 1 : 0);
      });
    });
  }

  const totalLines = options.length + 3;
  write(CURSOR.hide);
  write(`  ${title}\n`);
  write(`  ${COLOR.dim}↑/↓ navigate  │  Enter select  │  q cancel${COLOR.reset}\n`);
  write(`\n`);

  let index = 0;
  for (let i = 0; i < options.length; i++) {
    if (i === index) {
      write(`  ${COLOR.cyan}${COLOR.bold}❯ ${options[i]}${COLOR.reset}\n`);
    } else {
      write(`  ${COLOR.gray}  ${options[i]}${COLOR.reset}\n`);
    }
  }

  while (true) {
    let key: string;
    try {
      key = await readKey();
    } catch {
      write(CURSOR.show);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve) => {
        rl.question(`Choose [1-${options.length}] (default 1): `, (answer) => {
          rl.close();
          const n = parseInt(answer.trim(), 10);
          resolve(Number.isFinite(n) && n >= 1 && n <= options.length ? n - 1 : 0);
        });
      });
    }

    if (key === "\x1b[A") {
      index = (index - 1 + options.length) % options.length;
    } else if (key === "\x1b[B") {
      index = (index + 1) % options.length;
    } else if (key === "\r" || key === "\n") {
      write(CURSOR.show);
      return index;
    } else if (key === "q" || key === "\x03") {
      write(CURSOR.show);
      process.exit(0);
    } else {
      continue;
    }

    renderMenu(title, options, index, totalLines);
  }
}

async function readText(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listPackages(): Promise<string[]> {
  const packagesDir = join(ROOT, "packages");
  if (!(await exists(packagesDir))) return [];
  const entries = await readdir(packagesDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function setup(): Promise<void> {
  initTty();

  write(`\n${COLOR.bold}🚀 Initialize repository for personal use${COLOR.reset}\n`);
  write(`${COLOR.dim}${SEP}${COLOR.reset}\n\n`);

  // ── Step 1: configure releases ─────────────────────────
  write(`\n${COLOR.dim}${SEP}${COLOR.reset}\n`);
  write(`${COLOR.bold}📦 Release automation (Release Please)${COLOR.reset}\n`);
  write(`${COLOR.dim}${SEP}${COLOR.reset}\n\n`);
  write(`  ${COLOR.dim}Release Please creates automatic changelogs and version bumps\n`);
  write(`  based on Conventional Commits (feat → minor, fix → patch).${COLOR.reset}\n\n`);

  const releaseChoice = await selectMenu(
    `${COLOR.cyan}Do you want automatic releases?${COLOR.reset}`,
    ["Yes, configure releases (start at v0.1.0)", "No, remove release automation"],
  );

  const releaseManifestPath = join(ROOT, ".release-please-manifest.json");
  const releaseConfigPath = join(ROOT, "release-please-config.json");
  const releaseWorkflowPath = join(ROOT, ".github", "workflows", "release.yml");
  const changelogPath = join(ROOT, "CHANGELOG.md");

  if (releaseChoice === 0) {
    // Reset manifest to 0.0.0 so the fork starts fresh
    if (await exists(releaseManifestPath)) {
      await writeFile(releaseManifestPath, '{\n  ".": "0.0.0"\n}\n', "utf-8");
      write(`  ${COLOR.green}✓${COLOR.reset} Reset release manifest to v0.0.0\n`);
    }
    // Reset package.json version
    const pkgJsonPath = join(ROOT, "package.json");
    if (await exists(pkgJsonPath)) {
      const pkgContent = await readFile(pkgJsonPath, "utf-8");
      const updatedPkg = pkgContent.replace(/"version":\s*"[^"]*"/, '"version": "0.0.0"');
      if (updatedPkg !== pkgContent) {
        await writeFile(pkgJsonPath, updatedPkg, "utf-8");
        write(`  ${COLOR.green}✓${COLOR.reset} Reset package.json version to 0.0.0\n`);
      }
    }
    // Clear changelog
    if (await exists(changelogPath)) {
      await writeFile(changelogPath, "# Changelog\n", "utf-8");
      write(`  ${COLOR.green}✓${COLOR.reset} Reset CHANGELOG.md\n`);
    }
    try {
      execSync("git add .release-please-manifest.json release-please-config.json CHANGELOG.md package.json 2>/dev/null || true", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
    } catch {
      // ignore
    }
  } else {
    // Remove all release-related files
    const releaseFiles = [releaseManifestPath, releaseConfigPath, releaseWorkflowPath, changelogPath];
    for (const file of releaseFiles) {
      if (await exists(file)) {
        await rm(file, { force: true });
        const relative = file.replace(ROOT + "/", "");
        write(`  ${COLOR.green}✓${COLOR.reset} Removed: ${relative}\n`);
      }
    }
    try {
      execSync("git rm --cached .release-please-manifest.json release-please-config.json .github/workflows/release.yml CHANGELOG.md 2>/dev/null || true", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
      execSync("git add -u", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
    } catch {
      // ignore
    }
  }

  // ── Protect release files from upstream sync ────────────
  const gitattributesPath = join(ROOT, ".gitattributes");
  if (await exists(gitattributesPath)) {
    const attrContent = await readFile(gitattributesPath, "utf-8");
    if (!attrContent.includes(".release-please-manifest.json")) {
      const releaseAttrs = [
        "",
        "# Prevent upstream releases from overwriting fork releases during sync.",
        ".release-please-manifest.json merge=ours",
        "release-please-config.json merge=ours",
        "CHANGELOG.md merge=ours",
        "",
      ].join("\n");
      await writeFile(gitattributesPath, attrContent.trimEnd() + "\n" + releaseAttrs, "utf-8");
      write(`  ${COLOR.green}✓${COLOR.reset} Added release files to .gitattributes ${COLOR.dim}(protected from upstream sync)${COLOR.reset}\n`);
      try {
        execSync("git add .gitattributes", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
      } catch {
        // ignore
      }
    }
  }

  // ── Configure upstream remote ──────────────────────────
  if (await exists(GIT_DIR)) {
    try {
      // Check if upstream already exists
      const remotes = execSync("git remote", { cwd: ROOT, env: gitEnv() }).toString().trim().split("\n");
      if (!remotes.includes("upstream")) {
        execSync("git remote add upstream https://github.com/opvibes/embark.git", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
        execSync("git remote set-url --push upstream DISABLED", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
        write(`  ${COLOR.green}✓${COLOR.reset} Upstream remote configured ${COLOR.dim}(pull-only — push disabled)${COLOR.reset}\n`);
        write(`  ${COLOR.dim}→ git fetch upstream && git merge upstream/main${COLOR.reset}\n`);
        // Enable merge.ours driver for .gitattributes protection
        try {
          execSync("git config merge.ours.driver true", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
          write(`  ${COLOR.green}✓${COLOR.reset} merge.ours driver enabled ${COLOR.dim}(protects demo files during upstream sync)${COLOR.reset}\n`);
        } catch {
          // ignore
        }
      } else {
        write(`  ${COLOR.dim}ℹ upstream remote already exists, skipping${COLOR.reset}\n`);
      }
    } catch {
      write(`  ${COLOR.yellow}⚠${COLOR.reset} Could not configure upstream remote automatically\n`);
    }
  }

  // ── Install dependencies ───────────────────────────────
  write(`\n${COLOR.cyan}📦 Installing dependencies...${COLOR.reset}\n`);
  execSync("bun install", { cwd: ROOT, stdio: "inherit" });

  // ── Step 2: remove .git ────────────────────────────────
  if (!(await exists(GIT_DIR))) {
    write(`\n${COLOR.green}✅ Done!${COLOR.reset} Repository cleaned.\n`);
    write(`\n${COLOR.dim}Next steps:${COLOR.reset}\n`);
    write(`  1. ${COLOR.cyan}bun run new-package${COLOR.reset}   — create your first package\n`);
    write(`  2. git add . && git commit -m 'feat: initial'\n`);
    write(`  3. git push              — pipeline activates automatically\n\n`);
    return;
  }

  const repoName = basename(ROOT);
  const packages = await listPackages();

  write(`\n${COLOR.dim}${SEP}${COLOR.reset}\n`);
  write(`${COLOR.yellow}${COLOR.bold}⚠️  Remove Git history (.git)${COLOR.reset}\n`);
  write(`${COLOR.dim}${SEP}${COLOR.reset}\n\n`);
  write(`  ${COLOR.dim}Repository${COLOR.reset} : ${COLOR.bold}${ROOT}${COLOR.reset}\n`);
  write(`  ${COLOR.dim}Name      ${COLOR.reset} : ${COLOR.bold}${repoName}${COLOR.reset}\n`);
  write(`  ${COLOR.dim}Packages  ${COLOR.reset} : ${packages.length > 0 ? COLOR.cyan + packages.join(", ") + COLOR.reset : COLOR.dim + "(none)" + COLOR.reset}\n`);
  write(`\n  ${COLOR.dim}This will delete ALL commit history and unlink\n`);
  write(`  the repository from the original remote. You will need to\n`);
  write(`  ${COLOR.reset}${COLOR.bold}git init${COLOR.reset}${COLOR.dim} and connect to your own remote.${COLOR.reset}\n\n`);

  const choice = await selectMenu(
    `${COLOR.yellow}Do you want to remove .git?${COLOR.reset}`,
    ["No, keep the Git history", "Yes, remove .git and start fresh"],
  );

  if (choice === 1) {
    // Ask for typed confirmation for an irreversible action
    write(`\n  ${COLOR.red}${COLOR.bold}Confirmation required.${COLOR.reset}\n`);
    const confirmation = await readText(`  Type ${COLOR.bold}"yes"${COLOR.reset} to confirm: `);

    if (confirmation.toLowerCase() === "yes") {
      await rm(GIT_DIR, { recursive: true, force: true });
      write(`\n  ${COLOR.green}✓${COLOR.reset} Removed: .git\n`);

      // Initialize new git repo and configure husky
      write(`\n${COLOR.cyan}🔧 Initializing new git repository...${COLOR.reset}\n`);
      execSync("git init", { cwd: ROOT, stdio: "inherit", env: gitEnv() });
      execSync("bun run prepare", { cwd: ROOT, stdio: "inherit" });

      // Configure upstream remote for the fresh repo
      try {
        execSync("git remote add upstream https://github.com/opvibes/embark.git", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
        execSync("git remote set-url --push upstream DISABLED", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
        write(`  ${COLOR.green}✓${COLOR.reset} Upstream remote configured ${COLOR.dim}(pull-only — push disabled)${COLOR.reset}\n`);
        // Enable merge.ours driver for .gitattributes protection
        try {
          execSync("git config merge.ours.driver true", { cwd: ROOT, stdio: "ignore", env: gitEnv() });
          write(`  ${COLOR.green}✓${COLOR.reset} merge.ours driver enabled ${COLOR.dim}(protects demo files during upstream sync)${COLOR.reset}\n`);
        } catch {
          // ignore
        }
      } catch {
        write(`  ${COLOR.yellow}⚠${COLOR.reset} Could not configure upstream remote automatically\n`);
      }

      write(`\n${COLOR.green}✅ Repository completely cleaned and ready!${COLOR.reset}\n`);
      write(`\n${COLOR.dim}Next steps:${COLOR.reset}\n`);
      write(`  1. git remote add origin ${COLOR.dim}<your-repo-url>${COLOR.reset}\n`);
      write(`  2. ${COLOR.cyan}bun run new-package${COLOR.reset}   — create your first package\n`);
      write(`  3. git add . && git commit -m 'feat: initial'\n`);
      write(`  4. git push -u origin main\n\n`);
    } else {
      write(`\n  ${COLOR.dim}↩ Cancelled. .git kept.${COLOR.reset}\n`);
      write(`\n${COLOR.green}✅ Setup complete.${COLOR.reset} Repository ready for use.\n\n`);
    }
  } else {
    write(`\n${COLOR.green}✅ Setup complete.${COLOR.reset} Repository ready for use.\n`);
    write(`\n${COLOR.dim}Next steps:${COLOR.reset}\n`);
    write(`  1. ${COLOR.cyan}bun run new-package${COLOR.reset}   — create your first package\n`);
    write(`  2. git add . && git commit -m 'feat: initial'\n`);
    write(`  3. git push              — pipeline activates automatically\n\n`);
  }
}

await setup();
