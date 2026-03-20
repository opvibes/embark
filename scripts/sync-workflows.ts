import { readdir, readFile, writeFile, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import * as readline from "node:readline";
import { readEmbarkConfig } from "./embark-config";
import { buildWorkflowContent } from "./generate-workflows";

export const CUSTOM_BLOCK_START = "# EMBARK:CUSTOM";
export const CUSTOM_BLOCK_END = "# END EMBARK:CUSTOM";

export interface CustomBlock {
  content: string;
  precedingLine: string;
}

export function extractCustomBlocks(content: string): CustomBlock[] {
  const lines = content.split("\n");
  const blocks: CustomBlock[] = [];
  let inBlock = false;
  let blockLines: string[] = [];
  let precedingLine = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === CUSTOM_BLOCK_START || trimmed.startsWith(CUSTOM_BLOCK_START + " ")) {
      inBlock = true;
      blockLines = [line];
    } else if (inBlock) {
      blockLines.push(line);
      if (trimmed === CUSTOM_BLOCK_END) {
        blocks.push({ content: blockLines.join("\n"), precedingLine });
        inBlock = false;
        blockLines = [];
      }
    } else {
      if (line.trim() !== "") {
        precedingLine = line;
      }
    }
  }

  return blocks;
}

export function stripCustomBlocks(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === CUSTOM_BLOCK_START || trimmed.startsWith(CUSTOM_BLOCK_START + " ")) {
      inBlock = true;
    } else if (inBlock && trimmed === CUSTOM_BLOCK_END) {
      inBlock = false;
    } else if (!inBlock) {
      result.push(line);
    }
  }

  return result.join("\n");
}

export function mergeCustomBlocksIntoTemplate(templateContent: string, blocks: CustomBlock[]): string {
  if (blocks.length === 0) return templateContent;

  let result = templateContent;

  for (const block of blocks) {
    const lines = result.split("\n");
    const idx = block.precedingLine ? lines.lastIndexOf(block.precedingLine) : -1;

    if (idx >= 0) {
      lines.splice(idx + 1, 0, block.content);
      result = lines.join("\n");
    } else {
      result = result.trimEnd() + "\n\n" + block.content + "\n";
    }
  }

  return result;
}

function normalizeForComparison(content: string): string {
  return content.replace(/\n{3,}/g, "\n\n").trim();
}

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const WORKFLOWS_DIR = join(ROOT, ".github", "workflows");
// Kept for backward compat with tests that call generateExpectedContent directly
const TEMPLATE_PATH = join(ROOT, "templates", "workflow.netlify.template.yml");

// Workflows do sistema que não correspondem a pacotes e nunca devem ser sincronizados
const SYSTEM_WORKFLOWS = new Set(["bootstrap", "cleaner", "release"]);
const PLACEHOLDER = "__PACKAGE_NAME__";
const PLACEHOLDER_LOWERCASE = "__PACKAGE_NAME_LOWERCASE__";
const PLACEHOLDER_SUBDOMAIN = "__SUBDOMAIN__";

// ANSI colors
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  gray: "\x1b[90m",
  inverse: "\x1b[7m",
  bold: "\x1b[1m",
};

// ANSI cursor control
const cursor = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  clearLine: "\x1b[2K\r",
  moveUp: "\x1b[1A",
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function generateExpectedContent(template: string, packageName: string, subdomain?: string): string {
  const subdomainValue = subdomain || packageName.toLowerCase();
  return template
    .replaceAll(PLACEHOLDER, packageName)
    .replaceAll(PLACEHOLDER_LOWERCASE, packageName.toLowerCase())
    .replaceAll(PLACEHOLDER_SUBDOMAIN, subdomainValue);
}

function wasCustomized(currentContent: string, expectedContent: string): boolean {
  return currentContent !== expectedContent;
}

async function getWorkflowNames(workflowsDir: string): Promise<string[]> {
  if (!(await exists(workflowsDir))) {
    return [];
  }

  const entries = await readdir(workflowsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".yml"))
    .map((e) => e.name.replace(".yml", ""));
}

export function displayDiff(currentContent: string, expectedContent: string): void {
  const currentLines = currentContent.split("\n");
  const expectedLines = expectedContent.split("\n");

  console.log(`\n${colors.gray}─ Differences:${colors.reset}\n`);

  let currentIdx = 0;
  let expectedIdx = 0;

  while (currentIdx < currentLines.length || expectedIdx < expectedLines.length) {
    const current = currentLines[currentIdx];
    const expected = expectedLines[expectedIdx];

    if (current === expected) {
      currentIdx++;
      expectedIdx++;
    } else if (
      expectedIdx >= expectedLines.length ||
      (current !== undefined && !expectedLines.slice(expectedIdx).includes(current))
    ) {
      // Removed line
      if (current !== undefined) {
        console.log(`${colors.red}─ ${current}${colors.reset}`);
      }
      currentIdx++;
    } else {
      // Added line
      if (expected !== undefined) {
        console.log(`${colors.green}+ ${expected}${colors.reset}`);
      }
      expectedIdx++;
    }
  }

  console.log(`\n${colors.gray}─────────────────${colors.reset}\n`);
}

