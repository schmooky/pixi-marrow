#!/usr/bin/env node
/**
 * The part of the render check about a WebGL context that is lost and restored.
 *
 * A browser can take the WebGL context of a page away and give it back later. Pixi keeps its
 * `Application` alive through that: it makes its buffers, textures and programs again when the
 * context is back. pixi-marrow keeps notes about what the GPU holds, so that it uploads only
 * what changed: the stretches of a batch buffer that wait for an upload, how far an index buffer
 * can hold something other than zero, and the pose a view drew last. A skeleton at rest uploads
 * nothing by itself, so its buffers must come back without its help.
 *
 * This check runs the cases of scripts/render/restore.js, each in both render modes and each
 * twice, on pages of their own. One run loses its context with the `WEBGL_lose_context`
 * extension, draws on for some frames and gets the context back. The other run keeps its
 * context. A case fails when a pixel of a frame after the restore differs between the two runs.
 * It also fails when a page throws or logs an error, when the rig did not draw in the mode the
 * case is about, when the canvas did not fire both events of its context, and when the rig did
 * not rest or move as the case says.
 *
 * What the cases found when they were written. A skeleton that was drawn before the loss comes
 * back, at rest too: Pixi gives every buffer a new GPU buffer, and a new one uploads its whole
 * array. A skeleton that is first drawn while the context is away did not come back. Pixi
 * cannot compile its program then. pixi.js 8.16 throws out of the render. pixi.js 8.23 logs an
 * error and never sets the uniforms of that program again, so the skeleton stays invisible
 * after the restore. pixi-marrow now draws no skeleton while the context is lost. The two cases
 * with a skeleton that appears late fail on a build without that.
 *
 * The proof of the tooling is a run that never gets its context back. Its pictures must be
 * rejected, which shows that the pictures are those of the canvas a player sees.
 *
 * The extension belongs to WebGL. The loss of a WebGPU device is another event with another
 * path through Pixi, and this check does not cover it. It runs in Chrome on this machine, and
 * says nothing about how a phone takes a context away. A display object of Pixi itself that is
 * first drawn without a context has the same trouble inside Pixi, and nothing here helps it.
 *
 * Usage: node scripts/render/restore-check.mjs [--pixi=<version>] [--dist=<folder>]
 *        [--render-mode=mesh|batched] [--only=restore/mesh] [--out=<folder>] [--keep]
 *
 * The arguments mean what they mean for scripts/check-render.mjs. `--only` keeps the cases whose
 * id holds the text: an id is `restore/`, the render mode and the id of the case in
 * scripts/render/restore.js, as in `restore/mesh/clip-rest`. Pictures of a failed case are
 * written below `--out`, default `.shots/restore`. `--keep` writes the pictures of every case.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import {
    RESTORE_AWAY,
    RESTORE_BACKGROUND,
    RESTORE_CASES,
    RESTORE_FRAMES,
    RESTORE_MODES,
    RESTORE_SIZE,
} from './restore.js';
import { onePixi, scratchProject, serve } from './serve.mjs';
import { builtPackage, inTime, launchChrome, parseArgs, pixiPackage } from './setup.mjs';

/** How long one run may take in one page, in milliseconds. */
const RUN_TIMEOUT = 60_000;

/** The least share of the canvas a stage must cover for its picture to count as one. */
const LEAST_COVER = 0.02;

/** What Chrome logs when the extension loses a context. It is no error of the page. */
const EXPECTED_LOG = /loseContext: context lost/;

/**
 * Bundles scripts/render/restore.js as a game is bundled: the entry imports `Application` and
 * `Graphics` by name and the tree is shaken, see scripts/render/game-bundle.mjs. The renderer
 * of such a page starts without the pipes of pixi-marrow and without Pixi's mesh pipe. What
 * pixi-marrow puts into the renderer later is then what goes through the loss.
 *
 * @param options.pkg The folder of the built pixi-marrow, see `builtPackage` of scripts/render/setup.mjs.
 * @param options.pixi The folder of the pixi.js the bundle runs on, see `pixiPackage` there.
 * @returns `dir` is the folder that holds `entry.js` and its chunks. `remove` deletes the scratch project.
 */
