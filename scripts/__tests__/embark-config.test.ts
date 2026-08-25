import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  readEmbarkConfig,
  getAppDeployment,
  isNetlifyPackage,
  isExternalDeploy,
  hasEmbarkConfig,
  getMissingFields,
  isConfigComplete,
  hasCompleteEmbarkConfig,
  shouldGenerateWorkflow,
} from "../embark-config";
import type { DeployConfig } from "../embark-config";

const TEST_DIR = join(import.meta.dirname, "../..", ".test-embark-config");

const makeDeployConfig = (overrides?: Partial<DeployConfig>): DeployConfig => ({
  appDeployment: "gcp",
  cloudflareUse: false,
  workflowGen: true,
  ...overrides,
});

async function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
}

async function teardown() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe("embark-config", () => {
  beforeEach(setup);
  afterEach(teardown);

  describe("readEmbarkConfig", () => {
    it("should return null when .embark.jsonc does not exist", async () => {
      const config = await readEmbarkConfig(TEST_DIR);
      expect(config).toBeNull();
    });

    it("should return parsed config when .embark.jsonc exists", async () => {
      const deploy = makeDeployConfig({ appDeployment: "netlify" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const config = await readEmbarkConfig(TEST_DIR);
      expect(config).toEqual({ deploy });
    });

    it("should parse gcp config", async () => {
      const deploy = makeDeployConfig({ appDeployment: "gcp" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const config = await readEmbarkConfig(TEST_DIR);
      expect(config).toEqual({ deploy });
    });
  });

  describe("getAppDeployment", () => {
    it("should return gcp when no config exists", async () => {
      const target = await getAppDeployment(TEST_DIR);
      expect(target).toBe("gcp");
    });

    it("should return netlify when config says netlify", async () => {
      const deploy = makeDeployConfig({ appDeployment: "netlify" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const target = await getAppDeployment(TEST_DIR);
      expect(target).toBe("netlify");
    });

    it("should return gcp when config has no deploy field", async () => {
      await writeFile(join(TEST_DIR, ".embark.jsonc"), JSON.stringify({}));
      const target = await getAppDeployment(TEST_DIR);
      expect(target).toBe("gcp");
    });
  });

  describe("isNetlifyPackage", () => {
    it("should return false when no config exists", async () => {
      const result = await isNetlifyPackage(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return true for netlify packages", async () => {
      const deploy = makeDeployConfig({ appDeployment: "netlify" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const result = await isNetlifyPackage(TEST_DIR);
      expect(result).toBe(true);
    });

    it("should return false for gcp packages", async () => {
      const deploy = makeDeployConfig({ appDeployment: "gcp" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const result = await isNetlifyPackage(TEST_DIR);
      expect(result).toBe(false);
    });
  });

  describe("isExternalDeploy", () => {
    it("should return false when no config exists", async () => {
      const result = await isExternalDeploy(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return false for netlify packages", async () => {
      const deploy = makeDeployConfig({ appDeployment: "netlify" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const result = await isExternalDeploy(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return true for other packages", async () => {
      const deploy = makeDeployConfig({ appDeployment: "other" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const result = await isExternalDeploy(TEST_DIR);
      expect(result).toBe(true);
    });

    it("should return false for gcp packages", async () => {
      const deploy = makeDeployConfig({ appDeployment: "gcp" });
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy }),
      );
      const result = await isExternalDeploy(TEST_DIR);
      expect(result).toBe(false);
    });
  });

  describe("hasEmbarkConfig", () => {
    it("should return false when no config exists", async () => {
      const result = await hasEmbarkConfig(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return true when config exists", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy: makeDeployConfig() }),
      );
      const result = await hasEmbarkConfig(TEST_DIR);
      expect(result).toBe(true);
    });
  });

  describe("getMissingFields", () => {
    it("should return all required fields when config is null", () => {
      const missing = getMissingFields(null);
      expect(missing).toContain("deploy");
      expect(missing).toContain("name");
      expect(missing).toContain("title");
      expect(missing).toContain("subdomain");
      expect(missing).toContain("description");
      expect(missing).toContain("useSubmodule");
      expect(missing).toHaveLength(6);
    });

    it("should return missing fields when config has only deploy", () => {
      // Default target is gcp, which never needs a subdomain.
      const missing = getMissingFields({ deploy: makeDeployConfig() });
      expect(missing).not.toContain("deploy");
      expect(missing).toContain("name");
      expect(missing).toContain("title");
      expect(missing).not.toContain("subdomain");
      expect(missing).toContain("description");
      expect(missing).toContain("useSubmodule");
      expect(missing).toHaveLength(4);
    });

    it("should require subdomain only when a custom domain is in use", () => {
      const withDomain = getMissingFields({
        deploy: makeDeployConfig({ appDeployment: "netlify", cloudflareUse: true }),
      });
      expect(withDomain).toContain("subdomain");

      const withoutDomain = getMissingFields({
        deploy: makeDeployConfig({ appDeployment: "netlify", cloudflareUse: false }),
      });
      expect(withoutDomain).not.toContain("subdomain");
    });

    it("should never require subdomain for gcp, even with cloudflareUse=true", () => {
      const missing = getMissingFields({
        deploy: makeDeployConfig({ appDeployment: "gcp", cloudflareUse: true }),
      });
      expect(missing).not.toContain("subdomain");
    });

    it("should return empty array when config is complete", () => {
      const missing = getMissingFields({
        deploy: makeDeployConfig(),
        name: "showcase",
        title: "Showcase",
        subdomain: "showcase",
        description: "A showcase app",
        useSubmodule: false,
      });
      expect(missing).toHaveLength(0);
    });

    it("should detect empty string as missing field", () => {
      const missing = getMissingFields({
        deploy: makeDeployConfig(),
        name: "showcase",
        title: "",
        subdomain: "showcase",
        description: "A showcase app",
        useSubmodule: false,
      });
      expect(missing).toContain("title");
      expect(missing).toHaveLength(1);
    });

    it("should detect incomplete deploy config as missing", () => {
      const missing = getMissingFields({
        deploy: { appDeployment: "gcp" } as DeployConfig,
        name: "showcase",
        title: "Showcase",
        subdomain: "showcase",
        description: "A showcase app",
        useSubmodule: false,
      });
      expect(missing).toContain("deploy");
    });

    it("should not flag useSubmodule=false as missing", () => {
      const missing = getMissingFields({
        deploy: makeDeployConfig(),
        name: "showcase",
        title: "Showcase",
        subdomain: "showcase",
        description: "A showcase app",
        useSubmodule: false,
      });
      expect(missing).not.toContain("useSubmodule");
    });
  });

  describe("isConfigComplete", () => {
    it("should return false when config is null", () => {
      expect(isConfigComplete(null)).toBe(false);
    });

    it("should return false when config is missing fields", () => {
      expect(isConfigComplete({ deploy: makeDeployConfig() })).toBe(false);
    });

    it("should return true when config has all required fields", () => {
      expect(isConfigComplete({
        deploy: makeDeployConfig(),
        name: "showcase",
        title: "Showcase",
        subdomain: "showcase",
        description: "A showcase app",
        useSubmodule: false,
      })).toBe(true);
    });
  });

  describe("hasCompleteEmbarkConfig", () => {
    it("should return false when no config exists", async () => {
      const result = await hasCompleteEmbarkConfig(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return false when config is incomplete", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy: makeDeployConfig() }),
      );
      const result = await hasCompleteEmbarkConfig(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return true when config is complete", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({
          deploy: makeDeployConfig(),
          name: "showcase",
          title: "Showcase",
          subdomain: "showcase",
          description: "A showcase app",
          useSubmodule: false,
        }),
      );
      const result = await hasCompleteEmbarkConfig(TEST_DIR);
      expect(result).toBe(true);
    });
  });

  describe("shouldGenerateWorkflow", () => {
    it("should return true for gcp packages with workflowGen=true", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy: makeDeployConfig({ appDeployment: "gcp", workflowGen: true }) }),
      );
      const result = await shouldGenerateWorkflow(TEST_DIR);
      expect(result).toBe(true);
    });

    it("should return false when no config exists", async () => {
      const result = await shouldGenerateWorkflow(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return false for netlify packages with workflowGen=false", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy: makeDeployConfig({ appDeployment: "netlify", workflowGen: false }) }),
      );
      const result = await shouldGenerateWorkflow(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return true for netlify packages with workflowGen=true", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy: makeDeployConfig({ appDeployment: "netlify", workflowGen: true }) }),
      );
      const result = await shouldGenerateWorkflow(TEST_DIR);
      expect(result).toBe(true);
    });

    it("should return false for other packages with workflowGen=false", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy: makeDeployConfig({ appDeployment: "other", workflowGen: false }) }),
      );
      const result = await shouldGenerateWorkflow(TEST_DIR);
      expect(result).toBe(false);
    });

    it("should return true for other packages with workflowGen=true", async () => {
      await writeFile(
        join(TEST_DIR, ".embark.jsonc"),
        JSON.stringify({ deploy: makeDeployConfig({ appDeployment: "other", workflowGen: true }) }),
      );
      const result = await shouldGenerateWorkflow(TEST_DIR);
      expect(result).toBe(true);
    });
  });
});
