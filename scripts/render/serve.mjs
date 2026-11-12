/**
 * The page of the render check: bundles pixi.js, the two official runtimes and the built package
 * with rolldown, and serves the bundle and fixtures/.cache from a local HTTP server.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { rolldown } from 'rolldown';

const TYPES = {
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.atlas': 'text/plain',
    '.png': 'image/png',
    '.skel': 'application/octet-stream',
};
const PAGE = [
    '<!doctype html><meta charset="utf-8"><title>render check</title>',
    // no icon, so the browser does not ask for one
    '<link rel="icon" href="data:,">',
    '<script type="module" src="/bundle/entry.js"></script>',
].join('');

/** The folder of the package.json a file belongs to. */
function packageDir(file) {
    for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
        try {
            readFileSync(join(dir, 'package.json'));

            return dir;
        } catch {
            // keep walking up
        }
    }
    throw new Error(`${file} belongs to no package`);
}

/**
 * The official Pixi runtime imports `@esotericsoftware/spine-core` without depending on it. Under
 * pnpm that resolves to whichever version got hoisted. This gives each runtime the core of its own
 * version: the `spine-core-<major.minor>` alias of the package.
 */
function officialCore(pkgDir) {
    return {
        name: 'official-core',
        resolveId(source, importer) {
            if (source !== '@esotericsoftware/spine-core' || !importer?.includes('spine-pixi-v8')) return null;
            const { version } = JSON.parse(readFileSync(join(packageDir(importer), 'package.json'), 'utf8'));
            const line = version.split('.').slice(0, 2).join('.');
            const core = realpathSync(join(pkgDir, 'node_modules', `spine-core-${line}`));
            const manifest = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));

            if (manifest.version !== version) {
                throw new Error(
                    `spine-pixi-v8 ${version} needs spine-core ${version}, the alias has ${manifest.version}`,
                );
            }

            return join(core, manifest.main);
        },
    };
}

/**
 * Bundles the page into `<work>/dist`. The two official runtimes register the same Pixi extension
 * names, so each sits behind a dynamic import and a page loads one of them.
 *
 * @returns `dir` is the folder that holds `entry.js` and its chunks, `remove` deletes the scratch project.
 */
export async function bundlePage(root) {
    const pkgDir = join(root, 'packages/pixi-marrow');
    const work = join(root, 'node_modules/.cache/check-render');
    const modules = join(work, 'node_modules');
    const entry = join(work, 'entry.js');

    // a scratch project, so the bare imports of the entry resolve to the packages the library uses
    rmSync(work, { recursive: true, force: true });
    mkdirSync(modules, { recursive: true });
    // a junction needs no privilege on Windows. Elsewhere the type is ignored
    symlinkSync(pkgDir, join(modules, 'pixi-marrow'), 'junction');
    for (const name of ['pixi.js', 'spine-pixi-4.2', 'spine-pixi-4.3']) {
        symlinkSync(realpathSync(join(pkgDir, 'node_modules', name)), join(modules, name), 'junction');
    }
    writeFileSync(
        entry,
        [
            "import * as PIXI from 'pixi.js';",
            `import { start } from ${JSON.stringify(join(root, 'scripts/render/page.js').replaceAll('\\', '/'))};`,
            'start({',
            '    PIXI,',
            "    loadOurs: () => import('pixi-marrow'),",
            "    loadCore: () => import('pixi-marrow/core'),",
            "    loadOfficial: (version) => (version === '4.2' ? import('spine-pixi-4.2') : import('spine-pixi-4.3')),",
            '});',
            '',
        ].join('\n'),
    );
    const bundle = await rolldown({
        input: entry,
        platform: 'browser',
        plugins: [officialCore(pkgDir)],
        logLevel: 'warn',
    });

    await bundle.write({ dir: join(work, 'dist'), format: 'esm', entryFileNames: 'entry.js' });
    await bundle.close();

    return { dir: join(work, 'dist'), remove: () => rmSync(work, { recursive: true, force: true }) };
}

/**
 * Serves the page at `/`, the bundle under `/bundle/` and the fixtures under `/fixtures/<tag>/`.
 * The tag is ignored: it gives each instance on the page its own URLs, so no two of them share a
 * cache entry or a texture.
 *
 * @returns The origin and a function that stops the server.
 */
export async function serve(root, bundleDir) {
    const cacheDir = join(root, 'fixtures/.cache');
    const resolve = (base, path) => {
        const file = normalize(join(base, path));

        if (!file.startsWith(base + sep)) throw new Error('outside');

        return file;
    };
    const server = createServer((request, response) => {
        const { pathname } = new URL(request.url, 'http://x');
        const parts = decodeURIComponent(pathname).split('/').filter(Boolean);

        try {
            if (parts.length === 0) {
                response.setHeader('content-type', 'text/html');
                response.end(PAGE);

                return;
            }
            const file =
                parts[0] === 'bundle'
                    ? resolve(bundleDir, parts.slice(1).join('/'))
                    : parts[0] === 'fixtures'
                      ? resolve(cacheDir, parts.slice(2).join('/'))
                      : null;

            if (file === null) throw new Error('unknown');
            const body = readFileSync(file);

            response.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
            response.setHeader('cache-control', 'no-store');
            response.end(body);
        } catch {
            response.statusCode = 404;
            response.end();
        }
    });

    await new Promise((done) => server.listen(0, '127.0.0.1', done));

    return { origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