export async function selectOption(
  options: string[],
  title: string,
  _clearScreen: boolean = true,
  inputStream?: NodeJS.ReadableStream,
): Promise<number> {
  const stdin = process.stdin;
  const isTTY = !inputStream && stdin.isTTY;

  // Non-TTY fallback: used in CI and test environments
  if (inputStream || !isTTY || typeof stdin.setRawMode !== "function") {
    const input = inputStream ?? stdin;
    process.stdout.write(`  ${title}\n`);
    options.forEach((opt, i) => process.stdout.write(`  ${i + 1}. ${opt}\n`));
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input, output: process.stdout });
      rl.question(`  Choose [1-${options.length}] (default 1): `, (answer) => {
        rl.close();
        const n = parseInt(answer.trim(), 10);
        resolve(Number.isFinite(n) && n >= 1 && n <= options.length ? n - 1 : 0);
      });
    });
  }

  const totalLines = options.length + 3;
  const write = (text: string) => process.stdout.write(text);

  const render = (index: number) => {
    for (let i = 0; i < totalLines; i++) {
      write(cursor.moveUp + cursor.clearLine);
    }
    write(`  ${colors.blue}${title}${colors.reset}\n`);
    write(`  ${colors.gray}↑/↓ navigate  │  Enter select  │  q cancel${colors.reset}\n`);
    write(`\n`);
    for (let i = 0; i < options.length; i++) {
      if (i === index) {
        write(`  ${colors.green}${colors.bold}❯ ${options[i]}${colors.reset}\n`);
      } else {
        write(`  ${colors.gray}  ${options[i]}${colors.reset}\n`);
      }
    }
  };

  stdin.setRawMode(true);
  process.stdout.write(cursor.hide);

  write(`  ${colors.blue}${title}${colors.reset}\n`);
  write(`  ${colors.gray}↑/↓ navigate  │  Enter select  │  q cancel${colors.reset}\n`);
  write(`\n`);
  for (let i = 0; i < options.length; i++) {
    if (i === 0) {
      write(`  ${colors.green}${colors.bold}❯ ${options[i]}${colors.reset}\n`);
    } else {
      write(`  ${colors.gray}  ${options[i]}${colors.reset}\n`);
    }
  }

  return new Promise((resolve, reject) => {
    let selected = 0;

    const cleanup = () => {
      stdin.removeListener("data", onData);
      write(cursor.show);
      try {
        stdin.setRawMode(false);
      } catch {
        // Ignore errors when restoring raw mode
      }
    };

    const onData = (buffer: Buffer) => {
      const key = buffer.toString();
      if (key === "\x1b[A" || key === "k" || key === "w") {
        selected = (selected - 1 + options.length) % options.length;
        render(selected);
      } else if (key === "\x1b[B" || key === "j" || key === "s") {
        selected = (selected + 1) % options.length;
        render(selected);
      } else if (key === "\r" || key === "\n") {
        cleanup();
        resolve(selected);
      } else if (key === "q" || key === "\x03") {
        cleanup();
        reject(new Error("Operation cancelled by user"));
      }
    };

    stdin.on("data", onData);
  });
}

export async function getSubdomainForPackage(packageName: string, packagesDir: string): Promise<string | undefined> {
  const pkgDir = join(packagesDir, packageName);
  try {
    const config = await readEmbarkConfig(pkgDir);
    return config?.subdomain;
  } catch {
    return undefined;
  }
}

async function getExpectedContentForPackage(
  packageName: string,
  packagesDir: string,
): Promise<string> {
  const pkgDir = join(packagesDir, packageName);
  const config = await readEmbarkConfig(pkgDir);
  const appDeployment = config?.deploy?.appDeployment ?? "netlify";
  const cloudflareUse = config?.deploy?.cloudflareUse ?? false;
  const subdomain = config?.subdomain;
  const rootDomain = config?.rootDomain;
  const useSubmodule = config?.useSubmodule;
  return buildWorkflowContent(packageName, appDeployment, cloudflareUse, subdomain, rootDomain, useSubmodule);
}

export type ApproveCallback = (workflow: string, current: string, expected: string) => Promise<boolean>;

export type SelectModeFn = () => Promise<"all" | "one_by_one" | "skip_all">;

