#!/usr/bin/env node
/**
 * The page of the render check that is bundled as a game is.
 *
 * The other pages of the check import the whole of Pixi, so every part of Pixi that registers
 * itself when its module is evaluated is there before a renderer exists. A game imports
 * `Application` and a few classes by name, and its bundler shakes the tree. What the game does
 * not use is then missing from its renderer. That is no fault of the game: pixi-marrow must
 * bring what it needs, also when the code that needs it arrives in a chunk after the renderer
 * was initialized. The mesh mode once did not, and failed in a real game on the first mesh.
 *
 * This check runs the cases of scripts/render/game.js twice, each case in a page of its own:
 * in a bundle made as a game makes one, and in a bundle with the whole of Pixi. See
 * scripts/render/game-bundle.mjs. A case fails when its page throws, when the rig did not draw
 * in the mode the case is about, or when a pixel of the canvas differs between the two
 * bundles. It also fails when the renderer of the game had Pixi's mesh pipe from its start
 * although no rig asked for the mesh mode before: the tree was not shaken then, and the case
 * proves nothing.
 *
 * Usage: node scripts/render/game-check.mjs [--renderer=webgl|webgpu] [--pixi=<version>]
 *        [--dist=<folder>] [--only=game/mesh] [--out=<folder>] [--keep]
 *
 * The arguments mean what they mean for scripts/check-render.mjs. Without `--renderer` both
 * renderers run. `--only` keeps the cases whose id holds the text: an id is `game/` and the id
 * of the case in scripts/render/game.js. Pictures of a failed case are written below `--out`,
 * default `.shots/game`. `--keep` writes the pictures of every case.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_BACKGROUND, GAME_CASES, GAME_SIZE } from './game.js';
import { bundleGame } from './game-bundle.mjs';
import { writeLargeRig } from './scene-plan-sleep.mjs';
import { serve } from './serve.mjs';
import { builtPackage, inTime, launchChrome, parseArgs, pixiPackage } from './setup.mjs';

/** How long one case may take in one page, in milliseconds. */
const CASE_TIMEOUT = 60_000;

/** The least share of the canvas a rig must cover for its picture to count as one. */
const LEAST_COVER = 0.02;

/** Runs one case in a page of one bundle. Returns what the page reported and the errors it logged. */
async function runCase(browser, origin, renderer, id) {
    const page = await browser.newPage();
    const errors = [];

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} for ${response.url()}`);
    });
    page.on('console', (entry) => {
        if (entry.type() === 'error' && !/Failed to load resource/.test(entry.text())) errors.push(entry.text());
    });
    try {
        await page.goto(`${origin}/`);
        await page.waitForFunction(() => window.gameCheck, null, { timeout: 30_000 });
        const report = await inTime(
            page.evaluate(([name, wanted]) => window.gameCheck.run(name, wanted), [id, renderer]),
            CASE_TIMEOUT,
        );

        return { report, errors };
    } catch (error) {
        return { report: { error: error.message.split('\n')[0], renderer: null }, errors };
    } finally {
        await page.close().catch(() => {});
    }
}

/**
 * Compares two pictures of the canvas. `covered` is the share of the first that is not the
 * background, `differing` the number of pixels with another byte, `largest` the largest
 * difference of a byte.
 */
function comparePictures(first, second) {
    const a = Buffer.from(first, 'base64');
    const b = Buffer.from(second, 'base64');
    const pixels = GAME_SIZE * GAME_SIZE;
    let covered = 0;
    let differing = 0;
    let largest = 0;

    if (a.length !== pixels * 4 || b.length !== pixels * 4) return { covered: 0, differing: pixels, largest: 255 };
    for (let at = 0; at < a.length; at += 4) {
        let apart = 0;
        let drawn = false;

        for (let channel = 0; channel < 4; channel++) {
            apart = Math.max(apart, Math.abs(a[at + channel] - b[at + channel]));
            drawn ||= a[at + channel] !== GAME_BACKGROUND[channel];
        }
        if (drawn) covered++;
        if (apart > 0) differing++;
        largest = Math.max(largest, apart);
    }

    return { covered: covered / pixels, differing, largest };
}

/** Why a case fails, as a list of sentences. An empty list is a pass. */
function judgeCase(plan, game, whole) {
    const reasons = [];

    for (const [name, side] of [
        ['the bundle of a game', game],
        ['the bundle with the whole of Pixi', whole],
    ]) {
        if (side.report.error) reasons.push(`${name} failed: ${side.report.error}`);
        for (const error of side.errors) reasons.push(`${name} logged: ${error}`);
        if (side.report.error) continue;
        if (side.report.mode !== plan.mode) {
            reasons.push(
                `${name} drew the rig in the ${side.report.mode} mode, the case is about the ${plan.mode} mode`,
            );
        }
        if (plan.clips && !(side.report.clips > 0)) reasons.push(`${name} had no active clip`);
        if (plan.attached && side.report.placed !== true) reasons.push(`${name} did not place the container`);
    }
    if (!plan.early && game.report.meshPipe?.atInit === true) {
        reasons.push(
            "the renderer of the game had Pixi's mesh pipe when it was initialized, so its tree was not shaken " +
                'and the case proves nothing',
        );
    }
    if (game.report.error || whole.report.error) return reasons;
    const pictures = comparePictures(game.report.pixels, whole.report.pixels);

    if (pictures.covered < LEAST_COVER) {
        reasons.push(
            `the picture is empty: ${(pictures.covered * 100).toFixed(1)} percent of it is not the background`,
        );
    }
    if (pictures.differing > 0) {
        reasons.push(
            `${pictures.differing} pixels differ between the two bundles, by up to ${pictures.largest} of 255`,
        );
    }

    return reasons;
}

/** Writes the pictures of a failed case and returns where, or null when there is none. */
function keepPictures(root, dir, plan, game, whole) {
    const kept = [];

    for (const [name, side] of [
        ['game', game],
        ['whole', whole],
    ]) {
        if (!side.report.png) continue;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${plan.id}__${name}.png`), Buffer.from(side.report.png, 'base64'));
        kept.push(name);
    }

    return kept.length ? `${relative(root, join(dir, plan.id))}__{${kept.join(',')}}.png` : null;
}

