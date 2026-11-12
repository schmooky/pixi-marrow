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
 * animations play on both sides with the same time steps. Both sides run as they ship and solve
 * every constraint: IK, transform, path, physics and sliders. Physics has state, so both sides
 * get the same updates from the same start: scripts/render/sides.js says how. At four steps each
 * side is drawn alone into a render texture, once on a transparent and once on a solid background,
 * and the raw pixels are read back. A rig with physics is drawn at a fifth step, deep in its
 * second loop. Per frame the check reports the largest channel difference and the share of the
 * covered pixels that differ by more than 1 and by more than 8 (of 255).
 *
 * Ours is drawn with its defaults, after `asset.optimized` has resolved. The cuts of overdraw
 * that are on by default are therefore part of every comparison with the official runtime.
 *
 *   official twice             two official instances. No difference is allowed: the tooling is exact
 *   proof, ...                 an instance made wrong on purpose. It must be rejected, at both
 *                              placements
 *   ours                       pixi-marrow against the official runtime, from the binary export
 *   ours, json                 the same from the JSON export
 *   .., json and binary        one runtime, both exports. Spine 4.1 has no official Pixi v8 runtime,
 *                              so for 4.1 this is the only reference
 *   ours is not empty          4.1 only: every animation draws something
 *   .., premultiplied atlas    one runtime, the straight and the premultiplied atlas of a rig
 *   draw calls                 `stats.drawCalls` says what the GPU interface saw. A skeleton with
 *                              normal and additive slots only is one draw call, plus the ranges
 *                              and the two mask draws of every clip that cuts a visible slot
 *   buffers while playing      the vertex ranges are built once, and the index buffer stays while
 *                              an animation plays that keys no color, attachment, draw order or
 *                              sequence. With such keys a slot can come and go, for example when
 *                              its alpha reaches 0, and the rewrites are listed as information
 *   ours, cuts on and off      ours with the default cuts of overdraw against ours with both cuts
 *                              off. The cuts leave triangles out and change none, so the picture
 *                              must be the same. The check fails above a difference of 1
 *   ours, polygons and quads   ours with `tightMesh: 'on'` against ours without cuts. Polygons are
 *                              not exact and not the default, see TOLERANCE. The shares of the
 *                              pixels over 1 and over 8 have limits. The largest difference is
 *                              reported and has none
 *   ours with polygons, official  the same picture against the official runtime, with limits of
 *                              its own: what `tightMesh: 'on'` costs in picture terms
 *   overdraw                   the area of the triangles ours draws, with the default cuts and with
 *                              polygons, against no cuts, and the slots skipped as covered
 *   multisampled target        both cuts must take themselves back in the frame that is drawn to a
 *                              multisampled target, so the picture equals the one without cuts
 *   premultiplied page reading the outlines of a premultiplied page must see a color under alpha 0,
 *                              which a 2D canvas returns as black. Runs once per renderer
 *
 * TOLERANCE below holds the pass criteria and what they rest on.
 *
 * The second look: a frame that is outside the tolerance of ours against official is drawn again,
 * both sides moved by SECOND_PLACEMENT of scripts/render/judge.js, a fraction of a pixel that is
 * no multiple of the subpixel grid of a GPU. The two runtimes move vertices to the screen in
 * different arithmetic, so a vertex that lands on the border of two grid cells can be snapped
 * apart, which no tolerance of a few steps covers. Such a tie is gone at the second placement.
 * A real difference is not. A frame fails when it is outside the tolerance at both placements.
 * A frame that passes at the second one only is listed with the numbers of both, and the summary
 * counts those frames.
 *
 * Clipping: a frame that ours draws through a clip mask (`stats.maskDraws` above 0) is compared
 * like every other frame. The report also gives the largest differences of those frames on their
 * own. `--strict-clipping` does nothing: it was the switch that failed clipped frames while they
 * were a known gap, and it is still accepted so that older command lines keep working.
 *
 * Physics and sliders: the summary counts the frames of ours against official once more for the
 * rigs that have such constraints, in a line of their own. A solver that is wrong fails there and
 * leaves the other rigs alone.
 *
 * Images of failing cases (ours or first, official or second, and where they differ) and of one
 * passing frame per rig go to `.shots/render/<renderer>/`. `--shots` sets how many cases per rig
 * get images. `--self-test` runs the tooling proof alone and draws nothing of ours. A proof is a
 * picture that is wrong on purpose: it must be rejected, and rejected again at the second
 * placement, so that the second look cannot let a real difference pass.
 *
 * Without --renderer both run. A renderer the browser does not have is skipped with a line that
 * says so, and fails the check only when it was asked for by name.
 *
 * Runs the installed Google Chrome. CHROME_PATH names another binary and CHROME_ARGS replaces the
 * launch flags. The package is built first when it has no build or the sources are newer.
 */
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRigs } from './render/plan.mjs';
import { createReporter } from './render/report.mjs';
import { bundlePage, serve } from './render/serve.mjs';
import { ensureBuilt, launchChrome, parseArgs } from './render/setup.mjs';

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
    // Clipped frames are held to the same limits. The official runtime cuts the triangles of a
    // clipped slot on the CPU, ours tests a stencil mask that holds the clip polygon, and both put
    // the edge on the same pixels. Measured on the three rigs that clip: the coin is the same
    // picture, the tank and spineboy differ by 1 at most.
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
    // Ours with the default cuts of overdraw against ours without. A covered slot and a region
    // without a visible pixel are left out, and the triangles that stay are the same triangles,
    // so the picture is the same to the bit. Measured: no pixel differs. The limit of 1 is the
    // room the owner of the project gave to rounding.
    cuts: { max: 1 },
    // Ours with polygons against ours with quads, and against the official runtime. Not exact,
    // and not on by default: a GPU moves the corners of a triangle to its subpixel grid and
    // interpolates texture coordinates from there, so other triangles give other last bits.
    // Measured: the same quads split along the other diagonal change up to 12% of the pixels by 1
    // and a few by 2. A polygon adds pixels whose center lies on the edge of a region and falls to
    // the other side of it. Those differ by what the region shows at its edge.
    //
    // Measured over 384 frames against quads and 228 against official, the same on both renderers.
    // Over 1: none in half of the frames, 0.005% at the 90th percentile. The worst frame is
    // dragon-ess flying at step 7 with 0.08%, 27 pixels. Over 8: one pixel in a frame at most,
    // which is 0.004% in mix-and-match dress-up at step 26. The limits leave about three times
    // that. `few1` and `few8` are for small pictures: spineboy portal at step 26 covers 698
    // pixels, and its 3 pixels over 1 are 0.43% of them.
    // The largest difference is reported and has no limit: one edge pixel differs by up to 53.
    polygons: { over1: 0.0025, over8: 0.0001, few1: 8, few8: 3 },
    polygonsOfficial: { over1: 0.0025, over8: 0.0001, few1: 8, few8: 3 },
};
/** Failing cases per rig that get their images saved. */
const SHOTS_PER_RIG = 4;
const RIG_TIMEOUT = 180_000;

