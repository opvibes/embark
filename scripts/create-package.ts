import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { AppDeployment, DeployConfig, EmbarkConfig } from "./embark-config";
import { findRootDomainPackage, readEmbarkConfig } from "./embark-config";
import {
  COLOR,
  askRequiredField,
  askValidatedField,
  askYesNo,
  hint,
  info,
  menuSelect,
  ok,
  section,
  tryInitTty,
  warn as warnLine,
  write,
} from "./cli-ui";

/** Aligned `Label: value` line used in the creation summary. */
function summaryLine(label: string, value: string): void {
  write(`  ${COLOR.dim}${label.padEnd(11)}${COLOR.reset}${value}\n`);
}

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

function validateCamelCase(name: string): boolean {
  // Accepts camelCase and kebab-case, then converts to camelCase if needed
  return /^[a-z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*$/.test(name);
}

function validateSubdomain(subdomain: string): boolean {
  // Subdomain: lowercase letters, numbers, hyphens; 1-63 chars; no leading/trailing hyphens
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain);
}

function convertToCamelCase(name: string): string {
  return name
    .split("-")
    .map((part, idx) =>
      idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

function buildNetlifyToml(publishDir: string): string {
  return `[build]
  publish = "${publishDir}"
`;
}

export function buildSubmoduleAddCommand(url: string, relativePath: string): string {
  return `git submodule add ${url} ${relativePath}`;
}

function isExecError(error: unknown): error is { stderr: Buffer | string } {
  return typeof error === "object" && error !== null && "stderr" in error;
}

/** Matches a GitHub remote (github.com, over https or ssh) so the auth hint below only fires there. */
export function isGitHubUrl(url: string): boolean {
  return /(^|[@/.])github\.com([/:]|$)/i.test(url);
}

// Git's own wording for "no credentials" / "no access" failures. GitHub returns the
// same "not found" response for a repo that truly doesn't exist AND for one the
// caller isn't authenticated for, so that signature is treated as an auth failure too.
const AUTH_FAILURE_PATTERNS = [
  /authentication failed/i,
  /could not read username/i,
  /\b403\b/,
  /repository not found/i,
];

function looksLikeAuthFailure(message: string): boolean {
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Turns a raw `git submodule add` failure into something a human can act on.
 * Left untouched (raw stderr + manual command) unless the message matches a
 * known credential/permission signature — see `AUTH_FAILURE_PATTERNS`.
 */
export function describeSubmoduleFailure(url: string, command: string, rawMessage: string): string {
  if (!looksLikeAuthFailure(rawMessage)) {
    return `Failed to run \`${command}\`:\n${rawMessage}\n\nRun it manually once the URL is reachable: ${command}`;
  }

  const hint = isGitHubUrl(url)
    ? [
        "This looks like a missing-credential failure, not a broken URL: GitHub returns the same",
        "\"not found\" response both for a repo that truly doesn't exist and for a private repo/org",
        "you aren't authenticated for.",
        "",
        "Fix: set GITHUB_TOKEN in your environment (a GitHub fine-grained Personal Access Token",
        "with \"Contents: Read\" on this repo/org), then re-run.",
        "Full step-by-step, including the org-approval step private orgs may require:",
        "docs/github-secrets.md → \"Token for private submodules\".",
      ].join("\n")
    : [
        "This looks like a missing-credential failure: the remote requires authentication",
        "that Git doesn't currently have configured (a token, an SSH key, or a credential helper).",
      ].join("\n");

  return `Failed to run \`${command}\`:\n${rawMessage}\n\n${hint}\n\nOnce configured, run it manually: ${command}`;
}

/**
 * Registers `relativePath` as a real Git submodule pointing at `url`, run from `cwd`.
 * On failure it best-effort cleans up any partial state a failed `git submodule add`
 * can leave behind (a `.gitmodules` entry and/or an empty directory) so the caller
 * never has to reason about a half-wired package.
 */
export async function addGitSubmodule(url: string, relativePath: string, cwd: string): Promise<void> {
  const command = buildSubmoduleAddCommand(url, relativePath);
  // env is passed explicitly (not inherited implicitly) so a caller that sets
  // GIT_ALLOW_PROTOCOL/GIT_CONFIG_* at runtime (e.g. tests using local repos) is honored.
  const env = process.env;
  try {
    execSync(command, { cwd, stdio: "pipe", env });
  } catch (error) {
    const stderr = isExecError(error) ? error.stderr.toString().trim() : "";
    const message = stderr || (error instanceof Error ? error.message : String(error));

    try {
      execSync(`git rm -f ${relativePath}`, { cwd, stdio: "pipe", env });
    } catch {
      // nothing was staged yet (e.g. clone failed before registration) — ignore
    }
    try {
      execSync(`git submodule deinit -f ${relativePath}`, { cwd, stdio: "pipe", env });
    } catch {
      // submodule was never initialized — ignore
    }
    await rm(join(cwd, relativePath), { recursive: true, force: true });

    throw new Error(describeSubmoduleFailure(url, command, message));
  }
}

export interface PackageCreationInput {
  camelCaseName: string;
  title: string;
  description: string;
  rootDomain: boolean;
  subdomain: string;
  appDeployment: AppDeployment;
  workflowGen: boolean;
  cloudflareUse: boolean;
  useSubmodule: boolean;
  submoduleUrl: string;
}

export interface PackageCreationResult {
  packageDir: string;
  wiredAsSubmodule: boolean;
}

/**
 * Performs the actual filesystem/Git side effects of package creation, given
 * already-collected answers. Kept separate from the interactive prompting in
 * `createPackage` so the "yes"/"no" submodule branches can be exercised directly
 * in tests without driving the terminal UI.
 */
export async function createPackageFiles(
  input: PackageCreationInput,
  packagesDir: string,
  repoRoot: string,
): Promise<PackageCreationResult> {
  const packageDir = join(packagesDir, input.camelCaseName);
  const srcDir = join(packageDir, "src");

  const deployConfig: DeployConfig = {
    appDeployment: input.appDeployment,
    cloudflareUse: input.cloudflareUse,
    workflowGen: input.workflowGen,
  };

  const embarkConfig: EmbarkConfig = {
    deploy: deployConfig,
    name: input.camelCaseName,
    title: input.title,
    ...(input.rootDomain ? { rootDomain: true } : {}),
    ...(input.subdomain ? { subdomain: input.subdomain } : {}),
    description: input.description,
    useSubmodule: input.useSubmodule,
  };

  if (input.useSubmodule) {
    const relativePath = `packages/${input.camelCaseName}`;

    // The submodule's content belongs to its own repo — only the Embark
    // control file is written here, never the scaffold (src/index.ts,
    // package.json, tsconfig.json, netlify.toml).
    await addGitSubmodule(input.submoduleUrl, relativePath, repoRoot);
    ok(`Registered Git submodule: ${relativePath}`);

    await writeEmbarkConfig(packageDir, embarkConfig);

    return { packageDir, wiredAsSubmodule: true };
  }

  await mkdir(packageDir, { recursive: true });
  await mkdir(srcDir, { recursive: true });
  ok(`Created directory: packages/${input.camelCaseName}`);

  await createBaseFiles(input.camelCaseName, packageDir, srcDir, input.title, input.subdomain, input.description);

  if (input.appDeployment === "netlify") {
    const netlifyToml = buildNetlifyToml("dist");
    await writeFile(join(packageDir, "netlify.toml"), netlifyToml);
    ok("Created: netlify.toml");
  }

  await writeEmbarkConfig(packageDir, embarkConfig);

  try {
    execSync(`git add packages/${input.camelCaseName}/`, { cwd: repoRoot, stdio: "ignore" });
  } catch {
    warnLine("Could not add to git automatically");
  }

  return { packageDir, wiredAsSubmodule: false };
}

/**
 * Domain placement (root domain vs subdomain).
 * Only asked for targets that actually manage a custom domain — GCP never does.
 */
async function askDomainPlacement(
  camelCaseName: string,
): Promise<{ rootDomain: boolean; subdomain: string }> {
  const existingRootPkg = await findRootDomainPackage(PACKAGES_DIR);
  let rootDomain = false;

  section("Domain Setup");
  const rootIndex = await menuSelect("🌍 Where should this package live?", [
    "Subdomain (e.g. my-app.yourdomain.com)  (recommended)",
    "Root domain (yourdomain.com)",
  ]);

  if (rootIndex === 1) {
    write(`\n`);
    warnLine("Only ONE package can own the root domain.");
    hint("All other packages must use a subdomain (e.g. app.yourdomain.com).");

    if (existingRootPkg && existingRootPkg.name !== camelCaseName) {
      write(`\n`);
      warnLine(`Package "${existingRootPkg.name}" already owns the root domain.`);
      hint(`Replacing it means "${existingRootPkg.name}" will NO LONGER be reachable at yourdomain.com.`);
      hint(`Its .embark.jsonc will be updated to remove root domain access.`);
      hint(`You must redeploy "${existingRootPkg.name}" with a subdomain to restore it.`);

      const firstConfirm = await menuSelect(
        `Replace "${existingRootPkg.name}" with "${camelCaseName}" as the root domain package?`,
        [
          "No, use a subdomain instead  (recommended)",
          `Yes, replace "${existingRootPkg.name}"`,
        ],
        [COLOR.cyan, COLOR.red],
      );

      if (firstConfirm === 1) {
        write(`\n`);
        warnLine(`FINAL WARNING: "${existingRootPkg.name}" will permanently lose root domain access.`);
        hint("This is irreversible unless you manually edit .embark.jsonc.");

        const finalConfirm = await menuSelect("Confirm replacement?", [
          "No, cancel",
          "Yes, confirm replacement",
        ], [COLOR.cyan, COLOR.red]);

        if (finalConfirm === 1) {
          // Remove rootDomain from the existing package
          try {
            const prevConfig = await readEmbarkConfig(existingRootPkg.dir);
            if (prevConfig) {
              const updated = { ...prevConfig, rootDomain: false };
              const content = `// This file is auto-generated by Embark. Do not remove.\n// Edit these fields to update your package configuration.\n${JSON.stringify(updated, null, 2)}\n`;
              await writeFile(`${existingRootPkg.dir}/.embark.jsonc`, content);
              ok(`Removed root domain from "${existingRootPkg.name}"`);
            }
          } catch {
            warnLine(`Could not update "${existingRootPkg.name}"'s config. Please edit it manually.`);
          }
          rootDomain = true;
        } else {
          info("Root domain replacement cancelled. Using subdomain instead.");
        }
      } else {
        info(`Keeping "${existingRootPkg.name}" as the root domain package. Using subdomain instead.`);
      }
    } else {
      const confirm = await menuSelect(
        `Deploy "${camelCaseName}" to the root domain (yourdomain.com)?`,
        [
          "No, use a subdomain instead  (recommended)",
          `Yes, use the root domain for "${camelCaseName}"`,
        ],
        [COLOR.cyan, COLOR.red],
      );
      if (confirm === 1) {
        rootDomain = true;
        ok("Root domain confirmed.");
      } else {
        info("Using subdomain deployment instead.");
      }
    }
  }

  if (rootDomain) {
    return { rootDomain: true, subdomain: "" };
  }

  const subdomain = await askValidatedField(
    "🌐 Subdomain (e.g. 'my-app' → my-app.embark.dev)",
    "Subdomain",
    (value) =>
      validateSubdomain(value)
        ? null
        : "Invalid subdomain. Use lowercase letters, numbers, and hyphens only.",
    camelCaseName.toLowerCase(),
  );

  return { rootDomain: false, subdomain };
}

async function createPackage() {
  tryInitTty();

  write(`\n${COLOR.bold}📦 Package Creator${COLOR.reset} ${COLOR.dim}- embark${COLOR.reset}\n`);

  // Ask for project name
  section("Package Name");
  const projectName = await askValidatedField(
    "📝 Name (camelCase or kebab-case)",
    "Name",
    (value) =>
      validateCamelCase(value)
        ? null
        : "Invalid name. Use camelCase or kebab-case only (e.g. my-app or myApp).",
  );

  const camelCaseName = convertToCamelCase(projectName);

  // Ask for title
  section("Title");
  const title = await askValidatedField(
    "🏷️  Title (human-readable, e.g. 'My Awesome App')",
    "Title",
    () => null,
  );

  // Ask for description
  section("Description");
  const description = await askValidatedField("📄 Description", "Description", () => null);

  // Ask for the deploy target FIRST — every question after this one depends on it.
  section("Deploy Target");
  const targetIndex = await menuSelect("🚀 Where should this package deploy?", [
    "GCP - Google Cloud Run (Dockerfile + workflow + Cloud Run deploy)",
    "Netlify (generates workflow)",
    "Cloudflare Pages (generates workflow with DNS setup)",
    "Cloudflare Workers (generates workflow for serverless backend)",
    "Other (custom deploy — you must create the workflow manually)",
  ]);

  const targets: AppDeployment[] = ["gcp", "netlify", "cloudflare-pages", "cloudflare-workers", "other"];
  const appDeployment = targets[targetIndex] ?? "gcp";

  // Target-specific options. Only the questions that make sense for the chosen
  // target are asked.
  //
  // GCP deploys to Cloud Run and is reachable at its generated *.run.app URL —
  // it does not manage custom DNS, so no domain question is asked and no
  // subdomain is stored.
  let cloudflareUse = false;
  let rootDomain = false;
  let subdomain = "";

  if (appDeployment === "gcp") {
    section("Google Cloud Run");
    hint("A Dockerfile will be generated for this package.");
    hint("The workflow builds the image, pushes it to Artifact Registry and deploys to Cloud Run.");
    hint("The service is served at its Cloud Run URL — no custom domain.");
  } else if (appDeployment === "cloudflare-pages") {
    section("Custom Domain");
    hint("Your app will be live at project.pages.dev — connect a custom domain too?");
    cloudflareUse = await askYesNo("🌐 Publish under a custom domain (e.g. app.yourdomain.com)?");
  } else if (appDeployment === "cloudflare-workers") {
    section("Custom Domain");
    hint("Your worker will be live at name.workers.dev — connect a custom domain too?");
    cloudflareUse = await askYesNo("🌐 Publish under a custom domain (e.g. api.yourdomain.com)?");
  } else if (appDeployment === "netlify") {
    section("Custom Domain");
    hint("Your site will be live at a netlify.app URL — connect a custom domain too?");
    cloudflareUse = await askYesNo("☁️  Use Cloudflare for custom domain/DNS setup?");
  }

  // Domain placement is only relevant when a custom domain is actually in use.
  if (cloudflareUse) {
    const placement = await askDomainPlacement(camelCaseName);
    rootDomain = placement.rootDomain;
    subdomain = placement.subdomain;
  }

  // Ask for workflowGen (boolean)
  section("Workflow Generation");
  const workflowGen = await askYesNo(
    appDeployment === "other"
      ? "🔄 Auto-generate a generic CI/CD workflow (you add the deploy steps)?"
      : "🔄 Auto-generate GitHub Actions workflow?",
  );

  // Ask about Git submodules
  section("Git Submodules");
  const useSubmodule = await askYesNo("🔗 Does this package use Git submodules?", false);
  let submoduleUrl = "";
  if (useSubmodule) {
    submoduleUrl = await askRequiredField("Submodule URL", "🔗 Submodule Git URL");

    if (isGitHubUrl(submoduleUrl)) {
      write(`\n`);
      warnLine("If this repository is private (or belongs to an organization), `git submodule add` needs authentication.");
      hint("Set GITHUB_TOKEN in your environment before continuing — see docs/github-secrets.md (\"Token for private submodules\").");
      write(`\n`);
      warnLine("Se este repositório for privado (ou pertence a uma organização), o `git submodule add` precisa de autenticação.");
      hint("Configure GITHUB_TOKEN no ambiente antes de continuar — veja docs/github-secrets.md (\"Token for private submodules\").");
    }
  }

  const packageDir = join(PACKAGES_DIR, camelCaseName);

  write(`\n${COLOR.bold}${COLOR.cyan}🚀 Creating package: ${camelCaseName}${COLOR.reset}\n`);
  summaryLine("Title", title);
  summaryLine("Deploy", appDeployment);
  summaryLine(
    "Domain",
    cloudflareUse
      ? rootDomain
        ? "root (yourdomain.com)"
        : `${subdomain}.yourdomain.com`
      : "platform default URL (no custom domain)",
  );
  summaryLine("Workflow", workflowGen ? "auto-generate" : "manual");
  summaryLine("Cloudflare", cloudflareUse ? "yes" : "no");
  summaryLine("Submodule", useSubmodule ? submoduleUrl : "no");
  write(`\n`);

  try {
    const { wiredAsSubmodule } = await createPackageFiles(
      {
        camelCaseName,
        title,
        description,
        rootDomain,
        subdomain,
        appDeployment,
        workflowGen,
        cloudflareUse,
        useSubmodule,
        submoduleUrl,
      },
      PACKAGES_DIR,
      ROOT,
    );

    if (wiredAsSubmodule) {
      write(`\n${COLOR.green}${COLOR.bold}✅ Submodule package registered successfully!${COLOR.reset}\n`);
      write(`\n${COLOR.bold}Next steps:${COLOR.reset}\n`);
      write(`  ${COLOR.dim}1.${COLOR.reset} cd packages/${camelCaseName} && commit/push .embark.jsonc in the submodule's own repo\n`);
      write(`  ${COLOR.dim}2.${COLOR.reset} Back in this repo, commit the submodule pointer: git add .gitmodules packages/${camelCaseName}\n`);
      write(`  ${COLOR.dim}3.${COLOR.reset} Run: bun install\n`);
      write(`\n`);
      return;
    }

    write(`\n${COLOR.green}${COLOR.bold}✅ Package created successfully!${COLOR.reset}\n`);
    write(`\n${COLOR.bold}Next steps:${COLOR.reset}\n`);
    write(`  ${COLOR.dim}1.${COLOR.reset} Edit packages/${camelCaseName}/src/index.ts\n`);
    write(`  ${COLOR.dim}2.${COLOR.reset} Run: bun install\n`);
    if (workflowGen) {
      if (appDeployment === "other") {
        write(`  ${COLOR.dim}3.${COLOR.reset} Commit your changes ${COLOR.dim}(generic workflow will be generated — add your deploy steps to it)${COLOR.reset}\n`);
      } else {
        write(`  ${COLOR.dim}3.${COLOR.reset} Commit your changes ${COLOR.dim}(workflow will be generated automatically)${COLOR.reset}\n`);
      }
    } else {
      write(`  ${COLOR.dim}3.${COLOR.reset} Commit your changes ${COLOR.dim}(no workflow will be auto-generated)${COLOR.reset}\n`);
    }
    write(`\n`);
  } catch (error) {
    write(`\n${COLOR.red}❌ Error creating package:${COLOR.reset} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

async function createBaseFiles(
  camelCaseName: string,
  packageDir: string,
  srcDir: string,
  title: string,
  _subdomain: string,
  description: string,
): Promise<void> {
  const tsconfig = {
    extends: "../../tsconfig.json",
    compilerOptions: {
      composite: true,
      outDir: "./dist",
    },
    include: ["src/**/*"],
  };

  await writeFile(join(packageDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2) + "\n");
  ok("Created: tsconfig.json");

  const packageJson = {
    name: `@embark/${camelCaseName}`,
    description,
    version: "0.0.1",
    private: true,
    type: "module",
  };

  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify(packageJson, null, 2) + "\n",
  );
  ok("Created: package.json");

  const indexTs = `// ${camelCaseName}\n\nexport function hello(): string {\n  return "Hello from ${camelCaseName}";\n}\n`;
  await writeFile(join(srcDir, "index.ts"), indexTs);
  ok("Created: src/index.ts");
}

async function writeEmbarkConfig(
  packageDir: string,
  config: EmbarkConfig,
): Promise<void> {
  const configContent = `// This file is auto-generated by Embark. Do not remove.
// Edit these fields to update your package configuration.
${JSON.stringify(config, null, 2)}
`;
  await writeFile(join(packageDir, ".embark.jsonc"), configContent);
  ok("Created: .embark.jsonc");
}

if (import.meta.main) {
  createPackage().catch((error) => {
    write(`\n${COLOR.red}[create-package] error:${COLOR.reset} ${String(error)}\n`);
    process.exit(1);
  });
}
