import { describe, test, expect } from "bun:test";
import { exists, processPackageWorkflow, processPackagesWorkflows, type PackageWorkflowData } from "../generate-workflows";
import { writeFileSync, unlinkSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("exists", () => {
  test("returns true for existing file", async () => {
    const result = await exists(import.meta.path);
    expect(result).toBe(true);
  });

  test("returns true for existing directory", async () => {
    const result = await exists(".");
    expect(result).toBe(true);
  });

  test("returns false for nonexistent path", async () => {
    const result = await exists("/nonexistent/file/that/does/not/exist/xyz123");
    expect(result).toBe(false);
  });

  test("returns false for deleted file", async () => {
    const testFile = join(tmpdir(), `test-${Date.now()}.txt`);
    writeFileSync(testFile, "test");
    expect(await exists(testFile)).toBe(true);
    unlinkSync(testFile);
    expect(await exists(testFile)).toBe(false);
  });
});

describe("placeholder substitution", () => {
  test("template.replaceAll substitutes correctly", () => {
    const template = "name: Deploy __PACKAGE_NAME__\nservice: __PACKAGE_NAME__";
    const placeholder = "__PACKAGE_NAME__";
    const packageName = "showcase";
    const result = template.replaceAll(placeholder, packageName);

    expect(result).toContain("name: Deploy showcase");
    expect(result).toContain("service: showcase");
  });

  test("substitutes multiple occurrences", () => {
    const template = "__PACKAGE_NAME__ __PACKAGE_NAME__ __PACKAGE_NAME__";
    const result = template.replaceAll("__PACKAGE_NAME__", "test");
    expect(result).toBe("test test test");
  });

  test("does not substitute if placeholder does not exist", () => {
    const template = "text without placeholder";
    const result = template.replaceAll("__PACKAGE_NAME__", "showcase");
    expect(result).toBe("text without placeholder");
  });
});

describe("getPackageNames", () => {
  test("lists existing directories", async () => {
    const { getPackageNames } = await import("../generate-workflows");
    const packages = await getPackageNames();
    // packages/ may be empty in a fresh fork — only validate type
    expect(Array.isArray(packages)).toBe(true);
  });

  test("returns names without directories", async () => {
    const { getPackageNames } = await import("../generate-workflows");
    const packages = await getPackageNames();
    packages.forEach((name) => {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    });
  });

  test("returns array of package names", async () => {
    const { getPackageNames } = await import("../generate-workflows");
    const packages = await getPackageNames();
    // Should return an array (may be empty if no packages exist)
    expect(Array.isArray(packages)).toBe(true);
  });

  test("returns only directory names", async () => {
    const { getPackageNames } = await import("../generate-workflows");
    const packages = await getPackageNames();
    // Verify it doesn't include files like .gitignore, package.json, etc
    expect(packages.every((p) => !p.includes("."))).toBe(true);
  });
});

describe("workflow substitution logic", () => {
  const PLACEHOLDER = "__PACKAGE_NAME__";

  test("substitutes all placeholder occurrences", () => {
    const template = `name: Deploy __PACKAGE_NAME__
service: __PACKAGE_NAME__
image: __PACKAGE_NAME__:latest`;
    const result = template.replaceAll(PLACEHOLDER, "my-service");
    expect(result).not.toContain(PLACEHOLDER);
    expect((result.match(/my-service/g) || []).length).toBe(3);
  });

  test("preserves template structure after substitution", () => {
    const template = `name: Deploy __PACKAGE_NAME__

env:
  SERVICE_NAME: __PACKAGE_NAME__

jobs:
  deploy:
    steps:
      - name: Deploy __PACKAGE_NAME__`;
    const result = template.replaceAll(PLACEHOLDER, "showcase");
    expect(result).toContain("name: Deploy showcase");
    expect(result).toContain("SERVICE_NAME: showcase");
    expect(result).toContain("- name: Deploy showcase");
    expect(result.includes("\nenv:\n")).toBe(true);
    expect(result.includes("\njobs:\n")).toBe(true);
  });

  test("works with names containing hyphens", () => {
    const template = "__PACKAGE_NAME__-workflow";
    const result = template.replaceAll(PLACEHOLDER, "my-package");
    expect(result).toBe("my-package-workflow");
  });

  test("substitutes lowercase placeholder correctly", () => {
    const template = "image: gcr.io/project/embark/__PACKAGE_NAME_LOWERCASE__:latest";
    const packageName = "myApp";
    const result = template
      .replaceAll(PLACEHOLDER, packageName)
      .replaceAll("__PACKAGE_NAME_LOWERCASE__", packageName.toLowerCase());

    expect(result).toBe("image: gcr.io/project/embark/myapp:latest");
    expect(result).not.toContain("__PACKAGE_NAME_LOWERCASE__");
  });

  test("substitutes both placeholders in a template", () => {
    const template = `name: Deploy __PACKAGE_NAME__
image: gcr.io/embark/__PACKAGE_NAME_LOWERCASE__:latest`;
    const packageName = "MyService";
    const result = template
      .replaceAll(PLACEHOLDER, packageName)
      .replaceAll("__PACKAGE_NAME_LOWERCASE__", packageName.toLowerCase());

    expect(result).toContain("name: Deploy MyService");
    expect(result).toContain("image: gcr.io/embark/myservice:latest");
  });
});

describe("processPackageWorkflow - I/O integration", () => {
  test("creates gcp workflow when it does not exist", async () => {
    const testDir = join(tmpdir(), `test-workflow-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("test-svc", "gcp", false, testDir);
      expect(result).toBe(true);

      const files = readdirSync(testDir);
      expect(files).toContain("test-svc.yml");

      const content = readFileSync(join(testDir, "test-svc.yml"), "utf-8");
      expect(content).toContain("name: Deploy test-svc");
      expect(content).toContain("IMAGE_NAME: test-svc");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("creates netlify workflow when it does not exist", async () => {
    const testDir = join(tmpdir(), `test-workflow-netlify-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-site", "netlify", false, testDir);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-site.yml"), "utf-8");
      expect(content).toContain("name: Deploy my-site");
      expect(content).toContain("Install Netlify CLI");
      expect(content).toContain("if: false"); // dns job disabled when cloudflareUse=false
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("adds cloudflare steps when cloudflareUse=true for netlify", async () => {
    const testDir = join(tmpdir(), `test-workflow-cf-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-site", "netlify", true, testDir);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-site.yml"), "utf-8");
      expect(content).toContain("if: true"); // dns job enabled when cloudflareUse=true
      expect(content).toContain("Get or Create subdomain on Cloudflare");
      expect(content).toContain("Register domain in Netlify");
      expect(content).toContain("needs: deploy"); // dns job depends on deploy
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("adds cloudflare steps when cloudflareUse=true for gcp", async () => {
    const testDir = join(tmpdir(), `test-workflow-gcp-cf-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-app", "gcp", true, testDir);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-app.yml"), "utf-8");
      expect(content).toContain("if: true"); // dns job enabled when cloudflareUse=true
      expect(content).toContain("Get or Create subdomain on Cloudflare");
      expect(content).not.toContain("Register domain in Netlify");
      expect(content).toContain("needs: deploy"); // dns job depends on deploy
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("generates cloudflare-pages workflow with DNS setup", async () => {
    const testDir = join(tmpdir(), `test-workflow-cf-pages-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-pages-app", "cloudflare-pages", true, testDir);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-pages-app.yml"), "utf-8");
      expect(content).toContain("Deploy to Cloudflare Pages");
      expect(content).toContain("CF_TOKEN_PAGES");
      expect(content).toContain("CF_ACCOUNT_ID");
      expect(content).toContain("Add Custom Domain to Cloudflare Pages");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("returns false if workflow already exists", async () => {
    const testDir = join(tmpdir(), `test-workflow-exist-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      writeFileSync(join(testDir, "test-svc.yml"), "name: existing");

      const result = await processPackageWorkflow("test-svc", "gcp", false, testDir);
      expect(result).toBe(false);

      // Verify original file was not modified
      const content = readFileSync(join(testDir, "test-svc.yml"), "utf-8");
      expect(content).toBe("name: existing");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("creates multiple workflows in sequence", async () => {
    const testDir = join(tmpdir(), `test-workflow-multiple-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result1 = await processPackageWorkflow("app1", "gcp", false, testDir);
      const result2 = await processPackageWorkflow("app2", "netlify", false, testDir);
      const result3 = await processPackageWorkflow("app1", "gcp", false, testDir); // Second time, should return false

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(false); // Already exists

      const files = readdirSync(testDir);
      expect(files).toContain("app1.yml");
      expect(files).toContain("app2.yml");
      expect(files.length).toBe(2);
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("adds submodules: recursive to checkout when useSubmodule=true", async () => {
    const testDir = join(tmpdir(), `test-workflow-submodules-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-app", "gcp", false, testDir, undefined, undefined, true);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-app.yml"), "utf-8");
      expect(content).toContain("submodules: recursive");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("gcp workflow has multi-job structure with outputs", async () => {
    const testDir = join(tmpdir(), `test-workflow-multijob-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      await processPackageWorkflow("my-svc", "gcp", false, testDir);
      const content = readFileSync(join(testDir, "my-svc.yml"), "utf-8");

      // Build job uploads artifact
      expect(content).toContain("actions/upload-artifact@v4");
      expect(content).toContain("name: build-my-svc");

      // Docker job downloads artifact and outputs image_url
      expect(content).toContain("actions/download-artifact@v4");
      expect(content).toContain("image_url: ${{ steps.push.outputs.image_url }}");

      // Deploy job uses docker output and outputs service_url
      expect(content).toContain("needs.docker.outputs.image_url");
      expect(content).toContain("service_url: ${{ steps.run.outputs.service_url }}");

      // DNS job uses deploy output
      expect(content).toContain("needs.deploy.outputs.service_url");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("netlify workflow has multi-job structure with outputs", async () => {
    const testDir = join(tmpdir(), `test-workflow-netlify-multijob-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      await processPackageWorkflow("my-site", "netlify", true, testDir);
      const content = readFileSync(join(testDir, "my-site.yml"), "utf-8");

      // Deploy job outputs site_id and site_url
      expect(content).toContain("site_id: ${{ steps.provision.outputs.site_id }}");
      expect(content).toContain("site_url: ${{ steps.provision.outputs.site_url }}");

      // DNS job receives them via needs.deploy.outputs
      expect(content).toContain("needs.deploy.outputs.site_id");
      expect(content).toContain("needs.deploy.outputs.site_url");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("cloudflare-pages workflow has multi-job structure with project_name output", async () => {
    const testDir = join(tmpdir(), `test-workflow-cfpages-multijob-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      await processPackageWorkflow("my-pages", "cloudflare-pages", true, testDir);
      const content = readFileSync(join(testDir, "my-pages.yml"), "utf-8");

      // Provision job outputs project_name
      expect(content).toContain("project_name: ${{ steps.project.outputs.project_name }}");

      // Deploy job uses provision output
      expect(content).toContain("needs.provision.outputs.project_name");

      // DNS job also uses provision output
      expect(content).toContain("needs: provision");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("generates cloudflare-workers workflow with DNS setup", async () => {
    const testDir = join(tmpdir(), `test-workflow-cf-workers-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-worker", "cloudflare-workers", true, testDir);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-worker.yml"), "utf-8");
      expect(content).toContain("Deploy to Cloudflare Workers");
      expect(content).toContain("CF_WORKER_TOKEN");
      expect(content).toContain("CF_ACCOUNT_ID");
      expect(content).toContain("Configure Custom Domain");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("cloudflare-workers workflow deploys directly without build/artifact", async () => {
    const testDir = join(tmpdir(), `test-workflow-cfworkers-multijob-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      await processPackageWorkflow("my-api", "cloudflare-workers", true, testDir);
      const content = readFileSync(join(testDir, "my-api.yml"), "utf-8");

      // No build/artifact — wrangler handles everything
      expect(content).not.toContain("actions/upload-artifact@v4");
      expect(content).not.toContain("actions/download-artifact@v4");

      // Deploy job uses wrangler directly
      expect(content).toContain("cloudflare/wrangler-action@v3");
      expect(content).toContain("command: deploy");
      expect(content).toContain("bun install");

      // DNS job depends on deploy
      expect(content).toContain("needs: deploy");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("does not include submodules when useSubmodule=false", async () => {
    const testDir = join(tmpdir(), `test-workflow-no-submodules-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-app", "gcp", false, testDir, undefined, undefined, false);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-app.yml"), "utf-8");
      expect(content).not.toContain("submodules: recursive");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("adds gitlink path entry to paths filter when useSubmodule=true", async () => {
    const testDir = join(tmpdir(), `test-workflow-submodule-path-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-app", "gcp", false, testDir, undefined, undefined, true);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-app.yml"), "utf-8");
      // Must have both the glob path (for file changes) and the gitlink path (for submodule ref updates)
      expect(content).toContain('- "packages/my-app/**"');
      expect(content).toContain('- "packages/my-app"');
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("does not add gitlink path entry when useSubmodule=false", async () => {
    const testDir = join(tmpdir(), `test-workflow-no-submodule-path-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const result = await processPackageWorkflow("my-app", "gcp", false, testDir, undefined, undefined, false);
      expect(result).toBe(true);

      const content = readFileSync(join(testDir, "my-app.yml"), "utf-8");
      expect(content).toContain('- "packages/my-app/**"');
      // Gitlink entry should not appear — only the glob path
      expect(content).not.toContain('- "packages/my-app"\n');
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("submodule path filter works for cloudflare-pages template", async () => {
    const testDir = join(tmpdir(), `test-workflow-submodule-cfpages-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      await processPackageWorkflow("my-pages", "cloudflare-pages", true, testDir, undefined, undefined, true);
      const content = readFileSync(join(testDir, "my-pages.yml"), "utf-8");

      expect(content).toContain('- "packages/my-pages/**"');
      expect(content).toContain('- "packages/my-pages"');
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });
});

describe("processPackagesWorkflows", () => {
  test("processes multiple packages and detects changes", async () => {
    const testDir = join(tmpdir(), `test-workflows-batch-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const packages: PackageWorkflowData[] = [
        { name: "app1", appDeployment: "gcp", cloudflareUse: false },
        { name: "app2", appDeployment: "netlify", cloudflareUse: false },
        { name: "app3", appDeployment: "gcp", cloudflareUse: false },
      ];

      const hasChanges = await processPackagesWorkflows(packages, testDir);

      expect(hasChanges).toBe(true);
      const files = readdirSync(testDir);
      expect(files).toContain("app1.yml");
      expect(files).toContain("app2.yml");
      expect(files).toContain("app3.yml");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("returns false when all workflows already exist", async () => {
    const testDir = join(tmpdir(), `test-workflows-exist-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const packages: PackageWorkflowData[] = [
        { name: "app1", appDeployment: "gcp", cloudflareUse: false },
        { name: "app2", appDeployment: "gcp", cloudflareUse: false },
      ];

      // First time creates the files
      await processPackagesWorkflows(packages, testDir);

      // Second time returns false since they already exist
      const hasChanges = await processPackagesWorkflows(packages, testDir);
      expect(hasChanges).toBe(false);
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("processes empty list without changes", async () => {
    const testDir = join(tmpdir(), `test-workflows-empty-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const packages: PackageWorkflowData[] = [];

      const hasChanges = await processPackagesWorkflows(packages, testDir);
      expect(hasChanges).toBe(false);

      const files = readdirSync(testDir);
      expect(files.length).toBe(0);
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });

  test("processes partially existing packages", async () => {
    const testDir = join(tmpdir(), `test-workflows-partial-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      // Create first workflow
      await processPackagesWorkflows(
        [{ name: "app1", appDeployment: "gcp", cloudflareUse: false }],
        testDir,
      );

      // Process list with existing and new
      const hasChanges = await processPackagesWorkflows(
        [
          { name: "app1", appDeployment: "gcp", cloudflareUse: false },
          { name: "app2", appDeployment: "netlify", cloudflareUse: false },
        ],
        testDir,
      );

      expect(hasChanges).toBe(true); // There was a change (app2 was created)

      const files = readdirSync(testDir);
      expect(files).toContain("app1.yml");
      expect(files).toContain("app2.yml");
    } finally {
      Bun.spawnSync(["rm", "-rf", testDir]);
    }
  });
});