async function bundleRestore(root, { pkg, pixi }) {
    const work = scratchProject(root, 'restore', pkg);
    const entry = join(work, 'entry.js');
    const page = JSON.stringify(join(root, 'scripts/render/restore.js').replaceAll('\\', '/'));

    writeFileSync(
        entry,
        [
            "import { Application, Graphics, VERSION } from 'pixi.js';",
            "import { MarrowSpine } from 'pixi-marrow';",
            `import { startRestore } from ${page};`,
            '',
            'startRestore({ Application, Graphics, MarrowSpine, pixi: VERSION });',
            '',
        ].join('\n'),
    );
    const bundle = await rolldown({
        input: entry,
        platform: 'browser',
        plugins: [onePixi(pixi)],
        // what a bundler does for a game by default. It is said here because the check depends on it
        treeshake: true,
        logLevel: 'warn',
    });

    await bundle.write({ dir: join(work, 'dist'), format: 'esm', entryFileNames: 'entry.js' });
    await bundle.close();

    return { dir: join(work, 'dist'), remove: () => rmSync(work, { recursive: true, force: true }) };
}

/**
 * Runs one case in a page of its own. Returns what the page reported and the errors it logged.
 *
 * @param lose True to lose the context and get it back, false to keep it, `forever` to lose it for good.
 */
