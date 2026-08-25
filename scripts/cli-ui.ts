/**
 * Shared terminal UI primitives for Embark's interactive CLIs.
 *
 * Both `create-package.ts` and `ensure-deploy-config.ts` render the same way:
 * coloured section headers, arrow-key menus with a `❯` marker, and text inputs
 * with validation — matching the interactive terminal shown on the website.
 */
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as tty from "node:tty";

// ── ANSI colors ────────────────────────────────────────────
export const COLOR = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
} as const;

// ── ANSI cursor ────────────────────────────────────────────
export const CURSOR = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  clearLine: "\x1b[2K\r",
  moveUp: "\x1b[1A",
} as const;

let TTY_IN: tty.ReadStream | null = null;
let TTY_OUT: fs.WriteStream | null = null;

export function tryInitTty() {
  if (TTY_IN && TTY_OUT) return;
  try {
    const fd = fs.openSync("/dev/tty", "r+");
    const inStream = new tty.ReadStream(fd);
    const outStream = fs.createWriteStream(null as any, { fd });
    TTY_IN = inStream;
    TTY_OUT = outStream;
  } catch {
    // TTY not available (e.g., in CI or some hook environments)
  }
}

export function write(text: string) {
  process.stdout.write(text);
}

export async function readKey(): Promise<string> {
  return new Promise((resolve, reject) => {
    // Prefer using the process stdin when it's a TTY
    if (typeof process.stdin.setRawMode === "function" && process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once("data", (data) => {
        try {
          process.stdin.setRawMode(false);
        } catch {}
        process.stdin.pause();
        resolve(data.toString());
      });
    } else {
      reject(new Error("TTY not available"));
    }
  });
}

export function renderMenu(
  title: string,
  options: string[],
  index: number,
  totalLines: number,
  optionColors?: string[],
) {
  for (let i = 0; i < totalLines; i++) {
    write(CURSOR.moveUp + CURSOR.clearLine);
  }
  write(`  ${title}\n`);
  write(`  ${COLOR.dim}↑/↓ navigate  │  Enter select  │  q cancel${COLOR.reset}\n`);
  write(`\n`);

  for (let i = 0; i < options.length; i++) {
    const activeColor = optionColors?.[i] ?? COLOR.cyan;
    if (i === index) {
      write(`  ${activeColor}${COLOR.bold}❯ ${options[i]}${COLOR.reset}\n`);
    } else {
      write(`  ${COLOR.gray}  ${options[i]}${COLOR.reset}\n`);
    }
  }
}

export async function menuSelect(title: string, options: string[], optionColors?: string[]): Promise<number> {
  // If raw mode isn't available (e.g., non-TTY or some CI/hook environments),
  // fall back to a numbered prompt using readline.
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
        if (Number.isFinite(n) && n >= 1 && n <= options.length) {
          resolve(n - 1);
        } else {
          resolve(0);
        }
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
    const activeColor = optionColors?.[i] ?? COLOR.cyan;
    if (i === index) {
      write(`  ${activeColor}${COLOR.bold}❯ ${options[i]}${COLOR.reset}\n`);
    } else {
      write(`  ${COLOR.gray}  ${options[i]}${COLOR.reset}\n`);
    }
  }

  while (true) {
    let key: string;
    try {
      key = await readKey();
    } catch (err) {
      // If raw mode failed mid-loop, fall back to numeric prompt
      write(CURSOR.show);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve) => {
        rl.question(`Choose [1-${options.length}] (default 1): `, (answer) => {
          rl.close();
          const n = parseInt(answer.trim(), 10);
          if (Number.isFinite(n) && n >= 1 && n <= options.length) {
            resolve(n - 1);
          } else {
            resolve(0);
          }
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
      return 0; // Default to first option on cancel
    } else {
      continue;
    }

    renderMenu(title, options, index, totalLines, optionColors);
  }
}

/**
 * Yes/No menu. `defaultYes` controls which option is pre-selected, by putting it
 * first — so Enter always accepts the sensible default.
 */
export async function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const options = defaultYes ? ["Yes", "No"] : ["No", "Yes"];
  const selected = await menuSelect(question, options);
  return options[selected] === "Yes";
}

export async function askTextInput(prompt: string): Promise<string> {
  if (typeof process.stdin.setRawMode !== "function" || !process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function askRequiredField(fieldName: string, label: string, defaultValue?: string): Promise<string> {
  let value = "";
  const defaultHint = defaultValue ? ` [default: ${defaultValue}]` : "";

  while (!value) {
    value = await askTextInput(`  ${label}${defaultHint}: `);

    if (!value && defaultValue) {
      value = defaultValue;
    }

    if (!value) {
      write(`  ${COLOR.yellow}⚠${COLOR.reset} ${fieldName} is required\n`);
    }
  }

  return value;
}


/**
 * Coloured section header, e.g. `? Deploy Target`.
 */
export function section(title: string): void {
  write(`\n${COLOR.bold}${COLOR.blue}? ${title}${COLOR.reset}\n`);
}

/**
 * Dimmed explanatory line shown under a section header.
 */
export function hint(text: string): void {
  write(`  ${COLOR.dim}${text}${COLOR.reset}\n`);
}

/** Success line: `  ✓ ...` */
export function ok(text: string): void {
  write(`  ${COLOR.green}✓${COLOR.reset} ${text}\n`);
}

/** Warning line: `  ⚠ ...` */
export function warn(text: string): void {
  write(`  ${COLOR.yellow}⚠${COLOR.reset} ${text}\n`);
}

/** Informational line: `  ℹ ...` */
export function info(text: string): void {
  write(`  ${COLOR.dim}ℹ${COLOR.reset} ${text}\n`);
}

/**
 * Text input that keeps asking until a non-empty, valid value is given.
 * `validate` returns an error message, or null when the value is acceptable.
 */
export async function askValidatedField(
  label: string,
  fieldName: string,
  validate: (value: string) => string | null,
  defaultValue?: string,
): Promise<string> {
  const defaultHint = defaultValue ? ` [default: ${defaultValue}]` : "";

  while (true) {
    let value = await askTextInput(`  ${label}${defaultHint}: `);

    if (!value && defaultValue) {
      value = defaultValue;
    }

    if (!value) {
      warn(`${fieldName} is required`);
      continue;
    }

    const error = validate(value);
    if (error) {
      warn(error);
      continue;
    }

    return value;
  }
}
