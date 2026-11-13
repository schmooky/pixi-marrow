/*
 * Browser entry of scripts/bench/ab.mjs. It creates one renderer with its canvas on the page,
 * loads the rigs of one subject into the runtimes and measures blocks. A block is some instances
 * of one side on the stage, a warm-up, then frames that are timed one by one. What the instances
 * do while they are timed is the scene of the block, see scripts/bench/scene.js.
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
 *
 * A block reads no memory. The memory of a side is read by `hold`, as the first thing a page
 * does after it has loaded a rig: scripts/bench/heap.mjs says why.
 */
import { triangleArea } from '../render/buffers.js';
import { describeModes } from '../render/mode.js';
import { BACKGROUNDS, countDraws, countUploads, coverage, createStudio } from '../render/pixels.js';
import { describe, timerStep, waiter } from './device.js';
import { probeMemory, readMemory, settle } from './memory.js';
import { buildScene, layoutCover, layoutGrid } from './scene.js';
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

/**
 * Plays frames that are not timed: buffers get their size and the code gets compiled.
 *
 * @param tick What the scene does before the update of every frame, or null.
 */
async function warmUp(env, objects, frames, tick = null) {
    for (let frame = 0; frame < frames; frame++) {
        if (tick) tick();
        for (const object of objects) object.update(DT);
        env.renderer.render(env.stage);
        await env.finish();
    }
}

/**
 * Times frames. Per frame: the update of every object, the submit of the frame, the wait for the
 * GPU, the draw calls the GPU interface saw and the buffer uploads. Nothing is allocated between
 * two readings of the clock. On WebGL the wait is a blocking call, on WebGPU a promise of the
 * device queue.
 *
 * A sample is the mean of `group` frames that follow each other. The clock of a page steps by
 * 0.005 ms at best, and one small instance updates in a few such steps. Over a group the steps
 * of the clock average out.
 *
 * @param tick What the scene does before the update of every frame, or null. Its time counts as
 * update: it is what an application does to its skeletons in that frame.
 * @returns Per sample: the milliseconds of the update, the submit and the wait of one frame, the
 * most draw calls a frame of the group took, and the buffer uploads and their bytes per frame.
 */