/** Where each bundle holds Pixi's mesh pipe, as a sentence. */
function describeBundles(meshPipe) {
    const where = {
        start: 'loads it at its start',
        chunk: 'holds it in a chunk that loads on demand',
        none: 'does not hold it',
    };

    return `Pixi's mesh pipe: the bundle of a game ${where[meshPipe.game]}, the bundle with the whole of Pixi ${where[meshPipe.whole]}`;
}

/** The first line a renderer prints: the pipes each bundle gives a renderer at its start. */
function describePipes(renderer, version, game, whole) {
    const has = new Set(game.report.pipes ?? []);
    const more = (whole.report.pipes ?? []).filter((pipe) => !has.has(pipe));

    return (
        `game-check: ${renderer}, pixi.js ${version}. The renderer of a game starts with the render pipes ` +
        `${[...has].join(', ')}. The whole of Pixi adds: ${more.length ? more.join(', ') : 'none'}`
    );
}

/**
 * Runs the check and returns the number of failures.
 *
 * @param options.pkg The folder of the built pixi-marrow, see `builtPackage` of scripts/render/setup.mjs.
 * @param options.pixi The pixi.js of the pages, as `pixiPackage` returns it.
 * @param options.renderers The renderers to run: `webgl`, `webgpu` or both.
 * @param options.outDir Where the pictures of a failed case go.
 * @param options.only The text of `--only`, or null. With a text that no case id holds, nothing runs and nothing fails.
 * @param options.keep True to write the pictures of the cases that pass too.
 * @example
 * failed += await checkGame({ root, pkg, pixi, renderers: wanted, outDir: join(outDir, 'game') });
 */
export async function checkGame({ root, pkg, pixi, renderers, outDir, only = null, keep = false }) {
    const cases = GAME_CASES.filter((plan) => !only || `game/${plan.id}`.includes(only));

    // the text of --only names rigs or scenes of the render check, and none of these cases
    if (cases.length === 0) return 0;
    const bundle = await bundleGame(root, { pkg, pixi: pixi.dir });
    const servers = [];
    let browser;
    let failed = 0;
    let ran = 0;

    try {
        // the large rig of a case: no example is one
        writeLargeRig(root, bundle.made);
        console.log(`game-check: ${describeBundles(bundle.meshPipe)}`);
        if (bundle.meshPipe.game === 'start') {
            console.log(
                "game-check: FAIL the bundle of a game holds Pixi's mesh pipe from its start: its tree was not shaken",
            );
            failed++;
        }
        const game = await serve(root, bundle.game, { made: bundle.made });
        const whole = await serve(root, bundle.whole, { made: bundle.made });

        servers.push(game, whole);
        browser = await launchChrome();
        for (const renderer of renderers) {
            let announced = false;

            for (const plan of cases) {
                const sides = [
                    await runCase(browser, game.origin, renderer, plan.id),
                    await runCase(browser, whole.origin, renderer, plan.id),
                ];
                const given = sides.map((side) => side.report.renderer).find((name) => name && name !== renderer);

                if (given) {
                    console.log(`game-check: ${renderer} is not available here (the browser gave ${given})`);
                    // a renderer that was asked for by name must be there
                    if (renderers.length === 1) failed++;
                    break;
                }
                if (!announced) console.log(describePipes(renderer, pixi.version, ...sides));
                announced = true;
                const reasons = judgeCase(plan, ...sides);

                console.log(`  ${reasons.length ? 'FAIL' : 'ok  '} ${plan.title}`);
                for (const reason of reasons) console.log(`       ${reason}`);
                if (reasons.length) failed++;
                else if (!keep) continue;
                const kept = keepPictures(root, join(outDir, renderer), plan, ...sides);

                if (kept) console.log(`       pictures: ${kept}`);
            }
            if (announced) ran++;
        }
    } finally {
        await browser?.close();
        for (const server of servers) server.close();
        bundle.remove();
    }
    if (ran === 0) {
        console.log('game-check: no renderer came up, so nothing was checked');
        failed++;
    }

    return failed;
}

/** The check as a command of its own. Returns the exit code. */
async function main() {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const args = parseArgs();
    const failed = await checkGame({
        root,
        pkg: builtPackage(root, args.dist, 'game-check'),
        pixi: pixiPackage(root, args.pixi, 'game-check'),
        renderers: ['webgl', 'webgpu'].includes(args.renderer) ? [args.renderer] : ['webgl', 'webgpu'],
        outDir: resolve(root, args.out ?? '.shots/game'),
        only: args.only ?? null,
        keep: args.keep === 'true',
    });

    console.log(failed ? `game-check: ${failed} failures` : 'game-check: ok');

    return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error(`game-check: ${error.message}`);
        process.exitCode = 1;
    }
}
