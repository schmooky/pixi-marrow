#!/usr/bin/env node
/**
 * Draws skeletons with pixi-marrow and with the official Pixi runtime in headless Chrome and
 * compares the pixels. Unit tests run in Node without a GPU, so this is where the picture itself
 * is measured.
 *
 * usage: pnpm check:render [--renderer=webgl|webgpu|both] [--only=4.3/spineboy] [--animations=3|all]
 *                          [--strict-clipping] [--self-test] [--verbose] [--shots=4]
 *                          [--out=.shots/render] [--size=512]
 *
 * The rigs are the entries of fixtures/manifest.json that have page images. For each one a few
 * animations play on both sides with the same time steps, without constraints. At four steps each
 * side is drawn alone into a render texture, once on a transparent and once on a solid background,
 * and the raw pixels are read back. Per frame the check reports the largest channel difference and
 * the share of the covered pixels that differ by more than 1 and by more than 8 (of 255).
 *
 *   official twice             two official instances. No difference is allowed: the tooling is exact
 *   proof, ...                 an official instance made wrong on purpose. It must be rejected
 *   ours                       pixi-marrow against the official runtime, from the binary export
 *   ours, json                 the same from the JSON export
 *   .., json and binary        one runtime, both exports. Spine 4.1 has no official Pixi v8 runtime,
 *                              so for 4.1 this is the only reference
 *   ours is not empty          4.1 only: every animation draws something
 *   .., premultiplied atlas    one runtime, the straight and the premultiplied atlas of a rig
 *   draw calls                 one draw call for a skeleton with normal and additive slots only
 *   buffers while playing      the vertex ranges are built once, and the index buffer stays while
 *                              an animation plays that keys no color, attachment, draw order or
 *                              sequence. With such keys a slot can come and go, for example when
 *                              its alpha reaches 0, and the rewrites are listed as information
 *
 * TOLERANCE below holds the pass criteria and what they rest on.
 *
 * Known gap: clipping is not solved before milestone M3. A capture where ours is off while its
 * `stats.clippingIgnored` is above 0 is listed under its own heading and does not fail the check.
 * `--strict-clipping` makes those captures failures again.
 *
 * Images of failing cases (ours or first, official or second, and where they differ), of the known
 * gap and of one passing frame per rig go to `.shots/render/<renderer>/`. `--shots` sets how many
 * cases per rig get images. `--self-test` runs the tooling proof alone and draws nothing of ours.
 *
 * Without --renderer both run. A renderer the browser does not have is skipped with a line that
 * says so, and fails the check only when it was asked for by name.
 *
 * Runs the installed Google Chrome. CHROME_PATH names another binary and CHROME_ARGS replaces the
 * launch flags. The package is built first when it has no build or the sources are newer.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { planRigs } from './render/plan.mjs';
import { createReporter } from './render/report.mjs';
import { bundlePage, serve } from './render/serve.mjs';

/**
 * The pass criteria, each as tight as the pictures of this repo support. The numbers they rest on
 * are from Chrome on Apple silicon, WebGL2 on ANGLE Metal and WebGPU, which agree to the digit.
 *
 * `max` is the largest channel difference of a frame. `over1` and `over8` are shares of the covered
 * pixels that differ by more than 1 and by more than 8.
 */
const TOLERANCE = {
    // Ours against official. Geometry and texture coordinates are the same numbers, so what is left
    // is rounding: the official runtime cuts a tint to 8 bits and transforms on the CPU, ours
    // transforms in the shader. Measured over the rigs without clipping: most frames differ by 1 at
    // most, and the worst pixel differs by 4. The largest share over 1 is 0.020%: a row of 20 pixels
    // where an edge lies on the pixel centers and the two sides round it to different rows. The
    // limit leaves room for a longer edge. Nothing differs by more than 8.
    match: { max: 4, over1: 0.0005, over8: 0 },
    // The straight and the premultiplied atlas of a rig. The packer and the browser round the
    // multiplication differently, and layers add up. Measured on both runtimes: 4 at most, over
    // large translucent areas, so the share over 1 has no limit.
    pma: { max: 4, over1: 1, over8: 0 },
    // The JSON and the binary export of a rig. Spine 4.1 and 4.2 write JSON with two to four
    // decimals, so the two pictures sit a fraction of a pixel apart: the official 4.2 runtime shows
    // up to 63% of the pixels over 1 between its own two pictures. The measure is therefore the
    // share of pixels a small displacement cannot explain. Measured on the official runtime: 0.035%
    // at most, and 1.08% for the raptor, whose jump moves 0.6 px between the exports.
    formats: { displaced: 0.001, rigs: { 'raptor-pro': 0.015 } },
};
/** Failing cases per rig that get their images saved. */
const SHOTS_PER_RIG = 4;
const RIG_TIMEOUT = 180_000;
const GPU_FLAGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'];

const root = fileURLToPath(new URL('..', import.meta.url));
const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
        const [key, value = 'true'] = arg.replace(/^--/, '').split('=');

        return [key, value];
    }),
);
const wanted = ['webgl', 'webgpu'].includes(args.renderer) ? [args.renderer] : ['webgl', 'webgpu'];
const outDir = resolve(root, args.out ?? '.shots/render');
const selfTest = args['self-test'] === 'true';

