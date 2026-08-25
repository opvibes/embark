import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AppDeployment, DeployConfig, EmbarkConfig } from "../shared/types/deploy";
import { REQUIRED_EMBARK_FIELDS } from "../shared/types/deploy";

export type { AppDeployment, DeployConfig, EmbarkConfig };
export { REQUIRED_EMBARK_FIELDS };

function stripJsonComments(content: string): string {
  // Remove single-line comments (// ...)
  let result = content.replace(/\/\/.*$/gm, "");
  // Remove multi-line comments (/* ... */)
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  return result;
}

export async function readEmbarkConfig(packageDir: string): Promise<Partial<EmbarkConfig> | null> {
  const configPath = join(packageDir, ".embark.jsonc");
  try {
    await access(configPath);
    const content = await readFile(configPath, "utf-8");
    const cleanedContent = stripJsonComments(content);
    const config = JSON.parse(cleanedContent) as Partial<EmbarkConfig>;
    return config;
  } catch {
    return null;
  }
}

export async function getAppDeployment(packageDir: string): Promise<AppDeployment> {
  const config = await readEmbarkConfig(packageDir);
  return config?.deploy?.appDeployment ?? "gcp";
}

export async function isNetlifyPackage(packageDir: string): Promise<boolean> {
  const target = await getAppDeployment(packageDir);
  return target === "netlify";
}

export async function isExternalDeploy(packageDir: string): Promise<boolean> {
  const target = await getAppDeployment(packageDir);
  return target === "other";
}

export async function needsDockerfile(packageDir: string): Promise<boolean> {
  const target = await getAppDeployment(packageDir);
  return target !== "other" && target !== "cloudflare-workers";
}

/**
 * Determines if a workflow should be generated for this package.
 * All targets (gcp, netlify, other) generate a workflow when workflowGen === true.
 * - gcp: uses workflow.gcp.template.yml
 * - netlify: uses workflow.netlify.template.yml
 * - other: uses workflow.template.yml (generic CI/CD starter)
 */
export async function shouldGenerateWorkflow(packageDir: string): Promise<boolean> {
  const config = await readEmbarkConfig(packageDir);
  if (!config?.deploy?.appDeployment) return false;
  return config?.deploy?.workflowGen === true;
}

export async function hasEmbarkConfig(packageDir: string): Promise<boolean> {
  const config = await readEmbarkConfig(packageDir);
  return config !== null;
}

/**
 * Whether this configuration needs a `subdomain` field.
 *
 * A subdomain only means something when a custom domain is actually in use:
 * - root domain packages are served at domain.com, so there is no subdomain;
 * - GCP is served at its generated Cloud Run URL and never manages custom DNS;
 * - every other target needs one only when a custom domain was requested.
 */
export function requiresSubdomain(config: Partial<EmbarkConfig> | null): boolean {
  if (!config) return false;
  if (config.rootDomain === true) return false;
  if (config.deploy?.appDeployment === "gcp") return false;
  return config.deploy?.cloudflareUse === true;
}

/**
 * Returns the list of missing required fields in the config
 */
export function getMissingFields(config: Partial<EmbarkConfig> | null): (keyof EmbarkConfig)[] {
  if (!config) {
    return [...REQUIRED_EMBARK_FIELDS];
  }

  return REQUIRED_EMBARK_FIELDS.filter((field) => {
    if (field === "subdomain" && !requiresSubdomain(config)) return false;
    const value = config[field];
    // useSubmodule is a boolean — false is a valid value, only undefined/null counts as missing
    if (field === "useSubmodule") return value === undefined || value === null;
    if (value === undefined || value === null || value === "") return true;
    // For deploy, check if it's a complete DeployConfig object
    if (field === "deploy") {
      const deploy = value as Partial<DeployConfig>;
      return (
        deploy.appDeployment === undefined ||
        deploy.cloudflareUse === undefined ||
        deploy.workflowGen === undefined
      );
    }
    return false;
  });
}

/**
 * Checks if the config has all required fields filled
 */
export function isConfigComplete(config: Partial<EmbarkConfig> | null): config is EmbarkConfig {
  return getMissingFields(config).length === 0;
}

/**
 * Checks if the package has a complete .embark.jsonc with all required fields
 */
export async function hasCompleteEmbarkConfig(packageDir: string): Promise<boolean> {
  const config = await readEmbarkConfig(packageDir);
  return isConfigComplete(config);
}

export interface PackageConfigStatus {
  name: string;
  hasConfig: boolean;
  config: Partial<EmbarkConfig> | null;
  missingFields: (keyof EmbarkConfig)[];
}

/**
 * Returns packages that are missing a .embark.jsonc file entirely.
 */
export async function getPackagesWithoutConfig(packagesDir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const missing: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);
    if (!(await hasEmbarkConfig(pkgDir))) {
      missing.push(entry.name);
    }
  }
  return missing;
}

/**
 * Returns packages that have incomplete or missing .embark.jsonc config.
 */
export async function getPackagesWithIncompleteConfig(
  packagesDir: string,
): Promise<PackageConfigStatus[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const incomplete: PackageConfigStatus[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);
    const config = await readEmbarkConfig(pkgDir);
    const missingFields = getMissingFields(config);
    if (missingFields.length > 0) {
      incomplete.push({ name: entry.name, hasConfig: config !== null, config, missingFields });
    }
  }
  return incomplete;
}

export function validateSubdomain(subdomain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(subdomain);
}

export interface RootDomainState {
  claimed: boolean;
  claimedBy: string | null;
  claimedByDir: string | null;
}

export function assessRootDomainEligibility(
  packageName: string,
  state: RootDomainState,
): { alreadyClaimed: boolean; claimedBy: string | null; claimedByDir: string | null } {
  if (!state.claimed || state.claimedBy === null || state.claimedBy === packageName) {
    return { alreadyClaimed: false, claimedBy: null, claimedByDir: null };
  }
  return { alreadyClaimed: true, claimedBy: state.claimedBy, claimedByDir: state.claimedByDir };
}

/**
 * Finds the package (if any) currently configured as the root domain package.
 * Only one package can have rootDomain: true at a time.
 */
export async function findRootDomainPackage(
  packagesDir: string,
): Promise<{ name: string; dir: string } | null> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(packagesDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);
    const config = await readEmbarkConfig(pkgDir);
    if (config?.rootDomain === true) {
      return { name: entry.name, dir: pkgDir };
    }
  }

  return null;
}