export async function syncWorkflows(
  workflowsDir: string = WORKFLOWS_DIR,
  _templatePath: string = TEMPLATE_PATH,
  acceptAll?: boolean,
  packagesDir: string = PACKAGES_DIR,
  approveCallback?: ApproveCallback,
  selectModeFn?: SelectModeFn,
  inputStream?: NodeJS.ReadableStream,
): Promise<{ updated: number; skipped: number }> {
  const workflows = await getWorkflowNames(workflowsDir);

  // Workflows newly added to git staging (just created this commit cycle) should
  // not be synced — they were generated moments ago with the correct content.
  const newlyCreated = new Set<string>();
  try {
    const staged = execSync("git diff --name-only --cached --diff-filter=A", {
      cwd: ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const line of staged.split("\n")) {
      const match = line.trim().match(/^\.github\/workflows\/(.+)\.yml$/);
      if (match?.[1]) newlyCreated.add(match[1]);
    }
  } catch {
    // ignore — git may not be available or no staged files
  }

  let updated = 0;
  let skipped = 0;
  const customized: string[] = [];

  // First pass: detect customizations (skip newly created workflows)
  for (const workflow of workflows.filter((w) => !SYSTEM_WORKFLOWS.has(w) && !newlyCreated.has(w))) {
    const workflowPath = join(workflowsDir, `${workflow}.yml`);
    const currentContent = await readFile(workflowPath, "utf-8");
    const expectedContent = await getExpectedContentForPackage(workflow, packagesDir);

    const stripped = stripCustomBlocks(currentContent);
    if (normalizeForComparison(stripped) !== normalizeForComparison(expectedContent)) {
      customized.push(workflow);
    }
  }

  // If no customizations, all good
  if (customized.length === 0) {
    return { updated: 0, skipped: 0 };
  }

  // If acceptAll was passed explicitly, use it directly
  let mode: "all" | "one_by_one" | "skip_all" = "one_by_one";

  if (acceptAll !== undefined) {
    mode = acceptAll ? "all" : "one_by_one";
  } else if (selectModeFn) {
    mode = await selectModeFn();
  } else {
    const modeIndex = await selectOption(
      ["Merge all without conflicts", "Merge one by one", "Skip all"],
      "Customized workflows found",
      true,
      inputStream,
    );
    mode = modeIndex === 0 ? "all" : modeIndex === 1 ? "one_by_one" : "skip_all";
  }

  if (mode === "skip_all") {
    console.log(`${colors.gray}⏭️  Skipped all ${customized.length} workflow(s)${colors.reset}`);
    return { updated: 0, skipped: customized.length };
  }

  // If chose "overwrite one by one", show list of customized
  if (mode === "one_by_one") {
    console.log(
      `${colors.yellow}⚠️  ${customized.length} customized workflow(s):${colors.reset}`,
    );
    customized.forEach((w) => {
      console.log(`  ${colors.gray}→${colors.reset} ${w}.yml`);
    });
    console.log("");
  }

  // Second pass: update
  let skipAllRemaining = false;
  for (const workflow of workflows.filter((w) => !SYSTEM_WORKFLOWS.has(w))) {
    const workflowPath = join(workflowsDir, `${workflow}.yml`);
    const currentContent = await readFile(workflowPath, "utf-8");
    const expectedContent = await getExpectedContentForPackage(workflow, packagesDir);

    const strippedCurrent = stripCustomBlocks(currentContent);
    const customBlocks = extractCustomBlocks(currentContent);

    if (normalizeForComparison(strippedCurrent) !== normalizeForComparison(expectedContent)) {
      if (skipAllRemaining) {
        console.log(`${colors.gray}⏭️  ${workflow}.yml skipped${colors.reset}`);
        skipped++;
        continue;
      }

      let approve = mode === "all";

      if (mode === "one_by_one") {
        if (approveCallback) {
          approve = await approveCallback(workflow, strippedCurrent, expectedContent);
        } else {
          console.log(`\n${colors.blue}📄 ${workflow}.yml${colors.reset}`);
          displayDiff(strippedCurrent, expectedContent);
          const index = await selectOption(
            [
              `${colors.green}✓ Merge${colors.reset}`,
              `${colors.yellow}⏭ Skip${colors.reset}`,
              `${colors.gray}⏭ Skip all${colors.reset}`,
            ],
            `Merge ${colors.blue}${workflow}.yml${colors.reset}?`,
            false,
            inputStream,
          );
          if (index === 2) {
            skipAllRemaining = true;
            console.log(`${colors.gray}⏭️  ${workflow}.yml skipped${colors.reset}`);
            skipped++;
            continue;
          }
          approve = index === 0;
        }
      }

      if (approve) {
        const mergedContent = mergeCustomBlocksIntoTemplate(expectedContent, customBlocks);
        await writeFile(workflowPath, mergedContent, "utf-8");
        console.log(`${colors.green}✅ ${workflow}.yml updated${colors.reset}`);
        updated++;
      } else {
        console.log(`${colors.gray}⏭️  ${workflow}.yml skipped${colors.reset}`);
        skipped++;
      }
    }
  }

  if (updated > 0) {
    execSync("git add .github/workflows/", { cwd: ROOT, stdio: "inherit" });
  }

  return { updated, skipped };
}

export { wasCustomized, getWorkflowNames };
