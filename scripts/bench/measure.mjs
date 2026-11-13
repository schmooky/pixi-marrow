/**
 * The part of the bench that drives a page: one subject of a run on a page of its own, block by
 * block. A subject is a rig in a scene, see scripts/bench/scenes.mjs.
 */
import { modeOptions } from '../render/mode.js';
import { inTime } from '../render/setup.mjs';
import { needsMesh } from './verdict.mjs';

/** A sample of the A/B mode spans at least this many instance updates, see the usage text of the bench. */
const GROUP_INSTANCES = 4;
const PAGE_TIMEOUT = 60_000;
const BLOCK_TIMEOUT = 240_000;

/** Runs something in the page, and gives up after a time. */
const inPage = (page, timeout, run, argument) => inTime(page.evaluate(run, argument), timeout);

/** A list of milliseconds with four decimals: the clock of a page is no finer. */
const rounded = (values) => values.map((ms) => Math.round(ms * 1e4) / 1e4);

/**
 * The sides of a subject in the A/B mode. `runtime` is the runtime of the page that draws a side
 * and `options` what its display objects are created with. The side `mesh` is ours once more,
 * with the mesh mode asked for by name. It runs in the scene `play`, where the list of
 * milestone M5 asks for it.
 *
 * @param config `renderMode` is what ours is asked for, `meshSide` the value of `--mesh`, and
 * `idleSide` adds ours with the idle cache on as the side `idle`.
 */
export function sidesOf(subject, { renderMode, meshSide, idleSide }) {
    const sides = [
        { side: 'ours', runtime: 'ours', options: modeOptions(renderMode) },
        { side: 'official', runtime: 'official', options: {} },
    ];
    const wanted = meshSide === 'all' || (meshSide === 'verdict' && needsMesh(subject.rig));

    if (wanted && renderMode !== 'mesh' && subject.scene === 'play') {
        sides.push({ side: 'mesh', runtime: 'ours', options: modeOptions('mesh') });
    }
    if (idleSide)
        sides.push({ side: 'idle', runtime: 'ours', options: { ...modeOptions(renderMode), idleCache: 'auto' } });

    return sides;
}

/**
 * The blocks of one run of a subject in the A/B mode, in the order they are measured. The side
 * that goes first moves on with every run.
 */
function blocksOfRun(run, renderer, sides, subject, config) {
    const order = sides.map((_, index) => sides[(index + run) % sides.length]);

    return subject.counts.flatMap((instances) =>
        order.map((side) => ({
            ...side,
            // the page plays the animation of the scene `little` like any other
            scene: subject.scene === 'little' ? 'play' : subject.scene,
            frames: subject.frames ?? config.frames,
            warmup: config.warmup,
            instances,
            group: renderer === 'webgl' ? Math.max(1, Math.ceil(GROUP_INSTANCES / instances)) : 1,
        })),
    );
}

/** What a block or a setting of a turn measured, with the times rounded, or its error alone. */
function timedPart(raw) {
    if (raw.error) return { error: raw.error };

    return { ...raw, update: rounded(raw.update), submit: rounded(raw.submit), wait: rounded(raw.wait) };
}

/** The A/B mode: runs the blocks of every run of a subject and adds what they measured to `blocks`. */
async function measureBlocks(page, renderer, subject, config, blocks) {
    const sides = sidesOf(subject, config);

    for (let run = 0; run < config.runs; run++) {
        for (const job of blocksOfRun(run, renderer, sides, subject, config)) {
            const raw = await inPage(page, BLOCK_TIMEOUT, (it) => window.bench.block(it), job);

            blocks.push({
                run,
                side: job.side,
                setting: null,
                instances: job.instances,
                group: job.group,
                ...timedPart(raw),
            });
        }
    }
}

/**
 * The overdraw mode: per run the settings take turns in one scene, which gives one entry of
 * `blocks` per setting and one for `quarter`, the first setting at half its size.
 *
 * @param config `tightSettings` are the settings of `tightMesh`, `turn` the frames of a turn
 * and how many of them are not kept.
 */
async function measureTurns(page, subject, config, blocks) {
    const { turn, tightSettings, renderMode } = config;
    const kept = turn.span - turn.skip;
    // every setting of tightMesh in the render mode of this run
    const modes = tightSettings.map((setting) => ({
        ...setting,
        options: { ...setting.options, ...modeOptions(renderMode) },
    }));
    const job = { settings: modes, warmup: config.warmup, rounds: Math.ceil(config.frames / kept), ...turn };

    for (let run = 0; run < config.runs; run++) {
        for (const instances of subject.counts) {
            const raw = await inPage(page, BLOCK_TIMEOUT, (it) => window.bench.turns(it), { ...job, instances });
            const common = { run, side: 'ours', instances, group: 1 };

            if (raw.error) blocks.push({ ...common, setting: 'every setting', error: raw.error });
            for (const setting of raw.settings ?? []) {
                blocks.push({ ...common, setting: setting.name, covered: raw.covered, ...timedPart(setting) });
            }
        }
    }
}

/**
 * Measures every block of one subject on a page of its own.
 *
 * @param config The settings of the run: `mode`, `renderMode`, `meshSide`, `runs`, `frames`,
 * `warmup`, and `width` and `height` of the canvas.
 * @returns The state of the page, the blocks, the errors of the page and `crash` when it failed.
 */
export async function runSubject(browser, origin, renderer, subject, config) {
    const page = await browser.newPage();
    const errors = [];
    const blocks = [];
    // what the page says about itself, once it is up
    let state = { renderer };
    const official = config.mode === 'ab' ? subject.official : 'none';
    const query = `renderer=${renderer}&official=${official}&width=${config.width}&height=${config.height}`;

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
        await page.waitForFunction(() => window.bench, null, { timeout: PAGE_TIMEOUT });
        state = await page.evaluate(() => ({
            ...window.bench,
            load: undefined,
            block: undefined,
            turns: undefined,
            hold: undefined,
        }));

        if (state.error || state.renderer !== renderer) return { state, blocks, errors };
        // a page with a side that asks for the mesh mode by name loads its assets for that mode
        const mesh =
            config.mode === 'ab'
                ? sidesOf(subject, config).some((side) => side.options.renderMode === 'mesh')
                : config.renderMode === 'mesh';

        await inPage(page, PAGE_TIMEOUT, ([plans, forMesh]) => window.bench.load(plans, forMesh), [
            subject.plans,
            mesh,
        ]);
        if (config.mode === 'overdraw') await measureTurns(page, subject, config, blocks);
        else await measureBlocks(page, renderer, subject, config, blocks);

        return { state, blocks, errors };
    } catch (error) {
        return { state, blocks, crash: error.message.split('\n')[0], errors };
    } finally {
        await page.close().catch(() => {});
    }
}
