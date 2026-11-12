#!/usr/bin/env node
/**
 * Measures pixi-marrow against the official Pixi runtime in headless Chrome on the real GPU:
 * the same rigs, animations, instance counts, canvas and build of pixi.js on both sides. It
 * shares the page server, the browser start and the plan of the render check.
 *
 * usage: pnpm bench:ab [--mode=ab|overdraw] [--render-mode=auto|mesh|batched] [--mesh=verdict|all|none]
 *                      [--rigs=4.2/tank-pro,raptor] [--instances=1,50,200] [--renderer=webgl|webgpu|both]
 *                      [--runs=3] [--frames=200] [--warmup=40] [--size=1280x720] [--out=.bench]
 *                      [--memory=all|off] [--check]
 *
 * The values above are the defaults of the A/B mode. The overdraw mode has its own: 24 instances,
 * 5 runs of 100 frames per setting after 30, on a canvas of 1920x1080.
 *
 * --render-mode is the render mode of pixi-marrow in both modes of the bench. `auto` is the
 * default of the runtime: its display objects get no option, as an application creates them.
 * `mesh` and `batched` ask for a mode by name. The page reads back the mode the runtime drew in,
 * see scripts/render/mode.js, and the table of a rig says so. A runtime that reports no mode has
 * one render path and ignores the option.
 *
 * --mode=ab (the default). Per rig and instance count a block of each side runs: the instances
 * are created, play a looping animation for the warm-up frames, then every frame is timed.
 * A third side, `mesh`, is pixi-marrow with the mesh mode asked for by name. It tells what the
 * render mode of `ours` gains or costs against the mesh mode, in the same seconds. --mesh says
 * for which rigs it runs: `verdict` (the default) for the rigs the verdict needs it for, `all`
 * for every rig, `none` for no rig. With --render-mode=mesh it never runs.
 *
 *   update ms    what the runtime does on the CPU when it is asked to advance all instances by
 *                1/60 second: `spine.update(dt)` on both sides, each with its own ticker off
 *   cpu ms       the update plus the CPU part of the render: `renderer.render(stage)` until the
 *                frame is handed to the GPU process. The official runtime computes its vertices
 *                when it is drawn and pixi-marrow when it is updated, so this is the CPU time of
 *                a frame, like for like. What else uses the GPU does not change it
 *   render ms    `renderer.render(stage)` and the wait for the GPU to finish it. On WebGL that
 *                wait is a read of one pixel, because `gl.finish()` does not wait in Chrome. On
 *                WebGPU it is `device.queue.onSubmittedWorkDone()`, which also takes a turn of the
 *                event loop. This is CPU submit plus GPU completion, not a pure GPU time
 *   frame ms     the update and the render of the same frame added up
 *   draws        draw calls per frame, counted on the GPU interface for both sides alike
 *   heap KB      `usedJSHeapSize` after the warm-up minus before the instances were created,
 *                divided by the instance count, with a garbage collection before both readings
 *   page KB      the same from `performance.measureUserAgentSpecificMemory`, the memory of the
 *                whole page. The header of a run says which of the two counts typed arrays.
 *                Neither counts the buffers and textures the GPU process holds
 *
 * The sides take turns inside one page, and the side that goes first changes with every run.
 * A time is the median over the runs. `+-` is half the distance between the fastest and the
 * slowest run. A ratio with a question mark is inside that spread: the runs of the two sides
 * overlap.
 *
 * The memory is not read in those blocks. Every memory number comes from a page of its own that
 * has drawn nothing before. A stage keeps what it drew last, so a block on a used stage starts
 * with the instances of the block before it still in memory: scripts/bench/heap.mjs has the
 * measurement that showed it. Every side is read twice, the second time with the sides in the
 * opposite order, and the `+-` next to the heap is half the distance between the two readings.
 * One more page reads an empty block, which must read about nothing. The memory is read at the
 * largest instance count. --memory=all reads it at every count from 20 on: below that, what the
 * first instance allocates once is more than a few instances hold. --memory=off reads none.
 * Under the table of a rig, the heap at the largest count is split into the stores of typed
 * arrays and the objects, and the objects by the package whose code allocated them.
 *
 * `med` and `p95` are over the samples of a run. A sample is one frame. On WebGL with fewer than
 * 4 instances it is the mean of some frames in a row, 4 for one instance. The clock of a page
 * steps by 0.005 ms, and one small instance updates in a few such steps. On WebGPU a sample is
 * always one frame, so the update time of a few instances is coarse there. The update itself is
 * the same code on both renderers.
 *
 * --mode=overdraw decides whether `tightMesh: 'on'` pays. Only pixi-marrow runs, with
 * `tightMesh` off, auto (the default) and on. The instances are scaled until the frame of the rig
 * covers the canvas and lie on top of each other, so the GPU fills the canvas many times.
 *
 * The instances of all three settings are on the stage and one setting at a time is visible. The
 * settings take turns of 12 frames, of which the first 2 are not kept, in an order that moves on
 * with every round. So each setting is timed in the same seconds as the others. That matters.
 * Measured on an Apple M4 on battery, the same scene took 3.9 ms in one minute and 10.5 ms in
 * another. Blocks of one setting each could not tell the settings apart.
 *
 * The render time of the three settings is printed side by side with the fastest and the slowest
 * run. The last column is the change against `off` in each run: its median, and the smallest
 * and the largest. A difference counts only when it has the same sign in every run. With 5 runs
 * chance alone does that once in 16 times. One more turn draws `off` at half its size, which is
 * the same work on a quarter of the pixels. Its time against `off` tells whether the frame is
 * bound by fill.
 *
 * Other programs on the GPU make the waits longer. Measured on an Apple M4 with a desktop in
 * use: a light frame waited 6 to 9 ms once in every 16.7 ms, which the median hides. Frames that
 * needed 10 to 16 ms all took 16.7 ms, whatever their work was, so such a time says little.
 * Before a rig loads, its page times an empty stage, and the run says what share of that time
 * was waits.
 *
 * The A/B mode ends with a verdict: the list of milestone M5 that says when the batched mode is
 * done, rule by rule, per renderer and rig, at 200 instances. See scripts/bench/verdict.mjs. A
 * time that lies inside the spread of the runs is undecided, never a pass. --check makes the exit
 * code follow the verdict: 1 when a rule fails, 2 when none fails and one is undecided or was
 * not measured.
 *
 * The time step is fixed at 1/60 second. Instances start at different places of the loop. The
 * raw numbers of every block go to a JSON file in `.bench/`. The exit code is not 0 when a side
 * fails to load, throws, or draws nothing.
 *
 * The numbers hold for the machine they were taken on. Rigs with physics constraints or sliders
 * are marked: both sides must solve them for the comparison to be like for like.
 *
 * Runs the installed Google Chrome, see scripts/render/setup.mjs. The package is built first when
 * it has no build or the sources are newer.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modeOptions } from '../render/mode.js';
import { planRigs } from '../render/plan.mjs';
import { bundlePage, serve } from '../render/serve.mjs';
import { ensureBuilt, inTime, launchChrome, parseArgs } from '../render/setup.mjs';
import { measureSides, readModules } from './heap.mjs';
import { describeMachine, describeVersions, ignoredByGit } from './machine.mjs';
import { blockFailure, reportAb, reportOverdraw } from './rig-report.mjs';
import { describePage } from './table.mjs';
import { judgeVerdict, needsMesh, printVerdict } from './verdict.mjs';

/**
 * The rigs of a run without --rigs. They differ in kind: a rigid rig with few bones, a rig of
 * weighted meshes, a small rig that clips, a rig with physics and a rig with many slots. Both
 * official runtimes are among them.
 */