const root = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs();
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
        const options = { tolerance: TOLERANCE, shots: Number(args.shots ?? SHOTS_PER_RIG), extras: rig.extras };
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

async function main() {
    ensureBuilt(root, 'check-render');
    const planned = await planRigs({
        root,
        size: Number(args.size ?? 512),
        animations: args.animations === 'all' ? Number.POSITIVE_INFINITY : Number(args.animations ?? 3),
        only: args.only ?? null,
    });
    // the tooling proof needs the official runtime, which Spine 4.1 does not have
    const rigs = selfTest ? planned.filter((rig) => rig.official) : planned;

    if (rigs.length === 0) throw new Error(`no rig matches --only=${args.only}`);
    // the cases that need no rig run on the page of the first one
    rigs[0].extras = true;
    const bundle = await bundlePage(root);
    const server = await serve(root, bundle.dir);
    const browser = await launchChrome();
    let failed = 0;
    let ran = 0;
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

                const solves = [rig.physics && 'physics', rig.slider && 'slider'].filter(Boolean).join(' and ');

                console.log(
                    `  ${rig.id}  ${rig.size} px, scale ${rig.placement.scale}, ` +
                        `${solves ? `solves ${solves}, ` : ''}plays ${plays}`,
                );
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
    if (failed) console.log(`check-render: ${failed} failures`);
    else console.log('check-render: ok');

    return failed ? 1 : 0;
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(`check-render: ${error.message}`);
    process.exitCode = 1;
}
