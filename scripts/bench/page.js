/*
 * Browser entry of scripts/bench/ab.mjs. It creates one renderer with its canvas on the page,
 * loads one rig into the runtimes and measures blocks. A block is some instances of one side on
 * the stage, a warm-up, then frames that are timed one by one.
 *
 * A timed frame has three parts. The update is everything a runtime does on the CPU when it is
 * asked to advance every instance by 1/60 second. The submit is `renderer.render(stage)`: the
 * CPU work that hands the frame to the GPU process. The wait is the time until the GPU has
 * finished that work. Submit and wait together are the render time: CPU submit plus GPU
 * completion, not a pure GPU time. No part of a timed frame waits for an animation frame or
 * for vsync.
 *
 * The wait on WebGL is a read of one pixel of the canvas, which needs the finished picture.
 * `gl.finish()` is no wait in Chrome: it sends the commands on and returns. Measured in Chrome
 * 157 on an Apple M4, a frame that fills a canvas of 1920x1080 about 24 times took 0.02 ms with
 * `gl.finish()` and 10 ms with the read.
 *
 * The two runtimes split a frame differently. The official one computes its vertices when it is
 * drawn, pixi-marrow when it is updated. So update plus submit is the CPU time to compare, and
 * the sum of all three is the frame. Each part alone says where a runtime spends its time.
 *
 * The wait depends on what else uses the GPU. Measured on an Apple M4 with a desktop in use:
 * at times one wait in every 16.7 ms took 6 to 9 ms longer than the others. The page measures
 * this on an empty stage before it loads a rig, see `timeEmptyFrames`.
 */
import { triangleArea } from '../render/buffers.js';
import { BACKGROUNDS, countDraws, coverage, createStudio } from '../render/pixels.js';
import { probeMemory, readMemory, settle } from './memory.js';
import { layoutCover, layoutGrid, populate } from './scene.js';
import { officialSide, oursSide } from './sides.js';

/** Seconds every instance advances per frame. */
const DT = 1 / 60;
/** Width and height of the picture that proves a block drew something. */
const PROOF_SIZE = 256;
/** Frames the first instance of a side plays when its files are loaded, before anything is measured. */
const PRIME_FRAMES = 300;
/** Frames of the empty stage that are timed to see what else uses the GPU. */
const EMPTY_FRAMES = 400;

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** The smallest step `performance.now()` takes, in milliseconds. */
function timerStep() {
    let step = Number.POSITIVE_INFINITY;
    let last = performance.now();

    for (let i = 0; i < 200_000; i++) {
        const now = performance.now();

        if (now > last) step = Math.min(step, now - last);
        last = now;
    }

    return step;
}

/** Plays frames that are not timed: buffers get their size and the code gets compiled. */
async function warmUp(env, objects, frames) {
    for (let frame = 0; frame < frames; frame++) {
        for (const object of objects) object.update(DT);
        env.renderer.render(env.stage);
        await env.finish();
    }
}

/**
 * Times frames. Per frame: the update of every object, the submit of the frame, the wait for the
 * GPU, and the draw calls the GPU interface saw. Nothing is allocated between two readings of
 * the clock. On WebGL the wait is a blocking call, on WebGPU a promise of the device queue.
 *
 * A sample is the mean of `group` frames that follow each other. The clock of a page steps by
 * 0.005 ms at best, and one small instance updates in a few such steps. Over a group the steps
 * of the clock average out.
 *
 * @returns Per sample: the milliseconds of the update, the submit and the wait of one frame, and
 * the most draw calls a frame of the group took.
 */
