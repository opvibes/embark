import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  fileExists,
  removeDemoArtifacts,
  getCommitsBehind,
  hasMergeConflicts,
  getUpstreamUrl,
  buildSyncCommitMessage,
  syncUpstream,
} from "../sync-upstream";

const TEST_DIR = join(import.meta.dirname, "../..", ".test-sync-upstream");

async function setupTest() {
  await mkdir(TEST_DIR, { recursive: true });
  // Initialize a git repo so git doesn't traverse up to the parent repo
  // (which in forks may have an 'upstream' remote, breaking isolation)
  execSync("git init", { cwd: TEST_DIR, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: TEST_DIR, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: TEST_DIR, stdio: "ignore" });
}

async function teardownTest() {
  await rm(TEST_DIR, { recursive: true, force: true });
}

describe("sync-upstream", () => {
  describe("fileExists", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("returns true for existing file", async () => {
      const path = join(TEST_DIR, "test.txt");
      await writeFile(path, "hello");
      expect(await fileExists(path)).toBe(true);
    });

    it("returns false for missing file", async () => {
      expect(await fileExists(join(TEST_DIR, "nonexistent.txt"))).toBe(false);
    });

    it("returns true for existing directory", async () => {
      expect(await fileExists(TEST_DIR)).toBe(true);
    });
  });

  describe("getUpstreamUrl", () => {
    it("returns null when upstream remote does not exist", () => {
      // Use a temp dir without git remote
      const result = getUpstreamUrl(TEST_DIR);
      expect(result).toBeNull();
    });
  });

  describe("getCommitsBehind", () => {
    it("returns 0 when ref does not exist", () => {
      const result = getCommitsBehind(TEST_DIR, "nonexistent/branch");
      expect(result).toBe(0);
    });
  });

  describe("hasMergeConflicts", () => {
    it("returns false when not in a git repo with conflicts", () => {
      const result = hasMergeConflicts(TEST_DIR);
      expect(result).toBe(false);
    });
  });

  describe("buildSyncCommitMessage", () => {
    it("includes the sha in the commit message", () => {
      const msg = buildSyncCommitMessage("abc1234");
      expect(msg).toContain("abc1234");
      expect(msg).toContain("chore(upstream):");
    });

    it("produces a conventional commit format", () => {
      const msg = buildSyncCommitMessage("deadbee");
      expect(msg).toMatch(/^chore\(upstream\):/);
    });
  });

  describe("syncUpstream", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("throws when upstream remote does not exist", async () => {
      await expect(syncUpstream(TEST_DIR)).rejects.toThrow("No 'upstream' remote found");
    });

    it("error message includes setup instructions", async () => {
      try {
        await syncUpstream(TEST_DIR);
      } catch (err) {
        expect((err as Error).message).toContain("git remote add upstream");
      }
    });

    it("returns 'up-to-date' when no new commits in upstream", async () => {
      const repoDir = join(TEST_DIR, "repo");
      const upstreamDir = join(TEST_DIR, "upstream.git");

      // Create bare upstream repo
      execSync(`git init --bare "${upstreamDir}"`, { stdio: "ignore" });

      // Clone into repo dir
      execSync(`git clone "${upstreamDir}" "${repoDir}"`, { stdio: "ignore" });

      // Add upstream remote pointing to bare repo
      execSync(`git remote add upstream "${upstreamDir}"`, { cwd: repoDir, stdio: "ignore" });

      const result = await syncUpstream(repoDir);
      expect(result).toBe("up-to-date");
    });

  });

  describe("removeDemoArtifacts", () => {
    beforeEach(setupTest);
    afterEach(teardownTest);

    it("returns empty array when no demo artifacts exist", async () => {
      const removed = await removeDemoArtifacts(TEST_DIR);
      expect(removed).toEqual([]);
    });

    it("removes packages/embark when it exists", async () => {
      const demoDir = join(TEST_DIR, "packages", "embark");
      await mkdir(demoDir, { recursive: true });
      await writeFile(join(demoDir, "index.ts"), "// demo");

      const removed = await removeDemoArtifacts(TEST_DIR);
      expect(removed).toContain("packages/embark");
      expect(await fileExists(demoDir)).toBe(false);
    });

    it("removes .github/workflows/embark.yml when it exists", async () => {
      const workflowDir = join(TEST_DIR, ".github", "workflows");
      await mkdir(workflowDir, { recursive: true });
      const workflowFile = join(workflowDir, "embark.yml");
      await writeFile(workflowFile, "name: embark");

      const removed = await removeDemoArtifacts(TEST_DIR);
      expect(removed).toContain(".github/workflows/embark.yml");
      expect(await fileExists(workflowFile)).toBe(false);
    });

    it("removes both artifacts when both exist", async () => {
      const demoDir = join(TEST_DIR, "packages", "embark");
      await mkdir(demoDir, { recursive: true });
      await writeFile(join(demoDir, "index.ts"), "// demo");

      const workflowDir = join(TEST_DIR, ".github", "workflows");
      await mkdir(workflowDir, { recursive: true });
      await writeFile(join(workflowDir, "embark.yml"), "name: embark");

      const removed = await removeDemoArtifacts(TEST_DIR);
      expect(removed).toHaveLength(2);
      expect(removed).toContain("packages/embark");
      expect(removed).toContain(".github/workflows/embark.yml");
    });
  });
});
