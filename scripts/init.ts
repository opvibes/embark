import { rm, access, readdir, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as tty from "node:tty";

const ROOT = join(import.meta.dirname, "..");
const DEMO_PACKAGE = "embark";
const DEMO_PACKAGE_DIR = join(ROOT, "packages", DEMO_PACKAGE);
const DEMO_WORKFLOW = join(ROOT, ".github", "workflows", `${DEMO_PACKAGE}.yml`);
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

async function init(): Promise<void> {
  initTty();

  write(`\n${COLOR.bold}🚀 Initialize repository for personal use${COLOR.reset}\n`);
  write(`${COLOR.dim}${SEP}${COLOR.reset}\n\n`);

  // ── Step 0: strip embark-specific badges from README ────────
  const readmePath = join(ROOT, "README.md");
  if (await exists(readmePath)) {
    const readmeContent = await readFile(readmePath, "utf-8");
    // Remove the <p align="center"> block containing shields.io version badge
    const badgeBlockRegex = /\n*<p\s+align="center">\s*\n(?:\s*<img[^>]*shields\.io[^>]*>\s*\n)+<\/p>\n*/g;
    const cleaned = readmeContent.replace(badgeBlockRegex, "\n\n");
    if (cleaned !== readmeContent) {
      await writeFile(readmePath, cleaned, "utf-8");
      write(`  ${COLOR.green}✓${COLOR.reset} Removed version badges from README.md\n`);
      try {
        execSync("git add README.md", { cwd: ROOT, stdio: "ignore" });
      } catch {
        // ignore git errors
      }
    }
  }

  // ── Step 1: remove demo package and workflow ──────────────
  let hasChanges = false;

  if (await exists(DEMO_PACKAGE_DIR)) {
    await rm(DEMO_PACKAGE_DIR, { recursive: true, force: true });
    write(`  ${COLOR.green}✓${COLOR.reset} Removed: packages/${DEMO_PACKAGE}\n`);
    hasChanges = true;
  } else {
    write(`  ${COLOR.dim}ℹ packages/${DEMO_PACKAGE} not found, skipping${COLOR.reset}\n`);
  }

  if (await exists(DEMO_WORKFLOW)) {
    await rm(DEMO_WORKFLOW, { force: true });
    write(`  ${COLOR.green}✓${COLOR.reset} Removed: .github/workflows/${DEMO_PACKAGE}.yml\n`);
    hasChanges = true;
  } else {
    write(`  ${COLOR.dim}ℹ .github/workflows/${DEMO_PACKAGE}.yml not found, skipping${COLOR.reset}\n`);
  }

  if (hasChanges) {
    try {
      execSync(`git rm -r --cached packages/${DEMO_PACKAGE} 2>/dev/null || true`, { cwd: ROOT, stdio: "ignore" });
      execSync(`git rm --cached .github/workflows/${DEMO_PACKAGE}.yml 2>/dev/null || true`, { cwd: ROOT, stdio: "ignore" });
      execSync("git add -u", { cwd: ROOT, stdio: "ignore" });
    } catch {
      // ignore git errors in environments without repository
    }
  }

  // ── Configure upstream remote ──────────────────────────
  if (await exists(GIT_DIR)) {
    try {
      // Check if upstream already exists
      const remotes = execSync("git remote", { cwd: ROOT }).toString().trim().split("\n");
      if (!remotes.includes("upstream")) {
        execSync("git remote add upstream https://github.com/opvibes/embark.git", { cwd: ROOT, stdio: "ignore" });
        execSync("git remote set-url --push upstream DISABLED", { cwd: ROOT, stdio: "ignore" });
        write(`  ${COLOR.green}✓${COLOR.reset} Upstream remote configured ${COLOR.dim}(pull-only — push disabled)${COLOR.reset}\n`);
        write(`  ${COLOR.dim}→ git fetch upstream && git merge upstream/main${COLOR.reset}\n`);
        // Enable merge.ours driver for .gitattributes protection
        try {
          execSync("git config merge.ours.driver true", { cwd: ROOT, stdio: "ignore" });
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
      execSync("git init", { cwd: ROOT, stdio: "inherit" });
      execSync("bun run prepare", { cwd: ROOT, stdio: "inherit" });

      // Configure upstream remote for the fresh repo
      try {
        execSync("git remote add upstream https://github.com/opvibes/embark.git", { cwd: ROOT, stdio: "ignore" });
        execSync("git remote set-url --push upstream DISABLED", { cwd: ROOT, stdio: "ignore" });
        write(`  ${COLOR.green}✓${COLOR.reset} Upstream remote configured ${COLOR.dim}(pull-only — push disabled)${COLOR.reset}\n`);
        // Enable merge.ours driver for .gitattributes protection
        try {
          execSync("git config merge.ours.driver true", { cwd: ROOT, stdio: "ignore" });
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
      write(`\n${COLOR.green}✅ Demo package removed.${COLOR.reset} Repository ready for use.\n\n`);
    }
  } else {
    write(`\n${COLOR.green}✅ Demo package removed.${COLOR.reset} Repository ready for use.\n`);
    write(`\n${COLOR.dim}Next steps:${COLOR.reset}\n`);
    write(`  1. ${COLOR.cyan}bun run new-package${COLOR.reset}   — create your first package\n`);
    write(`  2. git add . && git commit -m 'feat: initial'\n`);
    write(`  3. git push              — pipeline activates automatically\n\n`);
  }
}

await init();
