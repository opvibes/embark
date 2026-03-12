/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    // Git merge commits (local branch merges, upstream merges)
    (commit) => /^Merge\b/i.test(commit),
    // GitHub PR merge commits
    (commit) => /^Merge pull request\b/i.test(commit),
    // Revert commits
    (commit) => /^Revert\b/i.test(commit),
    // Release version bumps (e.g. "v1.2.3" or "1.2.3")
    (commit) => /^v?\d+\.\d+\.\d+/.test(commit),
  ],
};
