import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

const root = fileURLToPath(new URL('.', import.meta.url));

/** The source file of a route, relative to this folder: `src/pages/guide/play.mdx` for `/guide/play/`. */
function sourceOf(route) {
    const path = route.replace(/\/$/, '');
    const names = ['.mdx', '.md', '.astro', '/index.mdx', '/index.md', '/index.astro'].map(
        (end) => `src/pages${path}${end}`,
    );

    return names.find((name) => existsSync(`${root}${name}`));
}

/** The date of the last commit that changed a file, or undefined where git does not know it. */
function lastCommitDate(file) {
    try {
        const said = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        return said === '' ? undefined : said;
    } catch {
        return undefined;
    }
}

/**
 * An entry of the sitemap, made after the pages are built. A page that carries `noindex` gets no
 * entry, whoever wrote the page. The date is that of the last commit to the source of the page.
 */
function sitemapEntry(item) {
    const route = new URL(item.url).pathname;
    const built = `${root}dist${route}index.html`;

    if (existsSync(built) && /<meta name="robots" content="[^"]*noindex/.test(readFileSync(built, 'utf8')))
        return undefined;
    const source = sourceOf(route);
    const date = source === undefined ? undefined : lastCommitDate(source);

    return date === undefined ? item : { ...item, lastmod: date };
}

/**
 * The landing page starts its bee after the first paint, with an import on demand. This step
 * reads the files which that import needs from the built script of the page. It names them in
 * the head as `modulepreload` links, so the browser fetches them while the page shows its text.
 */
const landingPreload = {
    name: 'landing-preload',
    hooks: {
        'astro:build:done': ({ dir, logger }) => {
            const page = fileURLToPath(new URL('index.html', dir));
            const html = readFileSync(page, 'utf8');
            const entry = /<script type="module" src="(\/_astro\/index\.astro[^"]+)"/.exec(html)?.[1];
            const script = entry === undefined ? '' : readFileSync(fileURLToPath(new URL(entry.slice(1), dir)), 'utf8');
            const list = /m\.f=(\[[^\]]*\])/.exec(script)?.[1];

            if (list === undefined || !html.includes('</head>')) {
                logger.warn('The landing page has no import on demand to preload.');

                return;
            }
            const links = JSON.parse(list)
                .filter((file) => file.endsWith('.js'))
                .map((file) => `<link rel="modulepreload" href="/${file}">`)
                .join('');

            writeFileSync(page, html.replace('</head>', `${links}</head>`));
            logger.info(`The landing page preloads ${JSON.parse(list).length} files of the bee.`);
        },
    },
};

export default defineConfig({
    // where the built site is served: the canonical link of every page starts with it
    site: 'https://pixi-marrow.schmooky.dev',
    trailingSlash: 'always',
    integrations: [mdx(), sitemap({ serialize: sitemapEntry }), landingPreload],
    // code surfaces are dark, as the previews are
    markdown: { shikiConfig: { theme: 'github-dark-dimmed' } },
    devToolbar: { enabled: false },
    vite: {
        // the site, pixi-marrow and pixi-silk must share one copy of Pixi
        resolve: { dedupe: ['pixi.js'] },
        // A preview is imported when its frame comes into view. The dev server finds pixi-silk only
        // then, bundles it and reloads the page once. Naming both here bundles them at the start
        optimizeDeps: { include: ['pixi.js', 'pixi-silk'] },
    },
});
