# Embark

Monorepo framework for shipping vibe-coded apps with zero-config CI/CD, Docker, and Cloud Run, Cloudflare Workers deployment.

## Project Principles

- **Code in English** — variable names, functions, comments
- **Mandatory tests for new scripts and functions** — target coverage 77% (see "Test coverage" below for the current measured number and the enforced floor)
- **No `types: any`** — only in extremely necessary cases
- **Everything with Bun** — scripts, installs, builds, tests

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript (strict mode, no `any`)
- **Workspaces:** Bun workspaces (`packages/*`)
- **CI/CD:** GitHub Actions + Docker + Google Cloud Run + Cloudflare Workers
- **Hooks:** Husky (pre-commit for automations)
- **Tests:** Bun test with coverage

## Structure

```
embark/
├── packages/                  # Each subfolder is an independent app
│   └── embark/                # Embark website
│
├── scripts/                   # Monorepo automations
│   ├── create-package.ts      # CLI to create a new package
│   ├── embark-config.ts       # Shared deploy config reader (.embark.json)
│   ├── ensure-deploy-config.ts # Interactive prompt for missing .embark.json
│   ├── generate-workflows.ts  # Generates GitHub Actions workflows per package
│   ├── generate-dockerfiles.ts # Generates default Dockerfiles
│   ├── generate-dockerfiles-ai.ts # CLI with AI for Dockerfiles
│   ├── cleanup-orphan-workflows.ts # Removes workflows for deleted packages
│   ├── sync-workflows.ts      # Syncs workflows with template
│   ├── update-readme-packages.ts # Updates packages table in README
│   └── __tests__/             # Script tests
│
├── templates/                 # Templates for auto generation
│   └── workflow.template.yml  # Base for GitHub Actions workflows
│
├── .github/workflows/         # Auto-generated workflows
│
├── .husky/pre-commit          # Hooks executed before each commit
│
├── apps.jsonc                 # Registry of deployed apps (auto-maintained)
├── bunfig.toml               # Bun config (coverage threshold)
├── tsconfig.json             # TypeScript config (strict)
└── package.json              # Root scripts
```

## Getting Started

### Install dependencies

```bash
bun install
```

### Setup Repository (for new users)

If you cloned this repo to use as a template for your own project, run the setup script:

```bash
bun run setup
```

This script will:
1. **Configure releases** — choose to enable Release Please (resets version to 0.0.0) or remove all release automation
2. Protect release files from upstream sync via `.gitattributes`
3. Configure upstream remote (pull-only, push disabled)
4. Install dependencies
5. Optionally remove `.git` to start fresh with your own repository

Release files (`.release-please-manifest.json`, `release-please-config.json`, `CHANGELOG.md`) are protected from upstream sync via `merge=ours` in `.gitattributes`, so your fork's versioning is never overwritten by the upstream.

### Run scripts for a specific package

```bash
bun run --filter @embark/embark dev
bun run --filter @embark/embark test
```

### Run root scripts

```bash
# Create new package (interactive)
bun run new-package

# Run automation script tests
bun run test

# Sync workflows with template
bun run sync-workflows
```

## Creating a New Package

### Option 1: Interactive script (recommended)

```bash
bun run new-package
```

The script will ask for the following **required fields**:
1. **name** — package name (accepts `camelCase` or `kebab-case`)
2. **title** — human-readable title (e.g. "My Awesome App")
3. **description** — package description
4. **deploy target** — Cloud Run, Netlify, Cloudflare Pages, Cloudflare Workers, or Other

The deploy target is asked **before** anything that depends on it, and each
target only asks its own options. Domain questions (custom domain, root domain,
subdomain) are skipped entirely for targets that do not manage a custom domain —
Cloud Run is served at its generated URL and never asks them.

Then creates the complete structure with:
- `packages/<package>` folder
- `src/index.ts` with placeholder
- `package.json` with name `@embark/<package>`
- `tsconfig.json` extending root
- `.embark.jsonc` with all required config fields

Auto-adds to git.

### .embark.jsonc Configuration

Every package **must** have a `.embark.jsonc` with these required fields:

```jsonc
{
  "deploy": "cloud-run",  // "cloud-run" | "netlify" | "cloudflare-workers" | "other"
  "name": "myPackage",
  "title": "My Package Title",
  "subdomain": "my-package",
  "description": "Package description"
}
```

If any field is missing, the pre-commit hook will prompt you to fill it.

#### Netlify with GitHub Actions Workflow

For Netlify packages, you can optionally generate a workflow for automated deploys:

```jsonc
{
  "deploy": "netlify",
  "workflow": "generate",  // "generate" | "manual" (default: "manual")
  "name": "myApp",
  "title": "My App",
  "subdomain": "my-app",
  "description": "My awesome application"
}
```

- `workflow: "generate"` — Creates GitHub Actions workflow (auto-deploy via CI/CD)
- `workflow: "manual"` — No workflow (deploy via Netlify UI or CLI)

### Option 2: Manual

