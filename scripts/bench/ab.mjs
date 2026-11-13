#!/usr/bin/env node
/**
 * Measures pixi-marrow against the official Pixi runtime in headless Chrome on the real GPU:
 * the same rigs, animations, instance counts, canvas and build of pixi.js on both sides. It
 * shares the page server, the browser start and the plan of the render check.
 *
 * usage: pnpm bench:ab [--mode=ab|overdraw] [--scene=play|rest|setup|moved|little|mixed|all]
 *                      [--render-mode=auto|mesh|batched] [--mesh=verdict|all|none]
 *                      [--rigs=4.2/tank-pro,raptor] [--instances=1,50,200] [--renderer=webgl|webgpu|both]
 *                      [--runs=3] [--frames=200] [--warmup=40] [--size=1280x720] [--out=.bench]
 *                      [--memory=all|off] [--dist=<folder>] [--pixi=8.16] [--baseline=<file>]
 *                      [--write-baseline] [--check] [--skinning=gpu]
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
 * --scene says what the instances of the A/B mode do while they are timed, see
 * scripts/bench/scene.js: `play` (the default) loops an animation, `rest` stands past the end of
 * an animation that does not loop, `setup` never played, `moved` rests below a parent that
 * moves, `little` plays an animation that moves few bones, and `mixed` is 30 instances of five
 * small rigs of which a few play at a time. Several names with commas between them run one
 * after the other, `all` runs every scene. Every scene but `play` and `mixed` has 200 instances
 * unless --instances names the counts.
 *
 * --skinning=gpu adds a side `gpu`: ours in the mesh mode with `skinning: 'gpu'`, so the vertex
 * shader places what hangs on bones alone. With --render-mode=mesh the side `ours` is the mesh
 * mode with the CPU placing every vertex, and the row `gpu/ours` divides the two in the same
 * seconds. The uploads count textures too, which is where the bones and the palette go.
 *
 * --pixi names the version of pixi.js both sides run on, see `pixiPackage` of
 * scripts/render/setup.mjs. The head of a renderer names the version that ran.
 *
 * --dist names a folder with the `package.json` and the `dist` of a build of pixi-marrow that
 * was kept, and measures that build in place of the working tree. That is how two builds are
 * compared in the same hour. --write-baseline keeps the numbers of a run small, in
 * scripts/bench/baseline-m5.json or in the file it names, and --baseline names the file the
 * verdict of M6 holds a run against.
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
 *   uploads      buffer uploads per frame and their KB, counted on the GPU interface for both
 *                sides alike, see `countUploads` of scripts/render/pixels.js. The head of a run
 *                says what a frame of an empty stage uploads
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
 * time that lies inside the spread of the runs is undecided, never a pass. A run with the scenes
 * `play` and `rest` also gets the list of milestone M6, see scripts/bench/verdict-m6.mjs, and a
 * run with several scenes a table that puts them side by side. --check makes the exit code
 * follow the verdicts: 1 when a rule fails, 2 when none fails and one is undecided or was not
 * measured.
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
import { planRigs } from '../render/plan.mjs';
import { bundlePage, serve } from '../render/serve.mjs';
import { builtPackage, launchChrome, parseArgs, pixiPackage } from '../render/setup.mjs';
import { readBaseline, writeBaseline } from './baseline.mjs';
import { measureSides, readModules } from './heap.mjs';
import { describeMachine, describeVersions, ignoredByGit } from './machine.mjs';
import { runSubject, sidesOf } from './measure.mjs';
import { blockFailure, describeSubject, reportAb, reportOverdraw, reportScenes } from './rig-report.mjs';
import { planSubjects, scenesOf } from './scenes.mjs';
import { describePage } from './table.mjs';
import { judgeVerdict, printVerdict, VERDICT_INSTANCES } from './verdict.mjs';
import { judgeM6, printM6 } from './verdict-m6.mjs';

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
const settings = {
    mode,
    // what the instances of the A/B mode do, see scripts/bench/scenes.mjs
    scenes: mode === 'ab' ? scenesOf(args.scene) : ['play'],
    // the render mode of ours, and for which rigs the A/B mode adds ours in the mesh mode as a third side
    renderMode,
    meshSide: ['all', 'none'].includes(args.mesh) ? args.mesh : 'verdict',
    // whether ours in the mesh mode with the vertex shader that places from the bones is one more side
    skinning: args.skinning === 'gpu' ? 'gpu' : null,
    runs: Number(args.runs ?? DEFAULTS[mode].runs),
    frames: Number(args.frames ?? DEFAULTS[mode].frames),
    warmup: Number(args.warmup ?? DEFAULTS[mode].warmup),
    instances: counts,
    canvas: [width, height],
};
/** What the page driver of scripts/bench/measure.mjs needs of the settings. */
const config = { ...settings, width, height, turn: TURN, tightSettings: SETTINGS };