/** Runs the cases of one rig on a page of its own, so a rig cannot disturb the next one. */
async function runRig(browser, origin, renderer, rig) {
    const page = await browser.newPage();
    const errors = [];
    // the runtimes load before the renderer is created, so the page is told which ones in its address
    const query = `renderer=${renderer}&official=${rig.official ?? 'none'}&ours=${selfTest ? 'no' : 'yes'}`;
    let timer;

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} for ${response.url()}`);
    });
    page.on('console', (entry) => {
        const text = entry.text();

        // a failed request is reported with its address by the response listener
        if (/Failed to load resource/.test(text)) return;
        if (entry.type() === 'error' || /CONTEXT_LOST|GL_INVALID|INVALID_|WebGPU|wgsl|shader/i.test(text))
            errors.push(text);
    });
    try {
        await page.goto(`${origin}/?${query}`);
        await page.waitForFunction(() => window.renderCheck, null, { timeout: 30_000 });
        const state = await page.evaluate(() => ({ ...window.renderCheck, run: undefined }));

        if (state.error || state.renderer !== renderer) return { state, errors };
        // the renderer is up from here on
        const options = {
            tolerance: TOLERANCE,
            shots: Number(args.shots ?? SHOTS_PER_RIG),
            strictClipping: args['strict-clipping'] === 'true',
        };
        const report = await Promise.race([
            page.evaluate(([plan, opts]) => window.renderCheck.run(plan, opts), [rig, options]),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timed out')), RIG_TIMEOUT);
            }),
        ]);

        return { state, report, errors };
    } catch (error) {
        return { state: { renderer }, crash: error.message.split('\n')[0], errors };
    } finally {
        clearTimeout(timer);
        await page.close().catch(() => {});
    }
}

/** Why the package has to be built before the check, or an empty string. */
function buildNeeded() {
    const pkgDir = join(root, 'packages/pixi-marrow');
    const built = join(pkgDir, 'dist/index.js');

    if (!existsSync(built)) return 'no build found';
    const sources = readdirSync(join(pkgDir, 'src'), { recursive: true }).map((file) => join(pkgDir, 'src', file));
    const newest = Math.max(...sources.map((file) => statSync(file).mtimeMs));

    return newest > statSync(built).mtimeMs ? 'the sources are newer than the build' : '';
}

async function main() {
    const why = buildNeeded();

    if (why) {
        console.log(`check-render: ${why}, running pnpm build`);
        // the file list of the build is of no use here. What goes wrong is on stderr
        execFileSync('pnpm', ['build'], {
            cwd: root,
            stdio: ['ignore', 'ignore', 'inherit'],
            shell: process.platform === 'win32',
        });
    }
    const planned = await planRigs({
        root,
        size: Number(args.size ?? 512),
        animations: args.animations === 'all' ? Number.POSITIVE_INFINITY : Number(args.animations ?? 3),
        only: args.only ?? null,
    });
    // the tooling proof needs the official runtime, which Spine 4.1 does not have
    const rigs = selfTest ? planned.filter((rig) => rig.official) : planned;

    if (rigs.length === 0) throw new Error(`no rig matches --only=${args.only}`);
    const bundle = await bundlePage(root);
    const server = await serve(root, bundle.dir);
    const browser = await chromium.launch({
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
        headless: true,
        args: process.env.CHROME_ARGS
            ? process.env.CHROME_ARGS.split(/\s+/).filter(Boolean)
            : [...GPU_FLAGS, ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
    });
    let failed = 0;
    let ran = 0;
    let gaps = 0;
    let missing = false;

    try {
        for (const renderer of wanted) {
            const dir = join(outDir, renderer);
            const reporter = createReporter({ root, dir, verbose: args.verbose === 'true' });
            let announced = false;

            rmSync(dir, { recursive: true, force: true });
            for (const rig of rigs) {
                const { state, report, crash, errors } = await runRig(browser, server.origin, renderer, rig);

                if (state.step !== 'load' && (state.error || state.renderer !== renderer)) {
                    const why = state.error ?? `the browser gave ${state.renderer}`;

                    console.log(`check-render: ${renderer} is not available here (${why}), its cases did not run`);
                    // a renderer that was asked for by name must be there
                    if (wanted.length === 1) failed++;
                    break;
                }
                if (!announced) console.log(`check-render: ${renderer}${state.gpu ? ` (${state.gpu})` : ''}`);
                announced = true;
                const plays = rig.sequences.map((s) => `${s.animation}${s.skin ? ` (${s.skin})` : ''}`).join(', ');

                console.log(`  ${rig.id}  ${rig.size} px, scale ${rig.placement.scale}, plays ${plays}`);
                if (crash || state.error) {
                    console.log(`    FAIL the page failed: ${crash ?? state.error}`);
                    failed++;
                }
                if (report) {
                    failed += reporter.rig(rig, report);
                    missing ||= report.missing;
                }
                for (const error of errors) console.log(`    error ${error}`);
                if (errors.length) failed++;
            }
            if (!announced) continue;
            ran++;
            console.log(`check-render: ${renderer} summary`);
            reporter.summary();
            gaps += reporter.knownGap(`check-render: ${renderer} known gap: clipping, milestone M3`);
        }
    } finally {
        await browser.close();
        server.close();
        bundle.remove();
    }
    if (ran === 0) {
        console.log('check-render: no renderer came up, so nothing was checked');
        failed++;
    }
    if (missing) {
        console.log('check-render: pixi-marrow exports no MarrowSpine, so nothing of ours was drawn');
        failed++;
    }
    const known = gaps ? `${gaps} captures in the known gap: clipping, milestone M3` : '';

    if (failed) console.log(`check-render: ${failed} failures${known ? `, and ${known}` : ''}`);
    else console.log(`check-render: ok${known ? `, with ${known}` : ''}`);

    return failed ? 1 : 0;
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(`check-render: ${error.message}`);
    process.exitCode = 1;
}
