import { afterAll, afterEach, beforeAll, beforeEach, describe, test, expect } from "bun:test";
import { execSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addGitSubmodule,
  buildSubmoduleAddCommand,
  createPackageFiles,
  describeSubmoduleFailure,
  isGitHubUrl,
  type PackageCreationInput,
} from "../create-package";
import { gitEnv } from "../git-env";

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
    return execSync(`git ${args}`, { cwd, encoding: "utf-8", env: gitEnv() });
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
});

describe("isGitHubUrl", () => {
  test("recognizes GitHub HTTPS and SSH remotes", () => {
    expect(isGitHubUrl("https://github.com/opvibes/embark.git")).toBe(true);
    expect(isGitHubUrl("git@github.com:opvibes/embark.git")).toBe(true);
    expect(isGitHubUrl("ssh://git@github.com/opvibes/embark.git")).toBe(true);
  });

  test("rejects non-GitHub remotes and local paths", () => {
    expect(isGitHubUrl("https://gitlab.com/org/repo.git")).toBe(false);
    expect(isGitHubUrl("/home/user/repos/local-bare.git")).toBe(false);
    expect(isGitHubUrl("git@bitbucket.org:org/repo.git")).toBe(false);
  });
});

describe("describeSubmoduleFailure", () => {
  const url = "https://github.com/opvibes/private-repo.git";
  const command = buildSubmoduleAddCommand(url, "packages/privateRepo");

  test("passes through a non-auth failure untranslated (happy-path failures unaffected)", () => {
    const rawMessage = "fatal: destination path 'packages/privateRepo' already exists and is not an empty directory";

    const described = describeSubmoduleFailure(url, command, rawMessage);

    expect(described).toContain(rawMessage);
    expect(described).toContain(command);
    expect(described).not.toContain("GITHUB_TOKEN");
  });

  test.each([
    "remote: Repository not found.\nfatal: repository 'https://github.com/opvibes/private-repo.git/' not found",
    "fatal: Authentication failed for 'https://github.com/opvibes/private-repo.git/'",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "The requested URL returned error: 403",
  ])("translates a GitHub auth-shaped failure into an actionable message: %s", (rawMessage) => {
    const described = describeSubmoduleFailure(url, command, rawMessage);

    // the raw git output is still there — never swallowed
    expect(described).toContain(rawMessage);
    // but it now says what to do about it
    expect(described).toContain("GITHUB_TOKEN");
    expect(described).toContain("docs/github-secrets.md");
    expect(described).toContain(command);
  });

  test("gives a generic credential hint (no GITHUB_TOKEN) for a non-GitHub host", () => {
    const nonGitHubUrl = "https://gitlab.com/org/private-repo.git";
    const nonGitHubCommand = buildSubmoduleAddCommand(nonGitHubUrl, "packages/privateRepo");
    const rawMessage = "fatal: Authentication failed for 'https://gitlab.com/org/private-repo.git/'";

    const described = describeSubmoduleFailure(nonGitHubUrl, nonGitHubCommand, rawMessage);

    expect(described).toContain(rawMessage);
    expect(described).toContain("credential");
    expect(described).not.toContain("GITHUB_TOKEN");
  });
});