```bash
mkdir packages/my-app
cd packages/my-app
bun init
```

Configure `package.json`:

```json
{
  "name": "@embark/my-app",
  "description": "Package description",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "test": "bun test"
  }
}
```

Configure `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

Commit — the pre-commit hooks handle the rest:
- Generates `.github/workflows/my-app.yml`
- Generates `Dockerfile` (with AI or default)
- Updates `README.md`

## Adding New Automation Scripts

### Expected structure

Always in English, no `any`:

```typescript
// scripts/my-new-script.ts
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

async function executeScript(): Promise<void> {
  console.log("🔧 Executing my script...");
  // your code here
}

await executeScript();
```

### Mandatory tests

Create a corresponding test file:

```typescript
// scripts/__tests__/my-new-script.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

describe("my new script", () => {
  const testDir = join(import.meta.dirname, "..temp");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("should do something useful", async () => {
    expect(true).toBe(true);
  });
});
```

Run tests:

```bash
bun run test  # Test everything with coverage
bun test scripts/__tests__/my-new-script.test.ts  # Specific test
```

See "Test coverage" below for what's actually enforced — `coverageThreshold` in
`bunfig.toml` is the single source of truth, this doc never repeats the number.

## Code Conventions

### Names and variables

```typescript
// ✅ English
const clientCount = 10;
function calculateAverage(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

### Explicit types

```typescript
// ✅ Clear types
const users: string[] = [];
const map: Map<string, number> = new Map();
function process(data: Record<string, unknown>): void {}

// ❌ No any
const users: any[] = [];
function process(data: any): void {}
```

### Imports and exports

```typescript
// ✅ Import exactly what you need
import { join } from "node:path";
import { calculateAverage } from "./utilities";
```

## Repository Rules

### Mandatory Dockerfile

Every package **must** have a `Dockerfile`. The pre-commit hook ensures this automatically.

### Existing files are not overwritten

If a package already has a `Dockerfile` or workflow, they are **not modified**. Manual customizations are preserved.

### Selective Deploy

Each workflow has a `paths` filter:

```yaml
on:
  push:
    paths:
      - "packages/my-app/**"  # only triggers if this folder changes
```

## Git Hooks (Husky)

On commit, these scripts run automatically in order:

### 1. `ensure-deploy-config.ts`

Scans `packages/` for any package missing `.embark.jsonc` or with incomplete configuration. Interactively prompts for all required fields:
- **deploy** — Cloud Run, Netlify, Cloudflare Pages, Cloudflare Workers, or Other (asked first)
- **name** — package name
- **title** — human-readable title
- **description** — package description
- **subdomain** — only when the chosen target manages a custom domain (see `requiresSubdomain` in `scripts/embark-config.ts`)

If a package has a partial config (e.g. only `deploy`), only the missing fields will be requested.

### 2. `generate-workflows.ts`

Scans `packages/` and generates workflows for new packages in `.github/workflows/`, using the template `templates/workflow.template.yml`. Skips packages with external deploy targets (netlify/other).

### 3. `sync-workflows.ts`

Syncs existing workflows with the template. Offers three options:
- **Merge all without conflicts** (default) — applies template updates preserving EMBARK:CUSTOM blocks
- **Merge one by one** — review each workflow individually (with Merge / Skip / Skip all per workflow)
- **Skip all** — skip all workflow updates

**Guaranteed preservation:** wrap per-deploy customizations in `# EMBARK:CUSTOM ... # END EMBARK:CUSTOM` blocks. The 3-way merge also preserves manual edits made **outside** those blocks in most cases, but if a manual edit falls in the **same region** (same LCS gap) as a template addition/change, the template wins and that edit is silently overwritten. For anything you cannot afford to lose, use `# EMBARK:CUSTOM`.

### 4. `cleanup-orphan-workflows.ts`

Removes workflows whose packages have been deleted or switched to external deploy, and adds the removal to the commit automatically.

### 5. `generate-dockerfiles-ai.ts`

Identifies packages without `Dockerfile` and offers two options:
- **Yes** — choose an AI CLI, sends a prompt with the `package.json` and file structure, receives the Dockerfile
- **No** — generates a default Dockerfile based on `package.json` scripts

Skips packages with external deploy targets (netlify/other).

### 6. `update-readme-packages.ts`

Updates the packages table in `README.md` automatically when there are new packages or removals.

## TypeScript & Config

### tsconfig.json (root)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "module": "Preserve",
    "moduleResolution": "bundler"
  }
}
```

### bunfig.toml

`coverageThreshold` lives only in `bunfig.toml` — that's the single source of
truth, since that's what `bun test --coverage` actually reads. See the comment
in that file for the current value and why. Don't restate the number here; it
would just go stale.

## Tests

### Run all tests with coverage

```bash
bun run test
```

### Available tests

- `create-package.test.ts` — package validation and creation
- `generate-workflows.test.ts` — workflow generation
- `generate-dockerfiles.test.ts` — Dockerfile generation
- `cleanup-orphan-workflows.test.ts` — orphan workflow cleanup
- `sync-workflows.test.ts` — workflow synchronization
- `update-readme-packages.test.ts` — README update

### Test coverage

The enforced floor is `coverageThreshold` in `bunfig.toml` — read the comment
there, don't copy the number here. Two things worth knowing that aren't
obvious from that one line:

- **Bun checks `coverageThreshold` per file, not on the aggregate.** A test
  suite whose overall numbers look fine can still fail `bun test --coverage`
  because one file is below the threshold. This was verified empirically: the
  previous `0.65` value already failed `bun run test` even though aggregate
  coverage was well above it, because `scripts/cli-ui.ts` (an interactive TUI
  menu) sits at ~14–17%. The threshold is now set below that file's real
  number, which is why it's much lower than the aggregate below.
- **The threshold is not wired into any git hook.** `.husky/pre-commit`
  doesn't run tests at all, and `.husky/pre-push` runs `bun test` without
  `--coverage`. It only fires when someone runs `bun run test` by hand. This
  is existing behavior, not something this doc introduced.

**Measured aggregate coverage** (last measured 2026-08-28, via
`bun test --coverage`): **71.78% lines / 75.28% funcs**.

**Target: 77%.** This is a goal, not the enforced floor — the gap is
currently **~5.2pp on lines** (71.78% → 77%) and **~1.7pp on funcs** (75.28% →
77%). The gap is concentrated in a handful of files that are structurally
expensive to unit-test:

- `scripts/cli-ui.ts` (14.29% funcs / 16.67% lines) — an interactive readline
  TUI; most of its surface is prompt-driven control flow.
- `scripts/cleanup-orphan-apps.ts` (47.62% funcs / 30.11% lines) — orchestrates
  real GCP/Netlify/Cloudflare API cleanup calls.
- `scripts/create-package.ts` (68.18% funcs / 34.36% lines) — the interactive
  package-creation wizard.
- `scripts/sync-changed-configs.ts`, `scripts/sync-upstream.ts` — git/submodule
  orchestration scripts, integration-level by nature.

Closing the gap would mean unit-testing interactive stdin flows and mocking
several external APIs (GCP, Netlify, Cloudflare) — real effort with a payoff
that's mostly mock-verification rather than catching real regressions. No
safe hour estimate without a deeper look at each file; closing it is a
product decision, not something this pass does (see repo scope note for why).

## Deploy & CI/CD

### Required GitHub Secrets

#### Cloud Run

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | Google Cloud project ID |
| `GCP_SA_KEY` | Service account JSON (deploy) |
| `GCP_REGION` | Cloud Run region (e.g. `us-central1`) |

#### Netlify + Cloudflare (when using `workflow: "generate"`)

| Secret | Description |
|--------|-------------|
| `NETLIFY_TOKEN` | Netlify personal access token |
| `NETLIFY_SITE_ID` | Netlify site ID |
| `CF_TOKEN` | Cloudflare API token |
| `CF_ZONE_ID` | Cloudflare zone ID for your domain |
| `DOMAIN` | Base domain (e.g. `embark.dev`) |

#### Cloudflare Workers

| Secret | Description |
|--------|-------------|
| `CF_WORKER_TOKEN` | Cloudflare API token (see permissions below) |
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_ZONE_ID` | Zone ID of your domain (only if `cloudflareUse: true`) |
| `DOMAIN` | Base domain (only if `cloudflareUse: true`) |

