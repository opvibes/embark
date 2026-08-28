/**
 * Env vars git uses to locate the repository, index, and object store — they
 * take precedence over an explicit `cwd` passed to a git subprocess. A git
 * hook (or an external multi-worktree orchestration wrapper) can export
 * these pointing at a *different* repository; inheriting them blindly turns
 * a spawned git command's `cwd` into a suggestion instead of a guarantee,
 * silently redirecting reads/writes onto the wrong working tree.
 *
 * `GIT_PREFIX` is deliberately excluded: it only tells a script the
 * subdirectory git was originally invoked from (for scripts/hooks that
 * reconstruct pathspecs), and does not affect where a git subprocess with
 * an explicit `cwd` resolves its repository — verified empirically: setting
 * only `GIT_PREFIX` to a bogus value does not redirect `git init`/`git
 * commit` away from `cwd`, unlike the vars below.
 */
const GIT_LOCATION_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_CEILING_DIRECTORIES",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

/**
 * Returns an env object safe to pass to any git subprocess: a copy of
 * `process.env` (or `base`, for tests) with the git-location variables
 * above stripped, plus any `overrides` applied on top. Every git
 * `execSync`/`spawnSync` call in this repo must use this instead of
 * inheriting `process.env` directly.
 */
export function gitEnv(
  overrides: NodeJS.ProcessEnv = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of GIT_LOCATION_ENV_VARS) {
    delete env[key];
  }
  Object.assign(env, overrides);
  return env;
}