const DEFAULT_RIGS = {
    ab: ['4.2/speedy-ess', '4.3/raptor-pro', '4.2/coin-pro', '4.3/sack-pro', '4.2/tank-pro'],
    // rigs of regions, where an outline can cut, and one of meshes, where it cannot
    overdraw: ['4.2/dragon-ess', '4.3/spineboy-pro', '4.2/tank-pro', '4.3/chibi-stickers', '4.3/raptor-pro'],
};
const DEFAULTS = {
    ab: { instances: '1,50,200', size: '1280x720', runs: 3, frames: 200, warmup: 40 },
    // Enough instances for a frame that is bound by fill, and enough runs for the last column to
    // mean something. `frames` is what every setting keeps per run
    overdraw: { instances: '24', size: '1920x1080', runs: 5, frames: 100, warmup: 30 },
};
/** Frames of one turn of a setting in the overdraw mode, and how many of them are not kept. */
const TURN = { span: 12, skip: 2 };
/** The settings of `tightMesh` in the overdraw mode, with the options of a display object. */
const SETTINGS = [
    { name: 'off', options: { tightMesh: 'off' } },
    { name: 'auto', options: {} },
    { name: 'on', options: { tightMesh: 'on' } },
];
/** The share of the time of an empty stage that went into waits for other programs, from which a rig gets a note. */
const BUSY_NOTE = 0.1;
/** A sample of the A/B mode spans at least this many instance updates, see the usage text. */
const GROUP_INSTANCES = 4;
const PAGE_TIMEOUT = 60_000;
const BLOCK_TIMEOUT = 240_000;
/**
 * Exact numbers from `performance.memory`, a `gc()` the page can call, and a memory measurement
 * of the page that answers at once and not at the next garbage collection of the browser.
 */
