import { afterAll, afterEach, beforeAll, beforeEach, describe, test, expect } from "bun:test";
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addGitSubmodule,
  buildSubmoduleAddCommand,
  createPackage,
  createPackageFiles,
  type PackageCreationInput,
  type PromptFn,
} from "../create-package";

function scriptedPrompt(answers: string[]): PromptFn {
  const queue = [...answers];
  return async (question: string) => {
    if (queue.length === 0) {
      throw new Error(`No scripted answer left for prompt: ${question}`);
    }
    return queue.shift() as string;
  };
}

describe("package name validation", () => {
  function validateCamelCase(name: string): boolean {
    return /^[a-z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*$/.test(name);
  }

  function convertToCamelCase(name: string): string {
    return name
      .split("-")
      .map((part, idx) =>
        idx === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
      )
      .join("");
  }

  test("validates valid camelCase names", () => {
    expect(validateCamelCase("myPackage")).toBe(true);
    expect(validateCamelCase("showcase")).toBe(true);
    expect(validateCamelCase("calculator")).toBe(true);
  });

  test("validates valid kebab-case names", () => {
    expect(validateCamelCase("my-package")).toBe(true);
    expect(validateCamelCase("new-package-test")).toBe(true);
    expect(validateCamelCase("app-test")).toBe(true);
  });

  test("rejects invalid names", () => {
    expect(validateCamelCase("My-Package")).toBe(false); // Starts with uppercase
    expect(validateCamelCase("my_package")).toBe(false); // Uses underscore
    expect(validateCamelCase("my package")).toBe(false); // Has space
    expect(validateCamelCase("123-package")).toBe(false); // Starts with number
    expect(validateCamelCase("")).toBe(false); // Empty
  });

  test("converts kebab-case to camelCase", () => {
    expect(convertToCamelCase("my-package")).toBe("myPackage");
    expect(convertToCamelCase("new-test-package")).toBe("newTestPackage");
    expect(convertToCamelCase("showcase")).toBe("showcase");
  });

  test("keeps valid camelCase as-is", () => {
    expect(convertToCamelCase("myPackage")).toBe("myPackage");
    expect(convertToCamelCase("calculator")).toBe("calculator");
  });
});

describe("subdomain validation", () => {
  function validateSubdomain(subdomain: string): boolean {
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain);
  }

  test("validates valid subdomains", () => {
    expect(validateSubdomain("showcase")).toBe(true);
    expect(validateSubdomain("my-app")).toBe(true);
    expect(validateSubdomain("app123")).toBe(true);
    expect(validateSubdomain("a")).toBe(true);
    expect(validateSubdomain("a1")).toBe(true);
  });

  test("rejects invalid subdomains", () => {
    expect(validateSubdomain("My-App")).toBe(false); // Has uppercase
    expect(validateSubdomain("-app")).toBe(false); // Starts with hyphen
    expect(validateSubdomain("app-")).toBe(false); // Ends with hyphen
    expect(validateSubdomain("my_app")).toBe(false); // Has underscore
    expect(validateSubdomain("my app")).toBe(false); // Has space
    expect(validateSubdomain("")).toBe(false); // Empty
  });

  test("validates subdomains with max length", () => {
    const maxLength = "a".repeat(63);
    expect(validateSubdomain(maxLength)).toBe(true);

    const tooLong = "a".repeat(64);
    expect(validateSubdomain(tooLong)).toBe(false);
  });
});

describe("buildSubmoduleAddCommand", () => {
  test("formats the exact git command with URL and path", () => {
    expect(buildSubmoduleAddCommand("git@github.com:org/repo.git", "packages/foo")).toBe(
      "git submodule add git@github.com:org/repo.git packages/foo",
    );
  });
});