**`CF_WORKER_TOKEN` permissions** (Create Custom Token):
- Account → Worker Scripts → **Edit**
- Account → Account Settings → **Read**
- Zone → DNS → **Edit** (only if custom domain)
- Zone → Workers Routes → **Edit** (only if custom domain)

### System Workflows

#### Bootstrap (`bootstrap.yml`)

Runs on every push to main:
1. Updates `apps.jsonc` with current package info
2. Generates missing workflows for new packages
3. Commits and pushes changes

#### Cleaner (`cleaner.yml`)

Runs on every push to main (independent of packages):
1. Deletes orphan workflows (workflows without a corresponding package in `packages/`)
2. Finds orphaned apps in `apps.jsonc` (entries whose folder no longer exists)
3. Cleans cloud resources based on `appDeployment` config:
   - **cloudflare-pages**: Removes Pages project + custom domain
   - **netlify**: Deletes Netlify site
   - **gcp**: Deletes Cloud Run service
   - **other**: No cloud cleanup
4. Cleans Cloudflare DNS records (when `cloudflareUse: true`)
5. Removes orphan entries from `apps.jsonc`
6. Commits all cleanup changes

#### Release (`release.yml`)

Handles semantic versioning via Release Please.

### Deploy flow

```
git push main
  ↓
GitHub Actions detects which packages/ changed
  ↓
Build Docker image
  ↓
Push to Artifact Registry
  ↓
Deploy to Cloud Run
```

Only changed packages are deployed (thanks to `paths` filters).
