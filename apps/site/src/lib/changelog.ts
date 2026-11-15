import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Heading, renderMarkdown } from './markdown';
import { SITE_ROOT } from './routes';

/*
 * The changelog of the package as HTML, read from the repo while the site builds. The released
 * versions come from `packages/pixi-marrow/CHANGELOG.md`, which Changesets writes. The changes
 * that wait for the next release come from the changeset files in `.changeset`. Nobody keeps
 * the page by hand.
 */

const REPO = join(SITE_ROOT, '../..');

/** The id of the heading of a version: `v0-1-0-next-1` for `0.1.0-next.1`. */
const versionSlug = (version: string): string => `v${version.replace(/[^\w]+/g, '-')}`;

/** A changelog entry without the thanks to its author, which Changesets adds. The page names no person. */
const withoutThanks = (text: string): string => text.replace(/ Thanks \[@[^\]]+\]\([^)]+\)!/g, '');

/** The released versions: their HTML, and one heading per version. */
export function releasedChanges(): { html: string; versions: Heading[] } {
    const text = readFileSync(join(REPO, 'packages/pixi-marrow/CHANGELOG.md'), 'utf8');
    // the file starts with the name of the package as its title, which the page has already
    const body = withoutThanks(text.replace(/^# [^\n]*\n/, ''));
    // a version is a heading of the third level on the page, below the heading of the section
    const { html, headings } = renderMarkdown(body, {
        shift: 1,
        slug: (label, depth) => (depth === 3 ? versionSlug(label) : undefined),
    });

    return { html, versions: headings };
}

/** The changes that no release holds yet: the body of each changeset file that waits in `.changeset`. */
export function waitingChanges(): string[] {
    const folder = join(REPO, '.changeset');

    if (!existsSync(folder)) return [];

    return readdirSync(folder)
        .filter((name) => name.endsWith('.md') && name !== 'README.md')
        .sort()
        .map((name) => readFileSync(join(folder, name), 'utf8'))
        .filter((text) => /^---\r?\n[\s\S]*?pixi-marrow[\s\S]*?\r?\n---/.test(text))
        .map((text) => renderMarkdown(text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')).html);
}
