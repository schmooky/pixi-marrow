/**
 * Conventional Commits: <type>(<scope>)!: <subject>
 *   feat(shader): add bevel joins          fix(gradient): clamp hard stops
 * `!` or a `BREAKING CHANGE:` footer marks a breaking change (changeset needs `major`).
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
