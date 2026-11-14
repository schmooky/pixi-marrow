/**
 * What the render check and the bench do before a page opens. They build the package when its
 * sources are newer than its build, and start the installed Google Chrome with the GPU switched on.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const GPU_FLAGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'];

/** The value of every `--key=value` argument of the command line. A bare `--key` is `true`. */
export function parseArgs(argv = process.argv.slice(2)) {
    return Object.fromEntries(
        argv.map((arg) => {
            const [key, value = 'true'] = arg.replace(/^--/, '').split('=');

            return [key, value];
        }),
    );
}

/** Why the package has to be built before a page can load it, or an empty string. */
function buildNeeded(root) {
    const pkgDir = join(root, 'packages/pixi-marrow');
    const built = join(pkgDir, 'dist/index.js');

    if (!existsSync(built)) return 'no build found';
    const sources = readdirSync(join(pkgDir, 'src'), { recursive: true }).map((file) => join(pkgDir, 'src', file));
    const newest = Math.max(...sources.map((file) => statSync(file).mtimeMs));

    return newest > statSync(built).mtimeMs ? 'the sources are newer than the build' : '';
}

/**
 * Runs `pnpm build` when the package has no build or its sources are newer.
 *
 * @param name The name of the tool, for the line it prints.
 */
function ensureBuilt(root, name) {
    const why = buildNeeded(root);

    if (!why) return;
    console.log(`${name}: ${why}, running pnpm build`);
    // the file list of the build is of no use here. What goes wrong is on stderr
    execFileSync('pnpm', ['build'], {
        cwd: root,
        stdio: ['ignore', 'ignore', 'inherit'],
        shell: process.platform === 'win32',
    });
}

/**
 * The built package a tool loads into its page: the folder that holds its `package.json` and its
 * `dist`. Without `dist` that is the package of the working tree, built first when its sources
 * are newer. `--dist=<folder>` names a build that was kept, for example the one of an earlier
 * commit: a tool then measures that build and leaves the working tree alone.
 *
 * @param dist The value of `--dist`, or undefined.
 * @param name The name of the tool, for the line it prints.
 */
export function builtPackage(root, dist, name) {
    if (!dist) {
        ensureBuilt(root, name);

        return join(root, 'packages/pixi-marrow');
    }
    const folder = resolve(dist);

    if (!existsSync(join(folder, 'package.json')) || !existsSync(join(folder, 'dist/index.js'))) {
        throw new Error(`--dist=${dist} holds no package.json next to a dist/index.js`);
    }
    console.log(`${name}: loads the build in ${folder}, not the working tree`);

    return folder;
}

/**
 * The pixi.js a tool bundles into its page, for both runtimes: its folder and its version.
 *
 * Without `version` that is the `pixi.js` the package is developed with. `--pixi=<version>`
 * names another one, which must be installed as a dev dependency of the package under an alias
 * that starts with `pixi-`, as `pixi-8.21` is for pixi.js 8.21.0. The peer range of the package
 * allows versions nobody develops on. This is how a page runs on one of them.
 *
 * @param version The value of `--pixi`, as `8.21` or `8.21.0`, or undefined.
 * @param name The name of the tool, for the line it prints.
 */
export function pixiPackage(root, version, name) {
    const modules = join(root, 'packages/pixi-marrow/node_modules');
    const installed = readdirSync(modules)
        .filter((alias) => alias === 'pixi.js' || /^pixi-\d/.test(alias))
        .map((alias) => ({
            alias,
            dir: realpathSync(join(modules, alias)),
            version: JSON.parse(readFileSync(join(modules, alias, 'package.json'), 'utf8')).version,
        }));
    const found = version
        ? installed.find((it) => it.version === version || it.version.startsWith(`${version}.`))
        : installed.find((it) => it.alias === 'pixi.js');

    if (!found) {
        throw new Error(
            `--pixi=${version} is not installed. There are ${installed.map((it) => it.version).join(', ')}. ` +
                'Add an alias like "pixi-8.21": "npm:pixi.js@8.21.0" to the devDependencies of packages/pixi-marrow/package.json',
        );
    }
    if (version) console.log(`${name}: the page runs on pixi.js ${found.version}`);

    return found;
}

/**
 * Starts headless Chrome on the real GPU. CHROME_PATH names another binary and CHROME_ARGS
 * replaces the GPU flags.
 *
 * @param extra Flags a tool needs on top, which CHROME_ARGS does not replace.
 */
export function launchChrome(extra = []) {
    const flags = process.env.CHROME_ARGS
        ? process.env.CHROME_ARGS.split(/\s+/).filter(Boolean)
        : [...GPU_FLAGS, ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])];

    return chromium.launch({
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
        headless: true,
        args: [...flags, ...extra],
    });
}

/**
 * Waits for a promise and gives up after a time: a page that hangs must not hang the tool.
 *
 * @param timeout Milliseconds after which the returned promise rejects with `timed out`.
 */
export async function inTime(promise, timeout) {
    let timer;

    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`timed out after ${timeout / 1000} s`)), timeout);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