async function timeFrames(env, objects, samples, group, tick = null) {
    const { renderer, stage, draws, uploads, device, wait } = env;
    const update = new Float64Array(samples);
    const submit = new Float64Array(samples);
    const waits = new Float64Array(samples);
    const calls = new Uint32Array(samples);
    const uploaded = new Float64Array(samples);
    const uploadedBytes = new Float64Array(samples);
    const count = objects.length;

    for (let sample = 0; sample < samples; sample++) {
        let updating = 0;
        let submitting = 0;
        let waiting = 0;
        let most = 0;

        uploads.calls = 0;
        uploads.bytes = 0;
        for (let frame = 0; frame < group; frame++) {
            const start = performance.now();

            if (tick !== null) tick();
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
        uploaded[sample] = uploads.calls / group;
        uploadedBytes[sample] = uploads.bytes / group;
    }

    return {
        update: Array.from(update),
        submit: Array.from(submit),
        wait: Array.from(waits),
        calls: Array.from(calls),
        uploads: Array.from(uploaded),
        uploadBytes: Array.from(uploadedBytes),
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
    env.uploads.calls = 0;
    env.uploads.bytes = 0;
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
        // what a frame uploads with nothing on the stage: on WebGPU the uniforms of the stage
        uploads: env.uploads.calls / EMPTY_FRAMES,
        uploadBytes: env.uploads.bytes / EMPTY_FRAMES,
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

/**
 * What a display object of ours says about itself, and the area its triangles cover on the canvas
 * plane. The area is read from the meshes below an object. It is null where an object has none
 * that draw, as in a render mode that does not draw through meshes of its own.
 */
async function describeOurs(env, objects, scale) {
    const [first] = objects;
    const stats = first?.stats;

    if (!stats) return null;
    let area = 0;

    for (const object of objects) area += triangleArea(env.PIXI, object) * scale * scale;

    return {
        area: area > 0 ? area : null,
        vertices: stats.vertices,
        indices: stats.indices,
        drawCalls: stats.drawCalls,
        tightRanges: stats.tightRanges,
        coveredSlots: stats.coveredSlots,
        ...(await describeModes(objects)),
    };
}

/** Frames that a block of ours with the idle cache draws at most before its images show. */
const IMAGE_FRAMES = 300;

/**
 * Draws frames until every object shows the image of its idle cache, or until `IMAGE_FRAMES`.
 * The code of the cache is a chunk that loads on demand, and a chunk arrives in a turn of the
 * event loop. On WebGL a frame of the bench waits for the GPU without one, so each frame here
 * gives the page a turn, as the frames of a game do.
 */
async function untilImages(env, objects) {
    for (let frame = 0; frame < IMAGE_FRAMES; frame++) {
        if (describeIdle(objects)?.shown === objects.length) return;
        for (const object of objects) object.update(DT);
        env.renderer.render(env.stage);
        await env.finish();
        await new Promise((next) => setTimeout(next, 0));
    }
}

/**
 * The images of the idle cache of some objects of ours: how many show one, and the bytes of their
 * textures, 4 per pixel. Null where no object shows an image.
 */
function describeIdle(objects) {
    let shown = 0;
    let bytes = 0;

    for (const object of objects) {
        const sprite = object.children.find((child) => child.label === 'marrow-idle' && child.visible);
        const source = sprite?.texture.source;

        if (!source) continue;
        shown++;
        bytes += source.pixelWidth * source.pixelHeight * 4;
    }

    return shown > 0 ? { shown, bytes } : null;
}

/**
 * One block: creates the instances of one side in the scene of the job, warms up, times the
 * frames and destroys the instances. It reads no memory: the stage still holds what the block
 * before it drew, see scripts/bench/heap.mjs.
 *
 * @param job.runtime `ours` or `official`: the runtime that draws the block.
 * @param job.scene What the instances do, see scripts/bench/scene.js. Default `play`.
 * @param job.instances How many display objects are on the stage.
 * @param job.frames How many samples are timed, and `job.group` how many frames make a sample.
 * @param job.options Options for a display object of ours, the render mode among them.
 */
async function runBlock(env, job) {
    let scene = null;

    if (!env.sides[job.runtime] || !env.loaded[0]?.factories[job.runtime]) {
        return { error: `the page has no ${job.runtime} runtime` };
    }
    try {
        scene = buildScene(env, job);
        const { objects, tick } = scene;

        if (job.options?.idleCache === 'auto') await untilImages(env, objects);
        await warmUp(env, objects, job.warmup, tick);
        // the garbage of the warm-up goes before the clock starts. A few frames bring the loop back to its pace
        await settle();
        await warmUp(env, objects, 5, tick);
        const timed = await timeFrames(env, objects, job.frames, job.group ?? 1, tick);
        // the proof draws the stage smaller, which takes every image of the idle cache away
        const idle = job.runtime === 'ours' ? describeIdle(objects) : null;
        const covered = await proveDrawn(env);
        const ours = job.runtime === 'ours' ? await describeOurs(env, objects, scene.scale) : null;

        return { ...timed, covered, ours: ours && { ...ours, idle } };
    } catch (error) {
        return { error: message(error) };
    } finally {
        scene?.dispose();
        await settle();
    }
}

/**
 * The memory of the instances of a job: creates them, plays the warm-up and reads how much the
 * heap and the page grew. The instances stay on the stage, so that the Node side can ask Chrome
 * what is alive. This must be the first thing a page does after `loadRigs`, see
 * scripts/bench/heap.mjs.
 *
 * A job of 0 instances is an empty block: the same steps with nothing on the stage. What it reads
 * is what the measurement itself moves, which should be about nothing.
 *
 * @returns `heapBytes` and `agentBytes` for all instances, null where the page has no such
 * reading. `arrayBytes` is what `perf.memory()` of one instance of ours counts as its own typed
 * arrays, and `ours` the render mode the instances drew in.
 */
async function hold(env, job) {
    if (!env.sides[job.runtime] || !env.loaded[0]?.factories[job.runtime]) {
        return { error: `the page has no ${job.runtime} runtime` };
    }
    try {
        // The stage still holds the instance that `loadRigs` played. Some empty frames let go of
        // what an empty frame can let go of, before the first reading and not between the two
        await warmUp(env, [], 10);
        await settle();
        const before = await readMemory(env.memory);

        // the instances stay on the stage: the scene is not taken away
        const { objects } = buildScene(env, { ...job, scene: 'play' });

        await warmUp(env, objects, job.warmup);
        await settle();
        const after = await readMemory(env.memory);
        const ours = job.runtime === 'ours' && objects.length > 0;
        const own = ours ? await objects[0].perf.memory() : null;

        return {
            heapBytes: before.heap === null ? null : after.heap - before.heap,
            agentBytes: before.agent === null || after.agent === null ? null : after.agent - before.agent,
            arrayBytes: own ? own.instance : null,
            ours: ours ? await describeModes(objects) : null,
        };
    } catch (error) {
        return { error: message(error) };
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
            const scene = buildScene(env, {
                runtime: 'ours',
                scene: 'play',
                instances: job.instances,
                options: setting.options,
            });
            const { plan } = env.loaded[0];
            const scale = layoutCover(scene.objects, plan.frame, renderer.width, renderer.height);

            sets.push({ objects: scene.objects, scale, dispose: scene.dispose });
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
        const measured = [];

        for (const { name, set, update, submit, wait, calls } of turns) {
            measured.push({ name, update, submit, wait, calls, ours: await describeOurs(env, set.objects, set.scale) });
        }

        return { covered, settings: measured };
    } catch (error) {
        return { error: message(error) };
    } finally {
        stage.scale.set(1);
        for (const set of sets) set.dispose();
        await settle();
    }
}

/**
 * Loads the files of some rigs into every runtime of the page. One instance of each is then
 * played and drawn for a few frames, so that shaders, textures and what an asset shares between
 * its instances exist before anything is measured.
 *
 * @param plans The plan of one rig, or of several for a scene that mixes rigs.
 * @param mesh True when instances of ours on this page ask for the mesh mode by name.
 */
async function loadRigs(env, plans, mesh = false) {
    env.loaded = [];
    for (const plan of [plans].flat()) {
        const [sequence] = plan.sequences;
        const factories = {};

        for (const [name, side] of Object.entries(env.sides)) {
            const url = (file) => `/fixtures/${name}/${plan.version}/${file}`;
            const create = await side.load({ skeleton: url(plan.files.skel), atlas: url(plan.files.atlas), mesh });
            const object = create();

            factories[name] = create;
            env.stage.addChild(object);
            try {
                if (sequence.skin) side.setSkin(object, sequence.skin);
                side.play(object, sequence.animation);
                layoutGrid([object], () => plan.frame, env.renderer.width, env.renderer.height);
                await warmUp(env, [object], PRIME_FRAMES);
            } finally {
                env.stage.removeChild(object);
                object.destroy();
            }
        }
        env.loaded.push({ plan, factories });
    }
    await settle();
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
    const uploads = countUploads();
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
            uploads,
            device,
            wait,
            // the same wait outside the timed frames
            finish: async () => {
                if (device) await device.queue.onSubmittedWorkDone();
                else wait();
            },
            studio: createStudio(PIXI, renderer, PROOF_SIZE, draws),
            sides,
            // the rigs of the page, each with its plan and with a function per side that creates an instance
            loaded: [],
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
            load: (plans, mesh) => loadRigs(env, plans, mesh),
            block: (job) => runBlock(env, job),
            turns: (job) => runTurns(env, job),
            hold: (job) => hold(env, job),
        };
    } catch (error) {
        window.bench = { error: message(error), step };
    }
}
