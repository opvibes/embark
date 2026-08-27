import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { selectOption } from "./sync-workflows";

const ROOT = join(import.meta.dirname, "..");

// ANSI colors
const cyan = "\x1b[36m";
const blue = "\x1b[34m";
const green = "\x1b[32m";
const gray = "\x1b[90m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const reset = "\x1b[0m";

interface Command {
  label: string;
  desc: string;
  script: string;
}

const commands: Command[] = [
  {
    label: "new-package",
    desc: "Create a new package interactively",
    script: "scripts/create-package.ts",
  },
  {
    label: "new-dockerfile",
    desc: "Generate Dockerfiles with AI or default template",
    script: "scripts/generate-dockerfiles-ai.ts",
  },
  {
    label: "sync-workflows",
    desc: "Sync existing workflows with the latest template",
    script: "scripts/sync-workflows-cli.ts",
  },
  {
    label: "setup",
    desc: "Setup repo for personal use (configure releases, upstream remote)",
    script: "scripts/setup.ts",
  },
  {
    label: "sync-upstream",
    desc: "Pull upstream improvements into your fork",
    script: "scripts/sync-upstream.ts",
  },
];

function printBanner(): void {
  const line = "═".repeat(42);
  console.log(`\n${cyan}${bold}  ╔${line}╗${reset}`);
  console.log(`${cyan}${bold}  ║${" ".repeat(14)}embark  start${" ".repeat(15)}║${reset}`);
  console.log(`${cyan}${bold}  ╚${line}╝${reset}\n`);
}

function buildOptions(): string[] {
  const maxLen = Math.max(...commands.map((c) => c.label.length));
  return commands.map((c) => {
    const pad = " ".repeat(maxLen - c.label.length + 3);
    return `${blue}${bold}${c.label}${reset}${pad}${dim}${c.desc}${reset}`;
  });
}

async function main(): Promise<void> {
  printBanner();

  const options = buildOptions();

  let selectedIndex: number;
  try {
    selectedIndex = await selectOption(options, "What would you like to do?");
  } catch {
    console.log(`\n${gray}Cancelled.${reset}\n`);
    process.exit(0);
  }

  const command = commands[selectedIndex];
  if (!command) {
    process.exit(0);
  }

  console.log(`\n${green}▶ Running: ${command.label}${reset}\n`);

  const result = spawnSync("bun", [join(ROOT, command.script)], {
    stdio: "inherit",
    cwd: ROOT,
  });

  process.exit(result.status ?? 0);
}

main().catch((error: unknown) => {
  console.error("Error:", (error as Error).message);
  process.exit(1);
});