const BENCH_FLAGS = [
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    '--enable-blink-features=ForceEagerMeasureMemory',
];

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = parseArgs();
const mode = args.mode === 'overdraw' ? 'overdraw' : 'ab';
const wanted = ['webgl', 'webgpu'].includes(args.renderer) ? [args.renderer] : ['webgl', 'webgpu'];
const counts = (args.instances ?? DEFAULTS[mode].instances).split(',').map(Number);
const [width, height] = (args.size ?? DEFAULTS[mode].size).split('x').map(Number);
const renderMode = ['mesh', 'batched'].includes(args['render-mode']) ? args['render-mode'] : 'auto';
const meshSide = ['all', 'none'].includes(args.mesh) ? args.mesh : 'verdict';
const settings = {
    mode,
    // the render mode of ours, and for which rigs the A/B mode adds ours in the mesh mode as a third side
    renderMode,
    meshSide,
    runs: Number(args.runs ?? DEFAULTS[mode].runs),
    frames: Number(args.frames ?? DEFAULTS[mode].frames),
    warmup: Number(args.warmup ?? DEFAULTS[mode].warmup),
    instances: counts,
    canvas: [width, height],
};

/** Runs something in the page, and gives up after a time. */
const inPage = (page, timeout, run, argument) => inTime(page.evaluate(run, argument), timeout);

/**
 * The sides of a rig in the A/B mode. `runtime` is the runtime of the page that draws a side and
 * `options` what its display objects are created with. The side `mesh` is ours once more, with
 * the mesh mode asked for by name.
 */
function sidesOf(rig) {
    const sides = [
        { side: 'ours', runtime: 'ours', options: modeOptions(renderMode) },
        { side: 'official', runtime: 'official', options: {} },
    ];
    const wanted = meshSide === 'all' || (meshSide === 'verdict' && needsMesh(rig));

    if (wanted && renderMode !== 'mesh') sides.push({ side: 'mesh', runtime: 'ours', options: modeOptions('mesh') });

    return sides;
}

/**
 * The blocks of one run of a rig in the A/B mode, in the order they are measured. The side that
 * goes first moves on with every run.
 */
