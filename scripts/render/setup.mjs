/**
 * What the render check and the bench do before a page opens. They build the package when its
 * sources are newer than its build, and start the installed Google Chrome with the GPU switched on.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
export function ensureBuilt(root, name) {
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
