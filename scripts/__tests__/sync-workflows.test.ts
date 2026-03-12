import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  generateExpectedContent,
  wasCustomized,
  getWorkflowNames,
  syncWorkflows,
  displayDiff,
  getSubdomainForPackage,
  selectOption,
  extractCustomBlocks,
  stripCustomBlocks,
  mergeCustomBlocksIntoTemplate,
  CUSTOM_BLOCK_START,
  CUSTOM_BLOCK_END,
} from "../sync-workflows";

const TEST_DIR = join(import.meta.dirname, "../..", ".test-sync");
const TEST_WORKFLOWS_DIR = join(TEST_DIR, ".github", "workflows");
const TEST_TEMPLATE = join(TEST_DIR, "templates", "workflow.template.yml");

async function exists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).exists();
    return true;
  } catch {
    return false;
  }
}

async function setupTest() {
  if (await exists(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  await mkdir(TEST_WORKFLOWS_DIR, { recursive: true });
  await mkdir(join(TEST_DIR, "templates"), { recursive: true });
}

async function teardownTest() {
  if (await exists(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe("sync-workflows", () => {
  describe("generateExpectedContent", () => {
    it("substitutes placeholders correctly", () => {
      const template = "name: Deploy __PACKAGE_NAME__\nservice: __PACKAGE_NAME_LOWERCASE__";
      const result = generateExpectedContent(template, "myPackage");

      expect(result).toContain("name: Deploy myPackage");
      expect(result).toContain("service: mypackage");
    });

    it("keeps template unchanged if no placeholder", () => {
      const template = "name: Deploy\nsteps: []";
      const result = generateExpectedContent(template, "myPackage");

      expect(result).toBe(template);
    });
  });

  describe("wasCustomized", () => {
    it("returns false when contents are equal", () => {
      const content = "name: Deploy\nsteps: []";
      const result = wasCustomized(content, content);

      expect(result).toBe(false);
    });

    it("returns true when contents differ", () => {
      const current = "name: Deploy\nsteps: []";
      const expected = "name: Deploy\nsteps: []\nextra: new";
      const result = wasCustomized(current, expected);

      expect(result).toBe(true);
    });
  });

  describe("displayDiff", () => {
    it("does not throw for identical content", () => {
      const content = "name: Deploy\nsteps: []";
      expect(() => displayDiff(content, content)).not.toThrow();
    });

    it("does not throw for different content (added lines)", () => {
      const current = "line1\nline2";
      const expected = "line1\nline2\nline3";
      expect(() => displayDiff(current, expected)).not.toThrow();
    });

    it("does not throw for different content (removed lines)", () => {
      const current = "line1\nline2\nline3";
      const expected = "line1\nline3";
      expect(() => displayDiff(current, expected)).not.toThrow();
    });

    it("does not throw for empty content", () => {
      expect(() => displayDiff("", "")).not.toThrow();
    });

    it("handles one side empty", () => {
      expect(() => displayDiff("line1\nline2", "")).not.toThrow();
      expect(() => displayDiff("", "line1\nline2")).not.toThrow();
    });
  });

  describe("getSubdomainForPackage", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("returns undefined when package has no config", async () => {
      await mkdir(join(TEST_DIR, "packages", "my-app"), { recursive: true });
      const result = await getSubdomainForPackage("my-app", join(TEST_DIR, "packages"));
      expect(result).toBeUndefined();
    });

    it("returns subdomain from config", async () => {
      const pkgDir = join(TEST_DIR, "packages", "my-app");
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        join(pkgDir, ".embark.jsonc"),
        JSON.stringify({
          deploy: { appDeployment: "gcp", cloudflareUse: false, workflowGen: true },
          name: "myApp",
          title: "My App",
          subdomain: "my-app",
          description: "Test app",
        }),
      );
      const result = await getSubdomainForPackage("my-app", join(TEST_DIR, "packages"));
      expect(result).toBe("my-app");
    });

    it("returns undefined when package dir does not exist", async () => {
      const result = await getSubdomainForPackage("nonexistent", join(TEST_DIR, "packages"));
      expect(result).toBeUndefined();
    });
  });

  describe("selectOption (non-TTY fallback with injected stream)", () => {
    it("returns index 0 when user picks '1'", async () => {
      const input = Readable.from(["1\n"]);
      const result = await selectOption(["Option A", "Option B", "Option C"], "Test", false, input);
      expect(result).toBe(0);
    });

    it("returns index 1 when user picks '2'", async () => {
      const input = Readable.from(["2\n"]);
      const result = await selectOption(["A", "B", "C"], "Pick", false, input);
      expect(result).toBe(1);
    });

    it("returns 0 for out-of-range input", async () => {
      const input = Readable.from(["99\n"]);
      const result = await selectOption(["A", "B"], "Pick", false, input);
      expect(result).toBe(0);
    });

    it("returns 0 for non-numeric input", async () => {
      const input = Readable.from(["abc\n"]);
      const result = await selectOption(["A", "B"], "Pick", false, input);
      expect(result).toBe(0);
    });

    it("returns last valid index for boundary value", async () => {
      const input = Readable.from(["3\n"]);
      const result = await selectOption(["A", "B", "C"], "Pick", false, input);
      expect(result).toBe(2);
    });

    it("returns 0 for empty input (default)", async () => {
      const input = Readable.from(["\n"]);
      const result = await selectOption(["A", "B"], "Pick", false, input);
      expect(result).toBe(0);
    });
  });

  describe("syncWorkflows with inputStream (fallback mode selection)", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("uses inputStream to pick 'all' mode when acceptAll and selectModeFn are undefined", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), "name: custom\ncustom: true");

      const input = Readable.from(["1\n"]);
      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        undefined,
        join(TEST_DIR, "packages"),
        undefined,
        undefined,
        input,
      );

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("approves workflow via inputStream when acceptAll=false and no approveCallback", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), "name: custom\ncustom: true");

      // acceptAll=false → one_by_one mode; inputStream provides "1\n" to approve
      const input = Readable.from(["1\n"]);
      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        false,
        join(TEST_DIR, "packages"),
        undefined,
        undefined,
        input,
      );

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("rejects workflow via inputStream when acceptAll=false and no approveCallback", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), "name: custom\ncustom: true");

      // acceptAll=false → one_by_one mode; inputStream provides "2\n" to reject
      const input = Readable.from(["2\n"]);
      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        false,
        join(TEST_DIR, "packages"),
        undefined,
        undefined,
        input,
      );

      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
    });
  });

  describe("syncWorkflows with selectModeFn", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("uses selectModeFn when acceptAll is undefined and workflows are customized", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), "name: custom\ncustom: true");

      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        undefined,
        join(TEST_DIR, "packages"),
        async () => true,
        async () => "all",
      );

      expect(result.updated).toBe(1);
    });

    it("selectModeFn returning one_by_one uses approveCallback", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), "name: custom\ncustom: true");

      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        undefined,
        join(TEST_DIR, "packages"),
        async () => false,
        async () => "one_by_one",
      );

      expect(result.skipped).toBe(1);
    });

    it("returns 0/0 when acceptAll is undefined and no customizations exist", async () => {
      const { buildWorkflowContent } = await import("../generate-workflows");
      const expected = await buildWorkflowContent("my-app", "netlify", false);
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), expected);

      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        undefined,
        join(TEST_DIR, "packages"),
        undefined,
        undefined,
      );

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe("getWorkflowNames", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("returns empty array if workflows dir does not exist", async () => {
      const result = await getWorkflowNames(join(TEST_DIR, "nonexistent-dir"));
      expect(result).toEqual([]);
    });

    it("returns empty array if no workflows", async () => {
      const result = await getWorkflowNames(TEST_WORKFLOWS_DIR);
      expect(result).toEqual([]);
    });

    it("returns workflow names without .yml", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "showcase.yml"), "");
      await writeFile(join(TEST_WORKFLOWS_DIR, "dashboard.yml"), "");

      const result = await getWorkflowNames(TEST_WORKFLOWS_DIR);
      expect(result.sort()).toEqual(["dashboard", "showcase"]);
    });

    it("ignores non-.yml files", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "showcase.yml"), "");
      await writeFile(join(TEST_WORKFLOWS_DIR, "README.md"), "");

      const result = await getWorkflowNames(TEST_WORKFLOWS_DIR);
      expect(result).toEqual(["showcase"]);
    });
  });

  describe("syncWorkflows", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    // These tests use a custom packagesDir (TEST_DIR/packages) with no packages,
    // so getExpectedContentForPackage defaults to netlify without cloudflare.

    it("returns 0 updated and 0 skipped when workflows match expected content", async () => {
      // Use a workflow name that has no package config → defaults to netlify/no-cf
      const { buildWorkflowContent } = await import("../generate-workflows");
      const expectedContent = await buildWorkflowContent("my-app", "netlify", false);

      await writeFile(TEST_TEMPLATE, expectedContent);
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), expectedContent);

      const result = await syncWorkflows(TEST_WORKFLOWS_DIR, TEST_TEMPLATE, true, join(TEST_DIR, "packages"));

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("detects customized workflow and updates it", async () => {
      const customizedContent = "name: Deploy my-app\ncustom: true";
      await writeFile(TEST_TEMPLATE, customizedContent);
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), customizedContent);

      const result = await syncWorkflows(TEST_WORKFLOWS_DIR, TEST_TEMPLATE, true, join(TEST_DIR, "packages"));

      // my-app has no config, so expected = netlify template (different from customized)
      expect(result.updated).toBe(1);
    });

    it("returns 0 when no workflows exist", async () => {
      const result = await syncWorkflows(TEST_WORKFLOWS_DIR, TEST_TEMPLATE, true, join(TEST_DIR, "packages"));

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("overwrites customized workflows when acceptAll is true", async () => {
      const customizedContent = "name: Deploy my-site\ncustom: true";
      await writeFile(TEST_TEMPLATE, customizedContent);
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-site.yml"), customizedContent);

      const result = await syncWorkflows(TEST_WORKFLOWS_DIR, TEST_TEMPLATE, true, join(TEST_DIR, "packages"));

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("detects multiple customized workflows", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "app1.yml"), "name: Deploy app1\ncustom: 1");
      await writeFile(join(TEST_WORKFLOWS_DIR, "app2.yml"), "name: Deploy app2\ncustom: 2");

      const result = await syncWorkflows(TEST_WORKFLOWS_DIR, TEST_TEMPLATE, true, join(TEST_DIR, "packages"));

      expect(result.updated).toBe(2);
    });

    it("one_by_one mode: approves workflow via approveCallback", async () => {
      const customizedContent = "name: Deploy my-app\ncustom: true";
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), customizedContent);

      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        false,
        join(TEST_DIR, "packages"),
        async () => true,
      );

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("one_by_one mode: skips workflow when approveCallback returns false", async () => {
      const customizedContent = "name: Deploy my-app\ncustom: true";
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), customizedContent);

      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        false,
        join(TEST_DIR, "packages"),
        async () => false,
      );

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it("one_by_one mode: mixed approve/skip via approveCallback", async () => {
      await writeFile(join(TEST_WORKFLOWS_DIR, "app1.yml"), "name: app1\ncustom: 1");
      await writeFile(join(TEST_WORKFLOWS_DIR, "app2.yml"), "name: app2\ncustom: 2");

      const decisions: Record<string, boolean> = { app1: true, app2: false };
      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        false,
        join(TEST_DIR, "packages"),
        async (workflow) => decisions[workflow] ?? false,
      );

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it("one_by_one mode: skips workflows already matching expected content", async () => {
      const { buildWorkflowContent } = await import("../generate-workflows");
      const expectedContent = await buildWorkflowContent("my-app", "netlify", false);
      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), expectedContent);

      const approveCallback = async () => true;
      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        false,
        join(TEST_DIR, "packages"),
        approveCallback,
      );

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe("extractCustomBlocks", () => {
    it("returns empty array when no custom blocks", () => {
      const content = "name: Deploy\nsteps: []";
      expect(extractCustomBlocks(content)).toEqual([]);
    });

    it("extracts a single custom block with preceding line", () => {
      const content = `name: Deploy myapp\n${CUSTOM_BLOCK_START}\n- custom step\n${CUSTOM_BLOCK_END}\non: push`;
      const blocks = extractCustomBlocks(content);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.content).toContain("custom step");
      expect(blocks[0]!.precedingLine).toBe("name: Deploy myapp");
    });

    it("extracts multiple custom blocks", () => {
      const content = `line1\n${CUSTOM_BLOCK_START}\nblock1\n${CUSTOM_BLOCK_END}\nline2\n${CUSTOM_BLOCK_START}\nblock2\n${CUSTOM_BLOCK_END}`;
      const blocks = extractCustomBlocks(content);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.content).toContain("block1");
      expect(blocks[1]!.content).toContain("block2");
    });
  });

  describe("stripCustomBlocks", () => {
    it("returns content unchanged when no custom blocks", () => {
      const content = "name: Deploy\nsteps: []";
      expect(stripCustomBlocks(content)).toBe(content);
    });

    it("removes custom block markers and content", () => {
      const content = `before\n${CUSTOM_BLOCK_START}\nremoved\n${CUSTOM_BLOCK_END}\nafter`;
      const result = stripCustomBlocks(content);
      expect(result).not.toContain(CUSTOM_BLOCK_START);
      expect(result).not.toContain("removed");
      expect(result).toContain("before");
      expect(result).toContain("after");
    });
  });

  describe("mergeCustomBlocksIntoTemplate", () => {
    it("returns template unchanged when no custom blocks", () => {
      const template = "name: Deploy\nsteps: []";
      expect(mergeCustomBlocksIntoTemplate(template, [])).toBe(template);
    });

    it("re-inserts custom block after preceding line", () => {
      const template = "line1\nline2\nline3";
      const blocks = [{ content: `${CUSTOM_BLOCK_START}\ncustom\n${CUSTOM_BLOCK_END}`, precedingLine: "line1" }];
      const result = mergeCustomBlocksIntoTemplate(template, blocks);
      const lines = result.split("\n");
      const idx = lines.indexOf("line1");
      expect(lines[idx + 1]).toBe(CUSTOM_BLOCK_START);
    });

    it("appends custom block at end when preceding line not found", () => {
      const template = "line1\nline2";
      const blocks = [{ content: `${CUSTOM_BLOCK_START}\ncustom\n${CUSTOM_BLOCK_END}`, precedingLine: "nonexistent" }];
      const result = mergeCustomBlocksIntoTemplate(template, blocks);
      expect(result).toContain("custom");
      expect(result.indexOf("custom")).toBeGreaterThan(result.indexOf("line2"));
    });
  });

  describe("syncWorkflows with EMBARK:CUSTOM blocks", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("does not trigger sync when only custom blocks differ from template", async () => {
      const { buildWorkflowContent } = await import("../generate-workflows");
      const templateContent = await buildWorkflowContent("my-app", "netlify", false);
      // Add a custom block to the template content (simulates user customization)
      const withCustom = templateContent + `\n${CUSTOM_BLOCK_START}\n# my custom thing\n${CUSTOM_BLOCK_END}\n`;

      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), withCustom);

      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        true,
        join(TEST_DIR, "packages"),
      );

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("preserves custom blocks when template changes", async () => {
      const { buildWorkflowContent } = await import("../generate-workflows");
      const templateContent = await buildWorkflowContent("my-app", "netlify", false);
      const customBlock = `${CUSTOM_BLOCK_START}\n# preserved content\n${CUSTOM_BLOCK_END}`;
      // Simulate: current file has old template + custom block (doesn't match new template)
      const currentWithCustom = "name: old-template-content\n" + customBlock;

      await writeFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), currentWithCustom);

      const result = await syncWorkflows(
        TEST_WORKFLOWS_DIR,
        TEST_TEMPLATE,
        true,
        join(TEST_DIR, "packages"),
      );

      expect(result.updated).toBe(1);

      const writtenContent = await readFile(join(TEST_WORKFLOWS_DIR, "my-app.yml"), "utf-8");
      expect(writtenContent).toContain("preserved content");
      expect(writtenContent).toContain(CUSTOM_BLOCK_START);
    });
  });
});
