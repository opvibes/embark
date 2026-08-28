import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "../git-env";

describe("gitEnv", () => {
  it("strips git-location env vars from the base env", () => {
    const contaminated = {
      GIT_DIR: "/somewhere/.git",
      GIT_WORK_TREE: "/somewhere",
      GIT_INDEX_FILE: "/somewhere/.git/index",
      GIT_COMMON_DIR: "/somewhere/.git",
      GIT_CEILING_DIRECTORIES: "/somewhere",
      GIT_OBJECT_DIRECTORY: "/somewhere/.git/objects",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/elsewhere/.git/objects",
      PATH: "/usr/bin",
    };

    const cleaned = gitEnv({}, contaminated);

    expect(cleaned.GIT_DIR).toBeUndefined();
    expect(cleaned.GIT_WORK_TREE).toBeUndefined();
    expect(cleaned.GIT_INDEX_FILE).toBeUndefined();
    expect(cleaned.GIT_COMMON_DIR).toBeUndefined();
    expect(cleaned.GIT_CEILING_DIRECTORIES).toBeUndefined();
    expect(cleaned.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(cleaned.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBeUndefined();
    expect(cleaned.PATH).toBe("/usr/bin");
  });

  it("leaves GIT_PREFIX untouched (verified harmless — see comment in git-env.ts)", () => {
    const cleaned = gitEnv({}, { GIT_PREFIX: "some/prefix/" });
    expect(cleaned.GIT_PREFIX).toBe("some/prefix/");
  });

  it("keeps unrelated env vars intact", () => {
    const cleaned = gitEnv({}, { GIT_ALLOW_PROTOCOL: "file", HOME: "/home/test" });
    expect(cleaned.GIT_ALLOW_PROTOCOL).toBe("file");
    expect(cleaned.HOME).toBe("/home/test");
  });

  it("applies overrides on top of the sanitized base, even overriding a stripped key", () => {
    const cleaned = gitEnv({ GIT_ALLOW_PROTOCOL: "file" }, { GIT_DIR: "/bad", FOO: "bar" });
    expect(cleaned.GIT_DIR).toBeUndefined();
    expect(cleaned.GIT_ALLOW_PROTOCOL).toBe("file");
    expect(cleaned.FOO).toBe("bar");
  });

  it("does not mutate the base env object passed in", () => {
    const base = { GIT_DIR: "/bad", FOO: "bar" };
    gitEnv({}, base);
    expect(base.GIT_DIR).toBe("/bad");
  });

  describe("integration: neutralizes a contaminated GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE", () => {
    async function initRepoWithCommit(dir: string): Promise<void> {
      await mkdir(dir, { recursive: true });
      execSync("git init -q", { cwd: dir, env: gitEnv() });
      execSync("git config user.email test@example.com", { cwd: dir, env: gitEnv() });
      execSync("git config user.name test", { cwd: dir, env: gitEnv() });
      execSync("git commit -q --allow-empty -m init", { cwd: dir, env: gitEnv() });
    }

    function headSha(dir: string): string {
      return execSync("git rev-parse HEAD", { cwd: dir, env: gitEnv() }).toString().trim();
    }

    it("a fixture git command run under a contaminated env never touches the decoy repo", async () => {
      const workDir = await mkdtemp(join(tmpdir(), "embark-git-env-test-"));
      const decoyRepo = join(workDir, "decoy");
      const fixtureDir = join(workDir, "fixture");

      await initRepoWithCommit(decoyRepo);
      const decoyShaBefore = headSha(decoyRepo);

      await mkdir(fixtureDir, { recursive: true });

      // Deliberately contaminate the env the way a git hook (or an external
      // multi-worktree wrapper) would, pointing GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE
      // at the decoy repo — the exact reproduction from the failing pushes.
      const contaminated = {
        ...process.env,
        GIT_DIR: join(decoyRepo, ".git"),
        GIT_WORK_TREE: decoyRepo,
        GIT_INDEX_FILE: join(decoyRepo, ".git", "index"),
        GIT_PREFIX: "",
      };

      // Without gitEnv() this would create the commit in `decoyRepo` instead of `fixtureDir`
      // (GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE win over `cwd`) — this is the RED reproduction.
      execSync("git init -q", { cwd: fixtureDir, env: gitEnv({}, contaminated) });
      execSync("git config user.email test@example.com", { cwd: fixtureDir, env: gitEnv({}, contaminated) });
      execSync("git config user.name test", { cwd: fixtureDir, env: gitEnv({}, contaminated) });
      execSync("git commit -q --allow-empty -m fixture-commit", {
        cwd: fixtureDir,
        env: gitEnv({}, contaminated),
      });

      const fixtureSha = headSha(fixtureDir);
      const decoyShaAfter = headSha(decoyRepo);

      // the decoy repo (what the contaminated env points at) was not touched
      expect(decoyShaAfter).toBe(decoyShaBefore);
      // the fixture repo (what `cwd` points at) got its own independent commit
      expect(fixtureSha).not.toBe(decoyShaBefore);

      await rm(workDir, { recursive: true, force: true });
    });
  });
});
