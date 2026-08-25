import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  getPackagesWithoutConfig,
  getPackagesWithIncompleteConfig,
  validateSubdomain,
  assessRootDomainEligibility,
  findRootDomainPackage,
} from "../embark-config";
import type { RootDomainState } from "../embark-config";

const TEST_DIR = join(import.meta.dirname, "../..", ".test-ensure-deploy");

async function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
}

async function teardown() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe("ensure-deploy-config", () => {
  beforeEach(setup);
  afterEach(teardown);

  describe("getPackagesWithoutConfig", () => {
    it("should return empty array when no packages exist", async () => {
      const result = await getPackagesWithoutConfig(TEST_DIR);
      expect(result).toEqual([]);
    });

    it("should return package names that lack .embark.jsonc", async () => {
      await mkdir(join(TEST_DIR, "my-app"), { recursive: true });
      await mkdir(join(TEST_DIR, "my-api"), { recursive: true });

      const result = await getPackagesWithoutConfig(TEST_DIR);
      expect(result).toContain("my-app");
      expect(result).toContain("my-api");
      expect(result).toHaveLength(2);
    });

    it("should not return packages that have .embark.jsonc", async () => {
      await mkdir(join(TEST_DIR, "has-config"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "has-config", ".embark.jsonc"),
        JSON.stringify({ deploy: "cloud-run" }),
      );

      await mkdir(join(TEST_DIR, "no-config"), { recursive: true });

      const result = await getPackagesWithoutConfig(TEST_DIR);
      expect(result).toEqual(["no-config"]);
    });

    it("should return empty when all packages have config", async () => {
      await mkdir(join(TEST_DIR, "pkg-a"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "pkg-a", ".embark.jsonc"),
        JSON.stringify({ deploy: "netlify" }),
      );

      await mkdir(join(TEST_DIR, "pkg-b"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "pkg-b", ".embark.jsonc"),
        JSON.stringify({ deploy: "other" }),
      );

      const result = await getPackagesWithoutConfig(TEST_DIR);
      expect(result).toEqual([]);
    });

    it("should ignore files (non-directories) in packages dir", async () => {
      await writeFile(join(TEST_DIR, "not-a-package.txt"), "hello");
      await mkdir(join(TEST_DIR, "real-pkg"), { recursive: true });

      const result = await getPackagesWithoutConfig(TEST_DIR);
      expect(result).toEqual(["real-pkg"]);
    });
  });

  describe("validateSubdomain", () => {
    it("should validate correct subdomains", () => {
      expect(validateSubdomain("my-app")).toBe(true);
      expect(validateSubdomain("showcase")).toBe(true);
      expect(validateSubdomain("app123")).toBe(true);
      expect(validateSubdomain("a")).toBe(true);
    });

    it("should reject invalid subdomains", () => {
      expect(validateSubdomain("")).toBe(false);
      expect(validateSubdomain("-app")).toBe(false);
      expect(validateSubdomain("app-")).toBe(false);
      expect(validateSubdomain("My-App")).toBe(false);
      expect(validateSubdomain("my_app")).toBe(false);
      expect(validateSubdomain("a".repeat(64))).toBe(false);
    });
  });

  describe("assessRootDomainEligibility", () => {
    it("should return not claimed when state has no claim", () => {
      const state: RootDomainState = { claimed: false, claimedBy: null, claimedByDir: null };
      const result = assessRootDomainEligibility("my-app", state);
      expect(result.alreadyClaimed).toBe(false);
      expect(result.claimedBy).toBeNull();
    });

    it("should return not claimed when the same package owns root domain", () => {
      const state: RootDomainState = { claimed: true, claimedBy: "my-app", claimedByDir: "/some/dir" };
      const result = assessRootDomainEligibility("my-app", state);
      expect(result.alreadyClaimed).toBe(false);
    });

    it("should return claimed when a different package owns root domain", () => {
      const state: RootDomainState = { claimed: true, claimedBy: "other-app", claimedByDir: "/some/dir" };
      const result = assessRootDomainEligibility("my-app", state);
      expect(result.alreadyClaimed).toBe(true);
      expect(result.claimedBy).toBe("other-app");
      expect(result.claimedByDir).toBe("/some/dir");
    });

    it("should return not claimed when claimedBy is null despite claimed being true", () => {
      const state: RootDomainState = { claimed: true, claimedBy: null, claimedByDir: null };
      const result = assessRootDomainEligibility("my-app", state);
      expect(result.alreadyClaimed).toBe(false);
    });
  });

  describe("findRootDomainPackage", () => {
    it("should return null when no packages exist", async () => {
      const result = await findRootDomainPackage(TEST_DIR);
      expect(result).toBeNull();
    });

    it("should return null when no package has rootDomain: true", async () => {
      await mkdir(join(TEST_DIR, "pkg-a"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "pkg-a", ".embark.jsonc"),
        JSON.stringify({
          deploy: { appDeployment: "gcp", cloudflareUse: false, workflowGen: true },
          name: "pkg-a",
          title: "Pkg A",
          subdomain: "pkg-a",
          description: "Package A",
        }),
      );

      const result = await findRootDomainPackage(TEST_DIR);
      expect(result).toBeNull();
    });

    it("should return the package with rootDomain: true", async () => {
      await mkdir(join(TEST_DIR, "root-app"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "root-app", ".embark.jsonc"),
        JSON.stringify({
          deploy: { appDeployment: "cloudflare-pages", cloudflareUse: true, workflowGen: true },
          name: "rootApp",
          title: "Root App",
          subdomain: "root-app",
          description: "Root domain app",
          rootDomain: true,
        }),
      );

      await mkdir(join(TEST_DIR, "other-app"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "other-app", ".embark.jsonc"),
        JSON.stringify({
          deploy: { appDeployment: "gcp", cloudflareUse: false, workflowGen: true },
          name: "otherApp",
          title: "Other App",
          subdomain: "other-app",
          description: "Other app",
        }),
      );

      const result = await findRootDomainPackage(TEST_DIR);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("root-app");
    });

    it("should return null when rootDomain is explicitly false", async () => {
      await mkdir(join(TEST_DIR, "pkg-b"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "pkg-b", ".embark.jsonc"),
        JSON.stringify({
          deploy: { appDeployment: "gcp", cloudflareUse: false, workflowGen: true },
          name: "pkgB",
          title: "Pkg B",
          subdomain: "pkg-b",
          description: "Package B",
          rootDomain: false,
        }),
      );

      const result = await findRootDomainPackage(TEST_DIR);
      expect(result).toBeNull();
    });

    it("should ignore non-directory entries", async () => {
      await writeFile(join(TEST_DIR, "not-a-package.txt"), "hello");

      const result = await findRootDomainPackage(TEST_DIR);
      expect(result).toBeNull();
    });
  });

  describe("getPackagesWithIncompleteConfig", () => {
    it("should return empty array when no packages exist", async () => {
      const result = await getPackagesWithIncompleteConfig(TEST_DIR);
      expect(result).toEqual([]);
    });

    it("should return packages without any config", async () => {
      await mkdir(join(TEST_DIR, "no-config"), { recursive: true });

      const result = await getPackagesWithIncompleteConfig(TEST_DIR);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("no-config");
      expect(result[0]?.hasConfig).toBe(false);
      expect(result[0]?.missingFields).toHaveLength(6);
    });

    it("should return packages with incomplete config", async () => {
      await mkdir(join(TEST_DIR, "partial"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "partial", ".embark.jsonc"),
        JSON.stringify({ deploy: { appDeployment: "gcp", cloudflareUse: false, workflowGen: true } }),
      );

      const result = await getPackagesWithIncompleteConfig(TEST_DIR);
      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe("partial");
      expect(result[0]?.hasConfig).toBe(true);
      expect(result[0]?.missingFields).toContain("name");
      expect(result[0]?.missingFields).toContain("title");
      // gcp is served at its Cloud Run URL — no subdomain is ever asked for.
      expect(result[0]?.missingFields).not.toContain("subdomain");
      expect(result[0]?.missingFields).toContain("description");
      expect(result[0]?.missingFields).not.toContain("deploy");
    });

    it("should not return packages with complete config", async () => {
      await mkdir(join(TEST_DIR, "complete"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "complete", ".embark.jsonc"),
        JSON.stringify({
          deploy: { appDeployment: "gcp", cloudflareUse: false, workflowGen: true },
          name: "complete",
          title: "Complete Package",
          subdomain: "complete",
          description: "A complete package",
          useSubmodule: false,
        }),
      );

      const result = await getPackagesWithIncompleteConfig(TEST_DIR);
      expect(result).toEqual([]);
    });

    it("should return mixed complete and incomplete packages correctly", async () => {
      await mkdir(join(TEST_DIR, "complete"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "complete", ".embark.jsonc"),
        JSON.stringify({
          deploy: { appDeployment: "gcp", cloudflareUse: false, workflowGen: true },
          name: "complete",
          title: "Complete",
          subdomain: "complete",
          description: "Complete",
          useSubmodule: false,
        }),
      );

      await mkdir(join(TEST_DIR, "incomplete"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "incomplete", ".embark.jsonc"),
        JSON.stringify({ deploy: { appDeployment: "netlify" } }),
      );

      await mkdir(join(TEST_DIR, "no-config"), { recursive: true });

      const result = await getPackagesWithIncompleteConfig(TEST_DIR);
      expect(result).toHaveLength(2);

      const names = result.map(r => r.name);
      expect(names).toContain("incomplete");
      expect(names).toContain("no-config");
      expect(names).not.toContain("complete");
    });
  });
});