async function timeFrames(env, objects, samples, group) {
    const { renderer, stage, draws, device, wait } = env;
    const update = new Float64Array(samples);
    const submit = new Float64Array(samples);
    const waits = new Float64Array(samples);
    const calls = new Uint32Array(samples);
    const count = objects.length;

    for (let sample = 0; sample < samples; sample++) {
        let updating = 0;
        let submitting = 0;
        let waiting = 0;
        let most = 0;

        for (let frame = 0; frame < group; frame++) {
            const start = performance.now();

            for (let i = 0; i < count; i++) objects[i].update(DT);
            const updated = performance.now();

            draws.count = 0;
            renderer.render(stage);
            const submitted = performance.now();

            if (device) await device.queue.onSubmittedWorkDone();
            else wait();
            const done = performance.now();

            updating += updated - start;
            submitting += submitted - updated;
            waiting += done - submitted;
            if (draws.count > most) most = draws.count;
        }
        update[sample] = updating / group;
        submit[sample] = submitting / group;
        waits[sample] = waiting / group;
        calls[sample] = most;
    }

    return {
        update: Array.from(update),
        submit: Array.from(submit),
        wait: Array.from(waits),
        calls: Array.from(calls),
    };
}

/**
 * Renders the empty stage and waits for the GPU, many times. The median is what asking costs:
 * every render time of a block holds about that much. A frame that takes far longer waited for
 * work of other programs on the GPU. `busy` is the share of the time that went into such waits.
 * Measured on an Apple M4 with a desktop in use: 0 to 0.03 at some times, 0.37 to 0.48 at others.
 */
async function timeEmptyFrames(env) {
    const times = [];
    let total = 0;
    let stalled = 0;

    await warmUp(env, [], 30);
    for (let frame = 0; frame < EMPTY_FRAMES; frame++) {
        const start = performance.now();

        env.renderer.render(env.stage);
        if (env.device) await env.device.queue.onSubmittedWorkDone();
        else env.wait();
        times.push(performance.now() - start);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];

    for (const ms of times) {
        total += ms;
        // a frame of three medians or more is no jitter of the frame itself
        if (ms > median * 3) stalled += ms - median;
    }

    return {
        median,
        p95: sorted[Math.floor(sorted.length * 0.95)],
        max: sorted[sorted.length - 1],
        busy: stalled / total,
    };
}

/** The pixels the stage covers in a small picture of the whole canvas: 0 means nothing was drawn. */
async function proveDrawn(env) {
    const { stage, renderer } = env;

    stage.scale.set(PROOF_SIZE / Math.max(renderer.width, renderer.height));
    try {
        return coverage((await env.studio.shoot(stage, BACKGROUNDS.clear)).pixels, BACKGROUNDS.clear);
    } finally {
        stage.scale.set(1);
    }
}

/** What a display object of ours says about itself, and the area its triangles cover on the canvas plane. */
function describeOurs(env, objects, scale) {
    const [first] = objects;
    const stats = first?.stats;

    if (!stats) return null;
    let area = 0;

    for (const object of objects) area += triangleArea(env.PIXI, object) * scale * scale;

    return {
        area,
        vertices: stats.vertices,
        indices: stats.indices,
        drawCalls: stats.drawCalls,
        tightRanges: stats.tightRanges,
        coveredSlots: stats.coveredSlots,
    };
}

/**
 * One block: creates the instances of one side, warms up, reads the memory, times the frames and
 * destroys the instances.
 *
 * @param job.side `ours` or `official`.
 * @param job.instances How many display objects are on the stage.
 * @param job.frames How many samples are timed, and `job.group` how many frames make a sample.
 * @param job.options Options for a display object of ours.
 */
