/**
 * The page of the render check and of the bench. This bundles pixi.js, the two official runtimes
 * and the built package with rolldown. It serves the bundle and fixtures/.cache from a local HTTP
 * server.
 */
import {
    cpSync,
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

/**
 * Gives every import of `pixi.js` in the bundle the same build of Pixi: the page, pixi-marrow and
 * the official runtime then share one copy, whichever folder each of them would find on its own.
 *
 * @param pixiDir The folder of that pixi.js.
 */
export function onePixi(pixiDir) {
    const manifest = JSON.parse(readFileSync(join(pixiDir, 'package.json'), 'utf8'));

    return {
        name: 'one-pixi',
        resolveId(source) {
            if (source === 'pixi.js') return join(pixiDir, manifest.module);
            // nothing here imports a file of Pixi by its path. If something starts to, it must not get another copy
            if (source.startsWith('pixi.js/'))
                throw new Error(`${source} is imported by its path, past the pixi.js of the page`);

            return null;
        },
    };
}

/** What marks the modules of the reference copy of an official runtime, at the end of their ids. */
const REFERENCE = '?reference';

/**
 * A second copy of the official runtimes that runs on a pixi.js of its own: the reference.
 *
 * A page that runs on another version of pixi.js still needs an official picture nobody
 * doubts, and the official runtime can draw differently on an old pixi.js too. So the page gets
 * the official runtime twice. Once on the pixi.js of the page, and once more on the pixi.js the
 * package is developed with, where its pictures are the ones every check so far was judged by.
 *
 * The bundle imports `reference-pixi` for that pixi.js and `reference-spine-pixi-4.2` or
 * `reference-spine-pixi-4.3` for the runtime. The modules of the copy are the same files with a
 * mark at the end of their ids, which makes them modules of their own. Their import of `pixi.js`
 * goes to the reference, their other imports go where they went before.
 *
 * @param pixiDir The folder of the pixi.js of the reference.
 */
function referenceOfficial(pixiDir) {
    const pixiEntry = join(pixiDir, JSON.parse(readFileSync(join(pixiDir, 'package.json'), 'utf8')).module);

    return {
        name: 'reference-official',
        async resolveId(source, importer) {
            if (source === 'reference-pixi') return pixiEntry;
            const runtime = /^reference-(spine-pixi-4\.[23])$/.exec(source)?.[1];

            if (runtime) return `${(await this.resolve(runtime, importer, { skipSelf: true })).id}${REFERENCE}`;
            if (!importer?.endsWith(REFERENCE)) return null;
            const file = importer.slice(0, -REFERENCE.length);

            if (source === 'pixi.js') return pixiEntry;
            // a file of the runtime stays in the copy
            if (source.startsWith('.')) return `${join(dirname(file), source)}${REFERENCE}`;

            // the Spine core and what else the runtime needs know no Pixi: both copies share them
            return (await this.resolve(source, file, { skipSelf: true }))?.id ?? null;
        },
        load(id) {
            return id.endsWith(REFERENCE) ? readFileSync(id.slice(0, -REFERENCE.length), 'utf8') : null;
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
 * An empty scratch project below `node_modules/.cache`, so that the bare imports of an entry
 * written into it resolve to the packages the library uses: the built pixi-marrow, pixi.js and
 * the two official runtimes. There is one per process and name, so the check and the bench can
 * run at the same time.
 *
 * @param name What the project is for: `page`, `game` for scripts/render/game-bundle.mjs, or
 * `restore` for scripts/render/restore-check.mjs.
 * @param pkg The folder of the built pixi-marrow, see `bundlePage`.
 * @returns The folder of the project.
 */
export function scratchProject(root, name, pkg) {
    const pkgDir = join(root, 'packages/pixi-marrow');
    const cache = join(root, 'node_modules/.cache');
    const work = join(cache, `marrow-${name}-${process.pid}`);
    const modules = join(work, 'node_modules');

    mkdirSync(cache, { recursive: true });
    // a run that was killed could not remove its scratch project
    for (const entry of readdirSync(cache)) {
        const pid = /^marrow-(?:page|game|restore)-(\d+)$/.exec(entry)?.[1];

        if (pid && !alive(Number(pid))) rmSync(join(cache, entry), { recursive: true, force: true });
    }
    rmSync(work, { recursive: true, force: true });
    mkdirSync(modules, { recursive: true });
    // a junction needs no privilege on Windows. Elsewhere the type is ignored
    if (!pkg || pkg === pkgDir) symlinkSync(pkgDir, join(modules, 'pixi-marrow'), 'junction');
    else {
        // A build that was kept is copied in, so that its import of pixi.js resolves to the one
        // of this scratch project. A link would resolve it from the folder the build was kept in
        mkdirSync(join(modules, 'pixi-marrow'));
        cpSync(join(pkg, 'package.json'), join(modules, 'pixi-marrow/package.json'));
        cpSync(join(pkg, 'dist'), join(modules, 'pixi-marrow/dist'), { recursive: true });
    }
    for (const dependency of ['pixi.js', 'spine-pixi-4.2', 'spine-pixi-4.3']) {
        symlinkSync(realpathSync(join(pkgDir, 'node_modules', dependency)), join(modules, dependency), 'junction');
    }

    return work;
}

/**
 * Bundles a page into `<work>/dist`. The two official runtimes register the same Pixi extension
 * names, so each sits behind a dynamic import and a page loads one of them.
 *
 * @param page The browser entry, relative to the repo root. It exports `start`, which gets `PIXI`
 * and the loaders of the runtimes.
 * @param options.pkg The folder of the built pixi-marrow the page loads, see `builtPackage` of
 * scripts/render/setup.mjs. Default: the package of the working tree.
 * @param options.pixi The folder of the pixi.js the page and both runtimes run on, see
 * `pixiPackage` of scripts/render/setup.mjs. Default: the pixi.js the package is developed with.
 * @param options.reference True to bundle the official runtimes once more, on the pixi.js the
 * package is developed with: `start` then also gets `loadReference`, see `referenceOfficial`.
 * @returns `dir` is the folder that holds `entry.js` and its chunks. `made` is an empty folder for
 * fixtures a tool writes itself, see `serve`. `remove` deletes the scratch project with both.
 */
export async function bundlePage(root, page = 'scripts/render/page.js', { pkg, pixi, reference = false } = {}) {
    const pkgDir = join(root, 'packages/pixi-marrow');
    const developedOn = realpathSync(join(pkgDir, 'node_modules/pixi.js'));
    const pixiDir = pixi ?? developedOn;
    const work = scratchProject(root, 'page', pkg);
    const entry = join(work, 'entry.js');

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
            // the official runtime once more, with the pixi.js it runs on: `PIXI` and `lib`
            ...(reference
                ? [
                      '    loadReference: async (version) => ({',
                      "        PIXI: await import('reference-pixi'),",
                      "        lib: await (version === '4.2' ? import('reference-spine-pixi-4.2') : import('reference-spine-pixi-4.3')),",
                      '    }),',
                  ]
                : []),
            '});',
            '',
        ].join('\n'),
    );
    const bundle = await rolldown({
        input: entry,
        platform: 'browser',
        plugins: [...(reference ? [referenceOfficial(developedOn)] : []), officialCore(pkgDir), onePixi(pixiDir)],
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