/** Prints what went wrong on the page of a subject. Returns the number of failures. */
function reportFailures({ state, blocks, crash, errors }) {
    let failed = 0;

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
        console.log(
            `    FAIL ${block.setting ?? block.side}, ${block.instances} instances, run ${block.run + 1}: ${why}`,
        );
        failed++;
    }
    for (const error of errors) console.log(`    error ${error}`);

    return failed + (errors.length ? 1 : 0);
}

/** The memory of the sides of a subject, where the run reads it: the scene `play` of the A/B mode. */
async function readMemory(context, subject) {
    if (mode !== 'ab' || subject.scene !== 'play' || args.memory === 'off') return [];

    return measureSides(context, subject.rig, {
        sides: sidesOf(subject, config),
        counts: subject.counts,
        all: args.memory === 'all',
    });
}

/**
 * The verdicts of an A/B run, printed and kept in the result: the list of M5 when the scene
 * `play` ran, and the list of M6 when the scene `rest` ran too.
 *
 * @returns The exit code `--check` asks for: 1 when a rule fails, 2 when none fails and one is
 * undecided or was not measured.
 */
function judge(result) {
    const codes = { pass: 0, fail: 1, undecided: 2 };
    const outcomes = [];

    if (settings.scenes.length > 1) reportScenes(result);
    if (settings.scenes.includes('play')) {
        result.verdict = judgeVerdict(result);
        printVerdict(result.verdict);
        outcomes.push(result.verdict.outcome);
    }
    if (settings.scenes.includes('rest')) {
        const baseline = readBaseline(resolve(root, args.baseline ?? 'scripts/bench/baseline-m5.json'));

        result.verdictM6 = judgeM6(result, { baseline, sizeFile: join(root, 'ci/size-baseline.json') });
        printM6(result.verdictM6);
        outcomes.push(result.verdictM6.outcome);
    }

    return outcomes.includes('fail') ? codes.fail : outcomes.includes('undecided') ? codes.undecided : codes.pass;
}