async function runBlock(env, job) {
    const { renderer, stage, plan } = env;
    const side = env.sides[job.side];
    const create = env.factories[job.side];
    const objects = [];

    if (!side || !create) return { error: `the page has no ${job.side} runtime` };
    try {
        const before = await readMemory(env.memory);

        objects.push(...populate(env, side, create, job.instances, job.options));
        const scale = layoutGrid(objects, plan.frame, renderer.width, renderer.height);

        await warmUp(env, objects, job.warmup);
        await settle();
        const after = await readMemory(env.memory);

        // the memory reading collected garbage. A few frames bring the loop back to its pace
        await warmUp(env, objects, 5);
        const timed = await timeFrames(env, objects, job.frames, job.group ?? 1);
        const covered = await proveDrawn(env);

        return {
            ...timed,
            covered,
            heapBytes: before.heap === null ? null : after.heap - before.heap,
            agentBytes: before.agent === null || after.agent === null ? null : after.agent - before.agent,
            ours: job.side === 'ours' ? describeOurs(env, objects, scale) : null,
        };
    } catch (error) {
        return { error: message(error) };
    } finally {
        for (const object of objects) {
            stage.removeChild(object);
            object.destroy();
        }
        await settle();
    }
}

/**
 * The overdraw mode: pixi-marrow with several settings in one scene. The instances of every
 * setting are on the stage, each set over the whole canvas, and one set at a time is visible.
 * The sets take turns of a few frames, in an order that moves on with every round. So every
 * setting is timed in the same seconds as the others, and a GPU that is slow or busy for a
 * while is slow for all of them. The first frames of a turn are not kept: the switch itself
 * costs time.
 *
 * One more turn, `quarter`, draws the instances of the first setting at half their size. That
 * is the same work on a quarter of the pixels, so its time against the first setting tells
 * whether the frame is bound by fill.
 *
 * @param job.settings Per setting its `name` and the `options` of a display object.
 * @param job.instances How many display objects every setting has.
 * @param job.rounds How often every setting gets a turn.
 * @param job.span Frames of a turn, of which the first `job.skip` are not kept.
 * @returns Per setting the frames that were kept, as `timeFrames` returns them.
 */
async function runTurns(env, job) {
    const { renderer, stage } = env;
    const side = env.sides.ours;
    const create = env.factories.ours;
    const sets = [];
    const turns = [];
    const show = (turn) => {
        for (const set of sets) {
            for (const object of set.objects) object.visible = set === turn.set;
        }
        stage.scale.set(turn.stageScale);
    };
    const turnOf = (name, set, stageScale) => ({ name, set, stageScale, update: [], submit: [], wait: [], calls: [] });

    try {
        for (const setting of job.settings) {
            const objects = populate(env, side, create, job.instances, setting.options);
            const scale = layoutCover(objects, env.plan.frame, renderer.width, renderer.height);

            sets.push({ objects, scale });
            turns.push(turnOf(setting.name, sets.at(-1), 1));
        }
        turns.push(turnOf('quarter', sets[0], 0.5));
        for (const turn of turns) {
            show(turn);
            await warmUp(env, turn.set.objects, job.warmup);
        }
        for (let round = 0; round < job.rounds; round++) {
            for (let i = 0; i < turns.length; i++) {
                const turn = turns[(i + round) % turns.length];

                show(turn);
                const timed = await timeFrames(env, turn.set.objects, job.span, 1);

                for (const key of ['update', 'submit', 'wait', 'calls']) turn[key].push(...timed[key].slice(job.skip));
            }
        }
        show(turns[0]);
        const covered = await proveDrawn(env);

        return {
            covered,
            settings: turns.map(({ name, set, update, submit, wait, calls }) => ({
                name,
                update,
                submit,
                wait,
                calls,
                ours: describeOurs(env, set.objects, set.scale),
            })),
        };
    } catch (error) {
        return { error: message(error) };
    } finally {
        stage.scale.set(1);
        for (const set of sets) {
            for (const object of set.objects) {
                stage.removeChild(object);
                object.destroy();
            }
        }
        await settle();
    }
}

/**
 * Loads the files of a rig into every runtime of the page. One instance of each is then played
 * and drawn for a few frames, so that shaders, textures and what an asset shares between its
 * instances exist before the first memory reading.
 */
