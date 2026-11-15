#!/usr/bin/env node
/**
 * Copies the repo's README and LICENSE into packages/pixi-marrow for publishing, and the guide
 * for coding agents from packages/pixi-marrow/agent/AGENTS.md to the root of the package.
 *
 * `files` in the package manifest lists both, but npm silently drops an entry that
 * matches nothing, so without this the tarball would ship no README (a blank page on
 * npmjs.com) and no LICENSE. Runs from `prepack`. `postpack --clean` removes the
 * copies again so they never drift from the originals.
 *
 * The README is written for the repo, where `docs/DESIGN.md` is a link that works. On npmjs.com
 * the same link points nowhere. So the copy gets every relative link as a link to the file on
 * GitHub, on the default branch: a page for a link, the raw file for an image.
 *
 * The AGENTS.md of the tarball is for the users of the package. It is not the AGENTS.md at the
 * root of the repo, which is for work on the repo. So it has a source path of its own, and a
 * copy at the root of the package would shadow nothing: an agent that works in the repo reads the
 * file of the folder it is in.
 *
 * While the package is private there is no LICENSE yet, and its absence is not an error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'packages/pixi-marrow');
const FILES = ['README.md', 'LICENSE', 'AGENTS.md'];
/** Where a staged file comes from when that is not the root of the repo. */
const SOURCES = { 'AGENTS.md': join(PKG, 'agent/AGENTS.md') };
const BRANCH = 'main';
const clean = process.argv.includes('--clean');
const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
const isPrivate = manifest.private === true;
const staged = [];

/** `owner/name` of the GitHub repo in `repository` of the manifest. */
function repoSlug() {
    const url = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
    const slug = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url ?? '')?.[1];

    if (!slug) {
        console.error(
            'stage-package-files: `repository` of the manifest names no GitHub repo, so links cannot be made absolute.',
        );
        process.exit(1);
    }

    return slug;
}

/**
 * Markdown with each relative link made absolute. Links with a scheme, links that start with
 * `//` and links to an anchor of the page stay. So does everything inside a code fence.
 */
function absoluteLinks(markdown, slug) {
    const isRelative = (target) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target);
    const absolute = (target, image) => {
        if (!isRelative(target)) return target;
        const path = posix.normalize(target.replace(/^\//, ''));
        const base = image
            ? `https://raw.githubusercontent.com/${slug}/${BRANCH}/`
            : `https://github.com/${slug}/blob/${BRANCH}/`;

        if (path.startsWith('..')) {
            console.error(`stage-package-files: the README link "${target}" points outside the repo.`);
            process.exit(1);
        }

        return base + path;
    };
    let fenced = false;
    let links = 0;
    const count = (before, after) => {
        if (before !== after) links++;

        return after;
    };
    const lines = markdown.split('\n').map((line) => {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced) return line;

        return (
            line
                // [text](target) and ![alt](target), with or without a title
                .replace(
                    /(!?)\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
                    (whole, bang, text, target, title) =>
                        count(whole, `${bang}[${text}](${absolute(target, bang === '!')}${title})`),
                )
                // [name]: target
                .replace(/^(\s*\[[^\]]+\]:\s*)(\S+)/, (whole, start, target) =>
                    count(whole, start + absolute(target, false)),
                )
                // src="target" and href="target" of HTML in the Markdown
                .replace(/\b(src|href)=(["'])([^"']+)\2/g, (whole, name, quote, target) =>
                    count(whole, `${name}=${quote}${absolute(target, name === 'src')}${quote}`),
                )
        );
    });

    return { text: lines.join('\n'), links };
}

for (const name of FILES) {
    const dest = join(PKG, name);

    if (clean) {
        await rm(dest, { force: true });
        staged.push(name);
        continue;
    }
    const src = SOURCES[name] ?? join(ROOT, name);

    if (!existsSync(src)) {
        if (name === 'LICENSE' && isPrivate) continue;
        console.error(`stage-package-files: ${src} is missing. The published package needs it.`);
        process.exit(1);
    }
    if (name === 'README.md') {
        const { text, links } = absoluteLinks(readFileSync(src, 'utf8'), repoSlug());

        await writeFile(dest, text);
        staged.push(`${name} (${links} relative links made absolute)`);
        continue;
    }
    await copyFile(src, dest);
    staged.push(name);
}
// stderr: `npm pack --json` expects nothing but JSON on stdout
console.error(`stage-package-files: ${clean ? 'removed' : 'staged'} ${staged.join(', ')}`);
