/**
 * The page of the render check and of the bench. This bundles pixi.js, the two official runtimes
 * and the built package with rolldown. It serves the bundle and fixtures/.cache from a local HTTP
 * server.
 */
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
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
    '<!doctype html><meta charset="utf-8"><title>pixi-marrow in headless Chrome</title>',
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

/** True while a process with this id runs. */
function alive(pid) {
    try {
        process.kill(pid, 0);

        return true;
    } catch (error) {
        // the process is there and belongs to someone else
        return error.code === 'EPERM';
    }
}

/**
 * Bundles a page into `<work>/dist`. The two official runtimes register the same Pixi extension
 * names, so each sits behind a dynamic import and a page loads one of them.
 *
 * @param page The browser entry, relative to the repo root. It exports `start`, which gets `PIXI`
 * and the loaders of the runtimes.
 * @returns `dir` is the folder that holds `entry.js` and its chunks. `made` is an empty folder for
 * fixtures a tool writes itself, see `serve`. `remove` deletes the scratch project with both.
 */
export async function bundlePage(root, page = 'scripts/render/page.js') {
    const pkgDir = join(root, 'packages/pixi-marrow');
    const cache = join(root, 'node_modules/.cache');
    // one scratch project per process, so the check and the bench can run at the same time
    const work = join(cache, `marrow-page-${process.pid}`);
    const modules = join(work, 'node_modules');

    mkdirSync(cache, { recursive: true });
    // a run that was killed could not remove its scratch project
    for (const name of readdirSync(cache)) {
        const pid = /^marrow-page-(\d+)$/.exec(name)?.[1];

        if (pid && !alive(Number(pid))) rmSync(join(cache, name), { recursive: true, force: true });
    }
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
            `import { start } from ${JSON.stringify(join(root, page).replaceAll('\\', '/'))};`,
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

    mkdirSync(join(work, 'made'));

    return {
        dir: join(work, 'dist'),
        made: join(work, 'made'),
        remove: () => rmSync(work, { recursive: true, force: true }),
    };
}

/**
 * Serves the page at `/`, the bundle under `/bundle/` and the fixtures under `/fixtures/<tag>/`.
 * The tag is ignored: it gives each instance on the page its own URLs, so no two of them share a
 * cache entry or a texture.
 *
 * @param options.isolated True sends the two headers that make the page cross-origin isolated.
 * Chrome measures the memory of a page with `performance.measureUserAgentSpecificMemory` only then.
 * @param options.made A folder with fixtures a tool wrote itself, laid out like fixtures/.cache.
 * A file that is not in the cache is served from there, next to the atlas and images of the cache.
 * @returns The origin and a function that stops the server.
 */
export async function serve(root, bundleDir, { isolated = false, made = null } = {}) {
    const cacheDir = join(root, 'fixtures/.cache');
    const resolve = (base, path) => {
        const file = normalize(join(base, path));

        if (!file.startsWith(base + sep)) throw new Error('outside');

        return file;
    };
    const fixture = (path) => {
        const cached = resolve(cacheDir, path);

        return made === null || existsSync(cached) ? cached : resolve(made, path);
    };
    const server = createServer((request, response) => {
        const { pathname } = new URL(request.url, 'http://x');
        const parts = decodeURIComponent(pathname).split('/').filter(Boolean);

        if (isolated) {
            response.setHeader('cross-origin-opener-policy', 'same-origin');
            response.setHeader('cross-origin-embedder-policy', 'require-corp');
        }
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
                      ? fixture(parts.slice(2).join('/'))
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