/** Writes the JSON file of a run, and its baseline where `--write-baseline` asks for one. */
function keep(result) {
    const outDir = resolve(root, args.out ?? '.bench');
    const file = join(outDir, `${mode}-${result.date.replace(/[-:]/g, '').replace(/\..*$/, '')}.json`);
    const inRepo = !relative(root, outDir).startsWith('..');

    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(result)}\n`);
    console.log(`bench: raw numbers in ${inRepo ? relative(root, file) : file}`);
    if (inRepo && !ignoredByGit(root, outDir))
        console.log(`bench: note, git does not ignore ${relative(root, outDir)}/`);
    if (args['write-baseline']) {
        const baseline = resolve(
            root,
            args['write-baseline'] === 'true' ? 'scripts/bench/baseline-m5.json' : args['write-baseline'],
        );

        writeBaseline(baseline, result, VERDICT_INSTANCES);
        console.log(`bench: baseline for later runs in ${baseline}`);
    }
}

async function main() {
    const pkg = builtPackage(root, args.dist, 'bench');
    const planned = await planRigs({ root, size: 512, animations: 1, only: null, pkg });
    const patterns = args.rigs ? args.rigs.split(',').filter(Boolean) : DEFAULT_RIGS[mode];
    const matching = planned.filter((rig) => patterns.some((pattern) => rig.id.includes(pattern)));
    // Spine 4.1 has no official Pixi v8 runtime to measure against
    const rigs = mode === 'ab' ? matching.filter((rig) => rig.official) : matching;

    for (const rig of matching) {
        if (!rigs.includes(rig)) console.log(`bench: ${rig.id} is left out, Spine 4.1 has no official Pixi runtime`);
    }
    if (rigs.length === 0) throw new Error(`no rig to measure for --rigs=${patterns.join(',')}`);
    const bundle = await bundlePage(root, 'scripts/bench/page.js', {
        pkg,
        pixi: pixiPackage(root, args.pixi, 'bench').dir,
    });
    const subjects = await planSubjects({
        root,
        made: bundle.made,
        pkg,
        scenes: settings.scenes,
        rigs,
        planned,
        counts,
        countsGiven: args.instances !== undefined,
        defaults: !args.rigs,
    });
    const server = await serve(root, bundle.dir, { isolated: true, made: bundle.made });
    const browser = await launchChrome(BENCH_FLAGS);
    const context = { browser, origin: server.origin, width, height, chunks: readModules(bundle.dir) };
    const result = {
        tool: 'pixi-marrow bench:ab',
        date: new Date().toISOString(),
        command: `node scripts/bench/ab.mjs ${process.argv.slice(2).join(' ')}`.trim(),
        settings,
        // the build that was measured: the working tree, or the folder `--dist` named
        build: args.dist ? `the build kept in ${pkg}` : 'the working tree',
        machine: describeMachine(browser.version()),
        versions: describeVersions(root),
        renderers: [],
    };
    let failed = 0;

    console.log(
        `bench: ${mode} mode, ours with renderMode ${renderMode}, ${result.machine.cpu} with ${result.machine.cores} cores` +
            `${result.machine.power ? ` on ${result.machine.power}` : ''}, Chrome ${result.machine.chrome}, ` +
            `canvas ${width}x${height}, ${settings.runs} runs of ${settings.frames} frames after ${settings.warmup}, dt 1/60 s`,
    );
    try {
        for (const renderer of wanted) {
            const entry = { renderer, rigs: [] };

            for (const subject of subjects) {
                const started = Date.now();
                const measured = await runSubject(browser, server.origin, renderer, subject, config);
                const { state, blocks } = measured;

                if (state.step !== 'load' && (state.error || state.renderer !== renderer)) {
                    const why = state.error ?? `the browser gave ${state.renderer}`;

                    console.log(`bench: ${renderer} is not available here (${why}), its blocks did not run`);
                    // a renderer that was asked for by name must be there
                    if (wanted.length === 1) failed++;
                    break;
                }
                if (entry.gpu === undefined && state.gpu) {
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
                }
                console.log(`  ${describeSubject(subject, result.versions, mode)}`);
                failed += reportFailures(measured);
                const memory = blocks.length > 0 ? await readMemory({ ...context, renderer }, subject) : [];

                for (const reading of memory.filter((it) => it.error)) {
                    console.log(`    FAIL memory of ${reading.side}, ${reading.instances} instances: ${reading.error}`);
                    failed++;
                }
                const names = { counts: subject.counts, runs: settings.runs, names: SETTINGS.map((it) => it.name) };
                const summary =
                    blocks.length === 0
                        ? null
                        : mode === 'ab'
                          ? reportAb(blocks, memory, { counts: subject.counts, renderMode })
                          : reportOverdraw(blocks, names);
                const [sequence] = [subject.plans].flat()[0].sequences;

                entry.rigs.push({
                    id: subject.id,
                    scene: subject.scene,
                    animation: sequence.animation,
                    skin: sequence.skin,
                    features: subject.rig.features,
                    counts: subject.rig.counts,
                    emptyFrame: state.emptyFrame ?? null,
                    seconds: (Date.now() - started) / 1000,
                    summary,
                    memory,
                    blocks,
                });
            }
            if (entry.gpu !== undefined) result.renderers.push(entry);
        }
    } finally {
        await browser.close();
        server.close();
        bundle.remove();
    }
    if (result.renderers.length === 0) {
        console.log('bench: no renderer came up, so nothing was measured');
        failed++;
    }
    // the verdicts are about the A/B numbers, so they are part of the JSON file too
    const code = mode === 'ab' ? judge(result) : 0;

    keep(result);
    if (failed) console.log(`bench: ${failed} failures`);
    if (failed) return 1;

    return args.check === 'true' ? code : 0;
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(`bench: ${error.message}`);
    process.exitCode = 1;
}