async function runPage(browser, origin, id, mode, lose, skinning) {
    const page = await browser.newPage();
    const errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} for ${response.url()}`);
    });
    page.on('console', (entry) => {
        const text = entry.text();

        if (/Failed to load resource/.test(text) || EXPECTED_LOG.test(text)) return;
        if (entry.type() === 'error' || /CONTEXT_LOST|GL_INVALID|INVALID_|shader/i.test(text)) errors.push(text);
    });
    try {
        await page.goto(`${origin}/${skinning ? `?skinning=${skinning}` : ''}`);
        await page.waitForFunction(() => window.restoreCheck, null, { timeout: 30_000 });
        const report = await inTime(
            page.evaluate(([name, how, lost]) => window.restoreCheck.run(name, how, lost), [id, mode, lose]),
            RUN_TIMEOUT,
        );

        return { report, errors };
    } catch (error) {
        return { report: { error: error.message.split('\n')[0], renderer: null, frames: [] }, errors };
    } finally {
        await page.close().catch(() => {});
    }
}

/**
 * Compares two pictures of the canvas. `covered` is the share of the second that is not the
 * background, `differing` the number of pixels with another byte, `largest` the largest
 * difference of a byte.
 */
function comparePictures(first, second) {
    const a = Buffer.from(first, 'base64');
    const b = Buffer.from(second, 'base64');
    const pixels = RESTORE_SIZE * RESTORE_SIZE;
    let covered = 0;
    let differing = 0;
    let largest = 0;

    if (a.length !== pixels * 4 || b.length !== pixels * 4) return { covered: 0, differing: pixels, largest: 255 };
    for (let at = 0; at < a.length; at += 4) {
        let apart = 0;
        let drawn = false;

        for (let channel = 0; channel < 4; channel++) {
            apart = Math.max(apart, Math.abs(a[at + channel] - b[at + channel]));
            drawn ||= b[at + channel] !== RESTORE_BACKGROUND[channel];
        }
        if (drawn) covered++;
        if (apart > 0) differing++;
        largest = Math.max(largest, apart);
    }

    return { covered: covered / pixels, differing, largest };
}

/** The frames after the restore whose pictures differ between two runs, with how much. */
function differingFrames(lost, kept) {
    const found = [];

    for (const frame of RESTORE_FRAMES) {
        const a = lost.report.frames.find((entry) => entry.frame === frame);
        const b = kept.report.frames.find((entry) => entry.frame === frame);

        if (!a || !b) {
            found.push({ frame, missing: true });
            continue;
        }
        const pictures = comparePictures(a.pixels, b.pixels);

        if (pictures.differing > 0 || pictures.covered < LEAST_COVER) found.push({ frame, ...pictures });
    }

    return found;
}

/** What is wrong with one run on its own, as a list of sentences. */
function judgeRun(plan, mode, name, side, lose) {
    const { report } = side;
    const reasons = [];
    const all = (values, test) => Array.isArray(values) && values.length > 0 && values.every(test);

    for (const error of side.errors) reasons.push(`${name} logged: ${error}`);
    if (report.error) return [...reasons, `${name} failed: ${report.error}`];
    if (report.drew !== mode) reasons.push(`${name} drew the rig in the ${report.drew} mode`);
    if (plan.clips && !(report.clips > 0)) reasons.push(`${name} had no active clip`);
    if (plan.clips && mode === 'mesh' && !(report.maskDraws > 0)) reasons.push(`${name} drew no clip mask`);
    if (plan.attached && report.placedContainers !== true) reasons.push(`${name} did not place the containers`);
    if (plan.rests && !all(report.skipped, (count) => count === 1)) {
        reasons.push(`${name} did not rest: the updates that returned at once per frame are ${report.skipped}`);
    }
    if (plan.rests && !all(report.placed, (count) => count === 0)) {
        reasons.push(`${name} did not rest: the position and bone uploads per frame are ${report.placed}`);
    }
    if (plan.moves && !all(report.placed, (count) => count > 0)) {
        reasons.push(`${name} did not move: the position and bone uploads per frame are ${report.placed}`);
    }
    if (lose) {
        const { lost, restored, wasLost, back } = report.context ?? {};

        if (lost !== 1 || restored !== 1 || wasLost !== true || back !== true) {
            reasons.push(
                `${name} did not lose and regain its context: ${lost} loss events, ${restored} restore events, ` +
                    `lost in between ${wasLost}, back at the end ${back}`,
            );
        }
    }

    return reasons;
}

/** Why a case fails, as a list of sentences. An empty list is a pass. */
function judgeCase(plan, mode, lost, kept) {
    const reasons = [
        ...judgeRun(plan, mode, 'the run that lost its context', lost, true),
        ...judgeRun(plan, mode, 'the run that kept its context', kept, false),
    ];

    if (lost.report.error || kept.report.error) return reasons;
    for (const entry of differingFrames(lost, kept)) {
        if (entry.missing) reasons.push(`frame ${entry.frame} after the restore has no picture`);
        else if (entry.differing > 0) {
            const share = ((entry.differing / (RESTORE_SIZE * RESTORE_SIZE)) * 100).toFixed(2);

            reasons.push(
                `frame ${entry.frame} after the restore: ${entry.differing} pixels (${share} percent) differ from the run ` +
                    `that kept its context, by up to ${entry.largest} of 255`,
            );
        } else {
            reasons.push(
                `frame ${entry.frame}: the picture is empty, ${(entry.covered * 100).toFixed(1)} percent of it is not the background`,
            );
        }
    }

    return reasons;
}

/** Writes the pictures of one frame of both runs and returns where, or null when there is none. */
function keepPictures(root, dir, id, frame, lost, kept) {
    const written = [];

    for (const [name, side] of [
        ['lost', lost],
        ['kept', kept],
    ]) {
        const png = side.report.frames.find((entry) => entry.frame === frame)?.png;

        if (!png) continue;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${id}__frame${frame}__${name}.png`), Buffer.from(png, 'base64'));
        written.push(name);
    }

    return written.length ? `${relative(root, join(dir, id))}__frame${frame}__{${written.join(',')}}.png` : null;
}

/**
 * Runs the check and returns the number of failures.
 *
 * @param options.pkg The folder of the built pixi-marrow, see `builtPackage` of scripts/render/setup.mjs.
 * @param options.pixi The pixi.js of the pages, as `pixiPackage` returns it.
 * @param options.modes The render modes to run: `mesh`, `batched` or both.
 * @param options.outDir Where the pictures of a failed case go.
 * @param options.only The text of `--only`, or null. With a text that no case id holds, nothing runs and nothing fails.
 * @param options.keep True to write the pictures of the cases that pass too.
 * @param options.skinning The `skinning` option every instance gets, or null for none.
 * @example
 * failed += await checkRestore({ root, pkg, pixi, modes: ['mesh', 'batched'], outDir: join(outDir, 'restore') });
 */