async function loadRig(env, plan) {
    const [sequence] = plan.sequences;

    env.plan = plan;
    for (const [name, side] of Object.entries(env.sides)) {
        const url = (file) => `/fixtures/${name}/${plan.version}/${file}`;
        const create = await side.load({ skeleton: url(plan.files.skel), atlas: url(plan.files.atlas) });
        const object = create();

        env.factories[name] = create;
        env.stage.addChild(object);
        try {
            if (sequence.skin) side.setSkin(object, sequence.skin);
            side.play(object, sequence.animation);
            layoutGrid([object], plan.frame, env.renderer.width, env.renderer.height);
            await warmUp(env, [object], PRIME_FRAMES);
        } finally {
            env.stage.removeChild(object);
            object.destroy();
        }
    }
    await settle();
}

/** What the renderer runs on, for the report. */
function describe(PIXI, renderer) {
    if (renderer.type === PIXI.RendererType.WEBGPU) {
        const { info } = renderer.gpu.adapter;

        return `WebGPU, ${[info.vendor, info.architecture, info.description].filter(Boolean).join(' ')}`;
    }
    const { gl } = renderer;
    const names = gl.getExtension('WEBGL_debug_renderer_info');

    return `${gl.getParameter(gl.VERSION)}, ${names ? gl.getParameter(names.UNMASKED_RENDERER_WEBGL) : 'unknown GPU'}`;
}

/** The call that blocks until the GPU has finished the WebGL commands of a frame: a read of one pixel. */
function waiter(gl) {
    const pixel = new Uint8Array(4);

    return () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

/**
 * Loads the runtimes the address names, then creates the renderer named by `?renderer=` with a
 * canvas of `?width=` by `?height=` pixels. The order matters: a runtime registers its render
 * pipe on import, and a renderer has the pipes that were registered when it was created.
 * Publishes `window.bench` for the Node side. Its `renderer` is the name of the renderer that
 * came up, which is `webgl` when WebGPU is missing.
 */
export async function start({ PIXI, loadOurs, loadOfficial }) {
    const params = new URLSearchParams(location.search);
    const preference = params.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
    const version = params.get('official');
    const draws = countDraws();
    // which step failed: a runtime that does not load is a finding, a missing renderer is not
    let step = 'load';

    try {
        const sides = {};
        const lib = await loadOurs();

        if (!lib.MarrowSpine) throw new Error('pixi-marrow exports no MarrowSpine');
        sides.ours = oursSide(lib);
        if (version !== 'none') sides.official = officialSide(PIXI, await loadOfficial(version));
        step = 'renderer';
        const renderer = await PIXI.autoDetectRenderer({
            preference,
            width: Number(params.get('width')),
            height: Number(params.get('height')),
            resolution: 1,
            antialias: false,
            powerPreference: 'high-performance',
        });
        const isGpu = renderer.type === PIXI.RendererType.WEBGPU;
        const device = isGpu ? renderer.gpu.device : null;
        const wait = isGpu ? null : waiter(renderer.gl);
        const env = {
            PIXI,
            renderer,
            stage: new PIXI.Container(),
            draws,
            device,
            wait,
            // the same wait outside the timed frames
            finish: async () => {
                if (device) await device.queue.onSubmittedWorkDone();
                else wait();
            },
            studio: createStudio(PIXI, renderer, PROOF_SIZE, draws),
            sides,
            factories: {},
            plan: null,
            memory: null,
        };

        document.body.appendChild(renderer.canvas);
        env.memory = await probeMemory();
        const emptyFrame = await timeEmptyFrames(env);

        window.bench = {
            renderer: renderer.name,
            gpu: describe(PIXI, renderer),
            pixi: PIXI.VERSION,
            isolated: globalThis.crossOriginIsolated === true,
            timerStep: timerStep(),
            emptyFrame,
            memory: env.memory,
            dt: DT,
            load: (plan) => loadRig(env, plan),
            block: (job) => runBlock(env, job),
            turns: (job) => runTurns(env, job),
        };
    } catch (error) {
        window.bench = { error: message(error), step };
    }
}