describe("Git submodule wiring", () => {
  // Local file:// submodules are used so the tests are hermetic (no network).
  // This git install disables the file transport by default; allow it just for these tests.
  const originalAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;

  function git(cwd: string, args: string): string {
    return execSync(`git ${args}`, { cwd, encoding: "utf-8" });
  }

  async function initRepoWithCommit(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    git(dir, "init -q");
    git(dir, "config user.email test@example.com");
    git(dir, "config user.name test");
    git(dir, "commit -q --allow-empty -m init");
  }

  async function initBareRemoteWithCommit(bareDir: string, seedDir: string): Promise<void> {
    git(tmpdir(), `init -q --bare ${bareDir}`);
    await mkdir(seedDir, { recursive: true });
    git(seedDir, "init -q");
    git(seedDir, "config user.email test@example.com");
    git(seedDir, "config user.name test");
    await writeFile(join(seedDir, "README.md"), "seed\n");
    git(seedDir, "add README.md");
    git(seedDir, "commit -q -m seed");
    git(seedDir, `remote add origin ${bareDir}`);
    const branch = git(seedDir, "symbolic-ref --short HEAD").trim();
    git(seedDir, `push -q origin ${branch}`);
  }

  async function readEmbarkConfigFile(packageDir: string): Promise<Record<string, unknown>> {
    const raw = await readFile(join(packageDir, ".embark.jsonc"), "utf-8");
    const withoutComments = raw.replace(/\/\/.*$/gm, "");
    return JSON.parse(withoutComments);
  }

  function baseInput(overrides: Partial<PackageCreationInput> = {}): PackageCreationInput {
    return {
      camelCaseName: "testPkg",
      title: "Test Package",
      description: "A test package",
      rootDomain: false,
      subdomain: "test-pkg",
      appDeployment: "gcp",
      workflowGen: true,
      cloudflareUse: true,
      useSubmodule: false,
      submoduleUrl: "",
      ...overrides,
    };
  }

  beforeAll(() => {
    process.env.GIT_ALLOW_PROTOCOL = "file";
  });

  afterAll(() => {
    if (originalAllowProtocol === undefined) {
      delete process.env.GIT_ALLOW_PROTOCOL;
    } else {
      process.env.GIT_ALLOW_PROTOCOL = originalAllowProtocol;
    }
  });

  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "embark-submodule-test-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe("answering no (unchanged behaviour)", () => {
    test("scaffolds files, writes .embark.jsonc, and stages them with git add", async () => {
      const repoRoot = join(workDir, "root");
      const packagesDir = join(repoRoot, "packages");
      await initRepoWithCommit(repoRoot);
      await mkdir(packagesDir, { recursive: true });

      const result = await createPackageFiles(baseInput(), packagesDir, repoRoot);

      expect(result.wiredAsSubmodule).toBe(false);
      const pkgDir = join(packagesDir, "testPkg");

      await expect(readFile(join(pkgDir, "package.json"), "utf-8")).resolves.toContain(
        "@embark/testPkg",
      );
      await expect(readFile(join(pkgDir, "src", "index.ts"), "utf-8")).resolves.toContain(
        "Hello from testPkg",
      );
      await expect(readFile(join(pkgDir, "tsconfig.json"), "utf-8")).resolves.toBeString();

      const config = await readEmbarkConfigFile(pkgDir);
      expect(config.useSubmodule).toBe(false);
      expect(config.name).toBe("testPkg");

      const status = git(repoRoot, "status --porcelain");
      expect(status).toContain("packages/testPkg/package.json");

      // no submodule side effects on the "no" path
      const submoduleStatus = git(repoRoot, "submodule status");
      expect(submoduleStatus.trim()).toBe("");
    });

    test("writes netlify.toml only for the netlify deploy target", async () => {
      const repoRoot = join(workDir, "root");
      const packagesDir = join(repoRoot, "packages");
      await initRepoWithCommit(repoRoot);
      await mkdir(packagesDir, { recursive: true });

      await createPackageFiles(
        baseInput({ appDeployment: "netlify" }),
        packagesDir,
        repoRoot,
      );

      await expect(
        readFile(join(packagesDir, "testPkg", "netlify.toml"), "utf-8"),
      ).resolves.toContain('publish = "dist"');
    });
  });

  describe("answering yes (real submodule wiring)", () => {
    test("runs git submodule add and only writes .embark.jsonc — no scaffold files", async () => {
      const repoRoot = join(workDir, "root");
      const packagesDir = join(repoRoot, "packages");
      const bareRemote = join(workDir, "remote.git");
      const seedDir = join(workDir, "seed");
      await initRepoWithCommit(repoRoot);
      await initBareRemoteWithCommit(bareRemote, seedDir);

      const result = await createPackageFiles(
        baseInput({ useSubmodule: true, submoduleUrl: bareRemote }),
        packagesDir,
        repoRoot,
      );

      expect(result.wiredAsSubmodule).toBe(true);
      const pkgDir = join(packagesDir, "testPkg");

      const gitmodules = await readFile(join(repoRoot, ".gitmodules"), "utf-8");
      expect(gitmodules).toContain("packages/testPkg");

      const submoduleStatus = git(repoRoot, "submodule status");
      expect(submoduleStatus).toContain("packages/testPkg");

      const config = await readEmbarkConfigFile(pkgDir);
      expect(config.useSubmodule).toBe(true);
      expect(config.name).toBe("testPkg");

      // content belongs to the submodule's own repo — no monorepo scaffold
      await expect(readFile(join(pkgDir, "package.json"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(pkgDir, "src", "index.ts"), "utf-8")).rejects.toThrow();

      // the submodule's own content was actually cloned in
      await expect(readFile(join(pkgDir, "README.md"), "utf-8")).resolves.toContain("seed");
    });

    test("a failed git submodule add throws and leaves no half-wired state", async () => {
      const repoRoot = join(workDir, "root");
      const packagesDir = join(repoRoot, "packages");
      // an empty bare repo has an unborn HEAD — `git submodule add` clones it
      // then fails to check anything out, which is a deterministic, network-free
      // way to exercise the failure path.
      const emptyBareRemote = join(workDir, "empty-remote.git");
      await initRepoWithCommit(repoRoot);
      git(tmpdir(), `init -q --bare ${emptyBareRemote}`);

      await expect(
        createPackageFiles(
          baseInput({ useSubmodule: true, submoduleUrl: emptyBareRemote }),
          packagesDir,
          repoRoot,
        ),
      ).rejects.toThrow();

      const pkgDir = join(packagesDir, "testPkg");
      await expect(readFile(join(pkgDir, ".embark.jsonc"), "utf-8")).rejects.toThrow();
      await expect(readFile(join(repoRoot, ".gitmodules"), "utf-8")).rejects.toThrow();

      const submoduleStatus = git(repoRoot, "submodule status");
      expect(submoduleStatus.trim()).toBe("");

      const status = git(repoRoot, "status --porcelain");
      expect(status).not.toContain("testPkg");
    });
  });

  describe("addGitSubmodule error message", () => {
    test("includes the exact command to re-run manually", async () => {
      const repoRoot = join(workDir, "root");
      await initRepoWithCommit(repoRoot);
      const bogusUrl = join(workDir, "does-not-exist.git");

      let caught: unknown;
      try {
        await addGitSubmodule(bogusUrl, "packages/bogus", repoRoot);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toContain(
        `git submodule add ${bogusUrl} packages/bogus`,
      );
    });
  });

  describe("createPackage — full interactive flow", () => {
    test("answering no scaffolds a normal package (unchanged behaviour)", async () => {
      const repoRoot = join(workDir, "root");
      const packagesDir = join(repoRoot, "packages");
      await initRepoWithCommit(repoRoot);
      await mkdir(packagesDir, { recursive: true });

      const prompt = scriptedPrompt([
        "flowNoPkg", // name
        "Flow No Package", // title
        "A description", // description
        "n", // root domain? no
        "flow-no-pkg", // subdomain
        "1", // deploy target: gcp
        "y", // auto-generate workflow
        "n", // use Git submodules? no
        "n", // use Cloudflare
      ]);

      await createPackage(prompt, packagesDir, repoRoot);

      const pkgDir = join(packagesDir, "flowNoPkg");
      await expect(readFile(join(pkgDir, "package.json"), "utf-8")).resolves.toContain(
        "@embark/flowNoPkg",
      );
      await expect(readFile(join(pkgDir, "src", "index.ts"), "utf-8")).resolves.toContain(
        "Hello from flowNoPkg",
      );

      const config = await readEmbarkConfigFile(pkgDir);
      expect(config.useSubmodule).toBe(false);
      expect(config.subdomain).toBe("flow-no-pkg");

      const submoduleStatus = git(repoRoot, "submodule status");
      expect(submoduleStatus.trim()).toBe("");
    });

    test("answering yes prompts for a URL and wires a real submodule", async () => {
      const repoRoot = join(workDir, "root");
      const packagesDir = join(repoRoot, "packages");
      const bareRemote = join(workDir, "remote.git");
      const seedDir = join(workDir, "seed");
      await initRepoWithCommit(repoRoot);
      await initBareRemoteWithCommit(bareRemote, seedDir);

      const prompt = scriptedPrompt([
        "flowYesPkg", // name
        "Flow Yes Package", // title
        "A description", // description
        "n", // root domain? no
        "flow-yes-pkg", // subdomain
        "1", // deploy target: gcp
        "y", // auto-generate workflow
        "y", // use Git submodules? yes
        bareRemote, // submodule Git URL
        "n", // use Cloudflare
      ]);

      await createPackage(prompt, packagesDir, repoRoot);

      const pkgDir = join(packagesDir, "flowYesPkg");

      const gitmodules = await readFile(join(repoRoot, ".gitmodules"), "utf-8");
      expect(gitmodules).toContain("packages/flowYesPkg");

      const submoduleStatus = git(repoRoot, "submodule status");
      expect(submoduleStatus).toContain("packages/flowYesPkg");

      const config = await readEmbarkConfigFile(pkgDir);
      expect(config.useSubmodule).toBe(true);

      await expect(readFile(join(pkgDir, "package.json"), "utf-8")).rejects.toThrow();
    });
  });
});