export async function checkRestore({
    root,
    pkg,
    pixi,
    modes = RESTORE_MODES,
    outDir,
    only = null,
    keep = false,
    skinning = null,
}) {
    const jobs = modes
        .flatMap((mode) => RESTORE_CASES.map((plan) => ({ plan, mode, id: `restore/${mode}/${plan.id}` })))
        .filter((job) => !only || job.id.includes(only));

    // the text of --only names rigs or scenes of the render check, and none of these cases
    if (jobs.length === 0) return 0;
    const bundle = await bundleRestore(root, { pkg, pixi: pixi.dir });
    let server;
    let browser;
    let failed = 0;

    try {
        server = await serve(root, bundle.dir);
        browser = await launchChrome();
        const run = (job, lose) => runPage(browser, server.origin, job.plan.id, job.mode, lose, skinning);
        // the tooling proof: a context that stays lost leaves another picture on the canvas
        const [first] = jobs;
        const proof = { lost: await run(first, 'forever'), kept: await run(first, false) };
        const given = [proof.lost, proof.kept].map((side) => side.report.renderer).find((name) => name !== 'webgl');

        if (given !== undefined) {
            console.log(
                `restore-check: webgl is not available here (the browser gave ${given}), so nothing was checked`,
            );

            return 1;
        }
        console.log(
            `restore-check: webgl, pixi.js ${proof.kept.report.pixi}. A run loses its context for ${RESTORE_AWAY} frames and gets it back. ` +
                `Compared with a run that kept its context: the frames ${RESTORE_FRAMES.join(', ')} after the restore. ` +
                `The renderer of the page starts ${proof.kept.report.meshPipeAtInit ? 'with' : 'without'} Pixi's mesh pipe` +
                (skinning ? `. Every instance has skinning: '${skinning}'` : ''),
        );
        if (proof.kept.report.pixi !== pixi.version) {
            console.log(`  FAIL the page runs on pixi.js ${proof.kept.report.pixi}, not on ${pixi.version}`);
            failed++;
        }
        const rejected =
            !proof.lost.report.error && !proof.kept.report.error && differingFrames(proof.lost, proof.kept);

        if (rejected && rejected.length === RESTORE_FRAMES.length) {
            console.log('  ok   proof, a context that stays lost is rejected in every frame');
        } else {
            console.log('  FAIL proof, a context that stays lost must be rejected in every frame');
            console.log(
                `       ${proof.lost.report.error ?? proof.kept.report.error ?? `rejected ${rejected.length} frames`}`,
            );
            failed++;
        }
        for (const job of jobs) {
            const lost = await run(job, true);
            const kept = await run(job, false);
            const reasons = judgeCase(job.plan, job.mode, lost, kept);

            console.log(`  ${reasons.length ? 'FAIL' : 'ok  '} ${job.mode}: ${job.plan.title}`);
            for (const reason of reasons) console.log(`       ${reason}`);
            if (reasons.length) failed++;
            else if (!keep) continue;
            const frame = differingFrames(lost, kept).find((entry) => !entry.missing)?.frame ?? RESTORE_FRAMES[0];
            const written = keepPictures(root, outDir, `${job.mode}-${job.plan.id}`, frame, lost, kept);

            if (written) console.log(`       pictures: ${written}`);
        }
    } finally {
        await browser?.close();
        server?.close();
        bundle.remove();
    }

    return failed;
}

/** The check as a command of its own. Returns the exit code. */
async function main() {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const args = parseArgs();
    const failed = await checkRestore({
        root,
        pkg: builtPackage(root, args.dist, 'restore-check'),
        pixi: pixiPackage(root, args.pixi, 'restore-check'),
        modes: RESTORE_MODES.includes(args['render-mode']) ? [args['render-mode']] : RESTORE_MODES,
        outDir: resolve(root, args.out ?? '.shots/restore'),
        only: args.only ?? null,
        keep: args.keep === 'true',
        skinning: args.skinning ?? null,
    });

    console.log(failed ? `restore-check: ${failed} failures` : 'restore-check: ok');

    return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error(`restore-check: ${error.message}`);
        process.exitCode = 1;
    }
}
