/**
 * The two bundles of scripts/render/game-check.mjs. Both run scripts/render/game.js.
 *
 * `game` is bundled as a game is: its entry imports `Application` and nothing else from
 * `pixi.js`, and `MarrowSpine` from the built package. The bundler shakes the tree, so the
 * parts of Pixi that neither of them uses are not in the bundle, and what pixi-marrow loads on
 * demand sits in chunks that arrive later. No module of that bundle imports the whole of Pixi.
 *
 * `whole` imports the whole of Pixi, as the other pages of the render check do. Its pictures
 * are the ones the pictures of `game` are compared with.
 */
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rolldown } from 'rolldown';
import { onePixi, scratchProject } from './serve.mjs';

/** The entry of each bundle. Each gives the page the two classes a game starts with. */
const ENTRIES = {
    game: (page) => [
        "import { Application } from 'pixi.js';",
        "import { MarrowSpine } from 'pixi-marrow';",
        `import { startGame } from ${page};`,
        '',
        "startGame({ Application, MarrowSpine, bundle: 'game' });",
        '',
    ],
    whole: (page) => [
        "import * as PIXI from 'pixi.js';",
        "import { MarrowSpine } from 'pixi-marrow';",
        `import { startGame } from ${page};`,
        '',
        '// the whole of Pixi is used, so the bundler keeps the whole of it',
        'globalThis.PIXI = PIXI;',
        "startGame({ Application: PIXI.Application, MarrowSpine, bundle: 'whole' });",
        '',
    ],
};

/**
 * What marks the module of Pixi's mesh pipe in a bundle: the comment the bundler writes above
 * every module, with its path. A renderer has the pipe from its start only when that module
 * was evaluated before the renderer was initialized.
 */
const MESH_PIPE = /^\/\/ \S*\/scene\/mesh\/shared\/MeshPipe\.m?js$/m;

/**
 * Where Pixi's mesh pipe is in a bundle: `start` when the entry or a file the entry imports at
 * once holds it, `chunk` when only a file that loads on demand does, `none` when no file does.
 */
function meshPipeIn(dir) {
    const files = new Map();

    for (const name of readdirSync(dir).filter((file) => file.endsWith('.js'))) {
        const text = readFileSync(join(dir, name), 'utf8');
        // a file a file needs at once: `import ... from "./x.js"`, not `import("./x.js")`
        const needs = [...text.matchAll(/^import\s*(?:[^"'()]*?from\s*)?["']\.\/([^"']+)["'];?$/gm)].map(
            (match) => match[1],
        );

        files.set(name, { needs, holds: MESH_PIPE.test(text) });
    }
    const atOnce = new Set(['entry.js']);

    for (const name of atOnce) for (const needed of files.get(name)?.needs ?? []) atOnce.add(needed);
    if ([...atOnce].some((name) => files.get(name)?.holds)) return 'start';

    return [...files.values()].some((entry) => entry.holds) ? 'chunk' : 'none';
}

/**
 * Bundles scripts/render/game.js twice, see the head of this file.
 *
 * @param options.pkg The folder of the built pixi-marrow, see `builtPackage` of scripts/render/setup.mjs.
 * @param options.pixi The folder of the pixi.js both bundles run on, see `pixiPackage` there.
 * @returns `game` and `whole` are the folders that hold the `entry.js` of each bundle and its
 * chunks. `meshPipe` says where Pixi's mesh pipe is in each, see `meshPipeIn`. `made` is an empty folder, see
 * `serve`. `remove` deletes the scratch project.
 */
export async function bundleGame(root, { pkg, pixi } = {}) {
    const pkgDir = join(root, 'packages/pixi-marrow');
    const pixiDir = pixi ?? realpathSync(join(pkgDir, 'node_modules/pixi.js'));
    const work = scratchProject(root, 'game', pkg);
    const page = JSON.stringify(join(root, 'scripts/render/game.js').replaceAll('\\', '/'));
    const meshPipe = {};

    for (const [name, lines] of Object.entries(ENTRIES)) {
        const entry = join(work, `${name}.js`);

        writeFileSync(entry, lines(page).join('\n'));
        const bundle = await rolldown({
            input: entry,
            platform: 'browser',
            plugins: [onePixi(pixiDir)],
            // what a bundler does for a game by default. It is said here because the check depends on it
            treeshake: true,
            logLevel: 'warn',
        });

        await bundle.write({ dir: join(work, 'dist', name), format: 'esm', entryFileNames: 'entry.js' });
        await bundle.close();
        meshPipe[name] = meshPipeIn(join(work, 'dist', name));
    }
    mkdirSync(join(work, 'made'));

    return {
        game: join(work, 'dist/game'),
        whole: join(work, 'dist/whole'),
        meshPipe,
        made: join(work, 'made'),
        remove: () => rmSync(work, { recursive: true, force: true }),
    };
}
