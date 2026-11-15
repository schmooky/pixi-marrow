/**
 * Conventional Commits: <type>(<scope>)!: <subject>
 *   feat(render): draw a slot that screens in the batch
 *   fix(pose): keep the stamp of a bone that a slider writes
 *   docs(site): explain how a batch ends
 * The scope is optional. It names a layer of the library (formats, pose, geometry, render, api),
 * an entry point (bake, debug, perf, optimize) or a part of the repo (site, scripts, ci).
 * `!` or a `BREAKING CHANGE:` footer marks a breaking change (changeset needs `major`).
 *
 * CI lints the commits of a pull request and its title: a squash merge makes the title the commit
 * message on main.
 */
module.exports = {
    extends: ['@commitlint/config-conventional'],
    ignores: [
        (commit) => /\[bot\]@users\.noreply\.github\.com/i.test(commit),
        (commit) => /^Bumps? \S+ from \S+ to \S+/.test(commit),
    ],
    rules: {
        'type-enum': [
            2,
            'always',
            ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'],
        ],
        'subject-case': [0],
        'header-max-length': [0],
        'body-max-line-length': [0],
        'footer-max-line-length': [0],
    },
};