function blocksOfRun(run, renderer, sides) {
    const common = { frames: settings.frames, warmup: settings.warmup };
    const order = sides.map((_, index) => sides[(index + run) % sides.length]);

    return counts.flatMap((instances) =>
        order.map((side) => ({
            ...common,
            ...side,
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

/** The A/B mode: runs the blocks of every run of a rig and adds what they measured to `blocks`. */
async function measureBlocks(page, renderer, rig, blocks) {
    const sides = sidesOf(rig);

    for (let run = 0; run < settings.runs; run++) {
        for (const job of blocksOfRun(run, renderer, sides)) {
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
 */
async function measureTurns(page, blocks) {
    const kept = TURN.span - TURN.skip;
    // every setting of tightMesh in the render mode of this run
    const modes = SETTINGS.map((setting) => ({
        ...setting,
        options: { ...setting.options, ...modeOptions(renderMode) },
    }));
    const job = { settings: modes, warmup: settings.warmup, rounds: Math.ceil(settings.frames / kept), ...TURN };

    for (let run = 0; run < settings.runs; run++) {
        for (const instances of counts) {
            const raw = await inPage(page, BLOCK_TIMEOUT, (it) => window.bench.turns(it), { ...job, instances });
            const common = { run, side: 'ours', instances, group: 1 };

            if (raw.error) blocks.push({ ...common, setting: 'every setting', error: raw.error });
            for (const setting of raw.settings ?? []) {
                blocks.push({ ...common, setting: setting.name, covered: raw.covered, ...timedPart(setting) });
            }
        }
    }
}

/** Measures every block of one rig on a page of its own. Returns the state of the page and the blocks. */
async function runRig(browser, origin, renderer, rig) {
    const page = await browser.newPage();
    const errors = [];
    const blocks = [];
    // what the page says about itself, once it is up
    let state = { renderer };
    const official = mode === 'ab' ? rig.official : 'none';
    const query = `renderer=${renderer}&official=${official}&width=${width}&height=${height}`;

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
        }));

        if (state.error || state.renderer !== renderer) return { state, blocks, errors };
        await inPage(page, PAGE_TIMEOUT, (plan) => window.bench.load(plan), rig);
        if (mode === 'overdraw') await measureTurns(page, blocks);
        else await measureBlocks(page, renderer, rig, blocks);

        return { state, blocks, errors };
    } catch (error) {
        return { state, blocks, crash: error.message.split('\n')[0], errors };
    } finally {
        await page.close().catch(() => {});
    }
}

/** A list of milliseconds with four decimals: the clock of a page is no finer. */
const rounded = (values) => values.map((ms) => Math.round(ms * 1e4) / 1e4);

async function main() {
    ensureBuilt(root, 'bench');
    const planned = await planRigs({ root, size: 512, animations: 1, only: null });
    const patterns = args.rigs ? args.rigs.split(',').filter(Boolean) : DEFAULT_RIGS[mode];
    const matching = planned.filter((rig) => patterns.some((pattern) => rig.id.includes(pattern)));
    // Spine 4.1 has no official Pixi v8 runtime to measure against
    const rigs = mode === 'ab' ? matching.filter((rig) => rig.official) : matching;

    for (const rig of matching) {
        if (!rigs.includes(rig)) console.log(`bench: ${rig.id} is left out, Spine 4.1 has no official Pixi runtime`);
    }
    if (rigs.length === 0) throw new Error(`no rig to measure for --rigs=${patterns.join(',')}`);
    const bundle = await bundlePage(root, 'scripts/bench/page.js');
    const server = await serve(root, bundle.dir, { isolated: true });
    const browser = await launchChrome(BENCH_FLAGS);
    const chunks = readModules(bundle.dir);
    const result = {
        tool: 'pixi-marrow bench:ab',
        date: new Date().toISOString(),
        command: `node scripts/bench/ab.mjs ${process.argv.slice(2).join(' ')}`.trim(),
        settings,
        machine: describeMachine(browser.version()),
        versions: describeVersions(root),
        renderers: [],
    };
    let failed = 0;
    let ran = 0;

    console.log(
        `bench: ${mode} mode, ours with renderMode ${renderMode}, ${result.machine.cpu} with ${result.machine.cores} cores` +
            `${result.machine.power ? ` on ${result.machine.power}` : ''}, Chrome ${result.machine.chrome}, ` +
            `canvas ${width}x${height}, ${settings.runs} runs of ${settings.frames} frames after ${settings.warmup}, dt 1/60 s`,
    );
    try {
        for (const renderer of wanted) {
            const entry = { renderer, rigs: [] };
            let announced = false;

            for (const rig of rigs) {
                const [sequence] = rig.sequences;
                const started = Date.now();
                const { state, blocks, crash, errors } = await runRig(browser, server.origin, renderer, rig);

                if (state.step !== 'load' && (state.error || state.renderer !== renderer)) {
                    const why = state.error ?? `the browser gave ${state.renderer}`;

                    console.log(`bench: ${renderer} is not available here (${why}), its blocks did not run`);
                    // a renderer that was asked for by name must be there
                    if (wanted.length === 1) failed++;
                    break;
                }
                if (!announced && state.gpu) {
                    console.log(`bench: ${renderer} (${state.gpu}), pixi.js ${state.pixi}`);
                    for (const line of describePage(state)) console.log(`  ${line}`);
                    Object.assign(entry, {
                        gpu: state.gpu,
                        pixi: state.pixi,
                        timerStep: state.timerStep,
                        emptyFrame: state.emptyFrame,
                        isolated: state.isolated,
                        memory: state.memory,
                    });
                    announced = true;
                }
                const solves = [rig.physics && 'physics', rig.slider && 'a slider'].filter(Boolean).join(' and ');
                const { bones, slots, meshVertices } = rig.counts;
                const what =
                    mode === 'ab'
                        ? `against spine-pixi-v8 ${result.versions[`spine-pixi-v8 for ${rig.official}`]}`
                        : `${counts.join(' and ')} instances cover the canvas`;

                console.log(
                    `  ${rig.id}  plays ${sequence.animation}${sequence.skin ? ` (${sequence.skin})` : ''}, ` +
                        `${bones} bones, ${slots} slots, ${meshVertices} mesh vertices, ${what}` +
                        `${solves ? `. Has ${solves}: like for like only when both sides solve it` : ''}`,
                );
                if (crash || state.error) {
                    console.log(`    FAIL the page failed: ${crash ?? state.error}`);
                    failed++;
                }
                if (state.emptyFrame?.busy > BUSY_NOTE) {
                    const { busy, median, max } = state.emptyFrame;

                    console.log(
                        `    note: other programs kept the GPU busy for ${(100 * busy).toFixed(0)}% of the time before this rig. ` +
                            `An empty frame took ${median.toFixed(3)} ms and up to ${max.toFixed(1)} ms. ` +
                            'Trust update ms and cpu ms. Read render ms and frame ms with care',
                    );
                }
                for (const block of blocks) {
                    const why = blockFailure(block);

                    if (!why) continue;
                    const name = `${block.setting ?? block.side}, ${block.instances} instances, run ${block.run + 1}`;

                    console.log(`    FAIL ${name}: ${why}`);
                    failed++;
                }
                for (const error of errors) console.log(`    error ${error}`);
                if (errors.length) failed++;
                const memory =
                    mode === 'ab' && blocks.length > 0 && args.memory !== 'off'
                        ? await measureSides({ browser, origin: server.origin, renderer, width, height, chunks }, rig, {
                              sides: sidesOf(rig),
                              counts,
                              all: args.memory === 'all',
                          })
                        : [];

                for (const reading of memory.filter((entry) => entry.error)) {
                    console.log(`    FAIL memory of ${reading.side}, ${reading.instances} instances: ${reading.error}`);
                    failed++;
                }
                const summary = blocks.length
                    ? mode === 'ab'
                        ? reportAb(blocks, memory, { counts, renderMode })
                        : reportOverdraw(blocks, { counts, runs: settings.runs, names: SETTINGS.map((it) => it.name) })
                    : null;

                entry.rigs.push({
                    id: rig.id,
                    animation: sequence.animation,
                    skin: sequence.skin,
                    features: rig.features,
                    counts: rig.counts,
                    emptyFrame: state.emptyFrame ?? null,
                    seconds: (Date.now() - started) / 1000,
                    summary,
                    memory,
                    blocks,
                });
            }
            if (!announced) continue;
            ran++;
            result.renderers.push(entry);
        }
    } finally {
        await browser.close();
        server.close();
        bundle.remove();
    }
    if (ran === 0) {
        console.log('bench: no renderer came up, so nothing was measured');
        failed++;
    }
    // the verdict is about the A/B numbers, so it is part of the JSON file too
    if (mode === 'ab') {
        result.verdict = judgeVerdict(result, wanted);
        printVerdict(result.verdict);
    }
    const outDir = resolve(root, args.out ?? '.bench');
    const file = join(outDir, `${mode}-${result.date.replace(/[-:]/g, '').replace(/\..*$/, '')}.json`);

    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(result)}\n`);
    const inRepo = !relative(root, outDir).startsWith('..');

    console.log(`bench: raw numbers in ${inRepo ? relative(root, file) : file}`);
    if (inRepo && !ignoredByGit(root, outDir))
        console.log(`bench: note, git does not ignore ${relative(root, outDir)}/`);
    if (failed) console.log(`bench: ${failed} failures`);
    if (failed) return 1;
    if (args.check !== 'true' || mode !== 'ab') return 0;

    return { pass: 0, fail: 1, undecided: 2 }[result.verdict.outcome];
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(`bench: ${error.message}`);
    process.exitCode = 1;
}
