/*
 * Browser entry of scripts/check-render.mjs. It creates one renderer and runs the cases of one rig
 * or of one scene per call. Both runtimes play the same animation with the same time steps, each
 * is drawn alone into a render texture on two backgrounds, and the pixels are compared. Ours is
 * drawn in each of its render modes, see scripts/render/probe.js. Scenes are in
 * scripts/render/scenes.js.
 */

import { bufferCases, drawCallCase, overdrawCase, triangleArea } from './buffers.js';
import { multisampledCase, premultipliedReadingCase } from './cut-cases.js';
import { capture, captureSecond, judge, PAIRS } from './judge.js';
import { statMode } from './mode.js';
import { BACKGROUNDS, countBuilds, countDraws, coverage, createStudio } from './pixels.js';
import { chooseModes, probeModes } from './probe.js';
import { runScene } from './scenes.js';
import { officialSide, oursSide } from './sides.js';

/** The share of the picture a rig must cover in some frame of an animation to count as drawn. */
const VISIBLE_SHARE = 0.005;

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const percent = (share) => `${(100 * share).toFixed(3)}%`;

/**
 * The instances of one sequence: which side, which files, and what the tooling proof changes.
 *
 * @param officialHere On a page that runs on another pixi.js: the official runtime on that
 * pixi.js. `official` is then the reference, which runs on the pixi.js the package is developed
 * with, and every comparison with the official runtime is one with the reference.
 * @param run Which modes of ours are drawn: `mesh`, `batched` and `auto`, see `chooseModes`.
 * The instances of the mesh mode are the ones this check had before there were modes. They ask
 * for the mode by name, so they stay what they were when `auto` picks another mode.
 */
function roles(plan, official, ours, proof, run, officialHere = null) {
    const { skel, json, atlas, pma } = plan.files;
    const { placement } = plan;
    const list = [];
    const add = (key, side, skeleton, atlasFile, more = {}) =>
        list.push({ key, side, skeleton, atlas: atlasFile, cuts: 'default', ...more });
    const shifted = (it) => it.place({ ...placement, x: placement.x + 1 });

    if (official) {
        add('official', official, skel, atlas);
        add('twin', official, skel, atlas);
        add('official-json', official, json, atlas);
        if (pma) add('official-pma', official, skel, pma);
        if (proof) {
            add('shift', official, skel, atlas, { setup: shifted });
            add('nudge', official, skel, atlas, {
                setup: (it) => it.place({ ...placement, x: placement.x + 0.25 }),
            });
            add('tint', official, skel, atlas, { setup: (it) => it.tint(proof.tint, 0.9) });
            add('hide', official, skel, atlas, { setup: (it) => it.hide(proof.hide) });
        }
    }
    // the official runtime once more, on the pixi.js of the page, where `official` is the reference
    if (official && officialHere) add('official-here', officialHere, skel, atlas);
    if (ours && run.mesh) {
        const mode = 'mesh';

        add('ours', ours, skel, atlas, { mode });
        add('ours-json', ours, json, atlas, { mode });
        add('ours-plain', ours, skel, atlas, { mode, cuts: 'off' });
        add('ours-polygons', ours, skel, atlas, { mode, cuts: 'polygons' });
        if (pma) add('ours-pma', ours, skel, pma, { mode });
        if (pma) add('ours-pma-plain', ours, skel, pma, { mode, cuts: 'off' });
        if (pma) add('ours-pma-polygons', ours, skel, pma, { mode, cuts: 'polygons' });
        // a difference that is real on our side: it must fail at both placements
        if (proof && official) add('ours-shift', ours, skel, atlas, { mode, setup: shifted });
    }
    if (ours && run.batched) {
        const mode = 'batched';

        add('ours-batched', ours, skel, atlas, { mode });
        add('ours-batched-plain', ours, skel, atlas, { mode, cuts: 'off' });
        add('ours-batched-polygons', ours, skel, atlas, { mode, cuts: 'polygons' });
        if (pma) add('ours-batched-pma', ours, skel, pma, { mode });
        if (proof && official) add('ours-batched-shift', ours, skel, atlas, { mode, setup: shifted });
    }
    // the default options, as an application gets them
    if (ours && run.auto) add('ours-auto', ours, skel, atlas);

    return list;
}

/**
 * The render modes of the instances of ours in the frame that was drawn last.
 *
 * An instance that asked for the mesh mode by name must draw in it. One that asked for the
 * batched mode may draw meshes for a frame, for example while a clip cuts a visible slot: the
 * frame is compared all the same, and `ctx.batchedDrew` notes the mode for the report.
 *
 * @returns The mode the instance with the default options drew in, or null when there is none
 * or the runtime does not say.
 */
async function modesOfFrame(ctx, live, forced, at) {
    for (const [key, asked] of forced) {
        const drew = live.has(key) ? statMode(live.get(key).spine) : null;

        if (asked !== 'mesh' || drew === null || drew === asked) continue;
        forced.delete(key);
        ctx.report.cases.push({
            ...at,
            label: `${key} left its render mode`,
            kind: 'error',
            reasons: [`renderMode '${asked}' was asked for and stats.renderMode says ${drew}`],
        });
    }
    const batched = live.get('ours-batched');
    const auto = live.get('ours-auto');

    ctx.batchedDrew = batched ? statMode(batched.spine) : null;
    if (!auto) return null;
    // with --trust-mode the default of a runtime that reports no mode is taken as the mesh mode
    const mode = (await auto.mode()).mode ?? (ctx.options.trustMode ? 'mesh' : null);

    ctx.autoModes.add(mode ?? 'none');

    return mode;
}

/** Notes what the triangles of ours cover in a captured frame, with the cuts of overdraw on and off. */
function measureOverdraw(ctx, live, frames) {
    const { PIXI, plan, overdraw } = ctx;
    const scale = plan.placement.scale ** 2;

    for (const [key, list] of [
        ['ours', overdraw.on],
        ['ours-plain', overdraw.off],
        ['ours-polygons', overdraw.polygons],
    ]) {
        const instance = live.get(key);
        const stats = frames.get(key)?.stats;

        if (!instance || !stats) continue;
        list.push({
            area: triangleArea(PIXI, instance.spine) * scale,
            indices: stats.indices,
            vertices: stats.vertices,
            covered: stats.coveredSlots ?? 0,
            tight: stats.tightRanges ?? 0,
        });
        if (key === 'ours') ctx.outlines = instance.outlines();
    }
}

/** Plays one skin and animation on every instance and compares the frames at the capture steps. */
async function runSequence(ctx, sequence, withProof) {
    const { plan, studio, report } = ctx;
    const live = new Map();
    const where = { skin: sequence.skin, animation: sequence.animation };
    // the most pixels ours covered in a frame of this sequence
    let drawn = -1;
    const fail = (key, what, error) => {
        report.cases.push({ ...where, label: `${key} ${what}`, kind: 'error', reasons: [message(error)] });
        live.delete(key);
    };

    // the instances that asked for a render mode by name, and the mode each asked for
    const forced = new Map();

    const proof = withProof ? plan.proof : null;

    for (const role of roles(plan, ctx.official, ctx.ours, proof, ctx.run, ctx.officialHere)) {
        // the twin loads its own copies. Every other instance shares the files of its side
        const tag = role.key === 'twin' ? 'twin' : role.side.name;
        const url = (file) => `/fixtures/${tag}/${plan.version}/${file}`;

        try {
            const instance = await role.side.create({
                skeleton: url(role.skeleton),
                atlas: url(role.atlas),
                cuts: role.cuts,
                mode: role.mode,
            });

            const place = instance.place;

            // where the instance is, so that a second look can move it and put it back
            instance.place = (placement) => {
                instance.home = placement;
                place(placement);
            };
            live.set(role.key, instance);
            // a side draws with its own renderer, into a render texture of its own
            instance.studio = role.side.studio(plan.size);
            if (role.mode) forced.set(role.key, role.mode);
            if (sequence.skin) instance.setSkin(sequence.skin);
            instance.place(plan.placement);
            role.setup?.(instance);
            instance.play(sequence.animation);
        } catch (error) {
            fail(role.key, 'did not start', error);
        }
    }
    for (let step = 0; step <= Math.max(...sequence.captures); step++) {
        for (const [key, instance] of live) {
            try {
                instance.update(step === 0 ? 0 : sequence.dt);
            } catch (error) {
                fail(key, `failed in update at step ${step}`, error);
            }
        }
        if (!sequence.captures.includes(step)) continue;
        const frames = new Map();

        for (const [key, instance] of live) {
            try {
                frames.set(key, await capture(studio, instance));
            } catch (error) {
                fail(key, `failed in render at step ${step}`, error);
            }
        }
        const at = { ...where, step, time: Math.round(step * sequence.dt * 1000) / 1000 };
        const autoMode = await modesOfFrame(ctx, live, forced, at);

        ctx.clipped = frames.get('ours')?.stats?.maskDraws > 0;
        for (const pair of PAIRS) {
            const a = frames.get(pair.a);
            const b = frames.get(pair.b);
            const again = async () => ({
                a: await captureSecond(studio, live.get(pair.a)),
                b: await captureSecond(studio, live.get(pair.b)),
            });

            if (pair.auto && pair.auto !== autoMode) continue;
            if (a && b) report.cases.push(await judge(ctx, at, pair, a, b, again));
        }
        if (frames.has('official')) ctx.draws.official.push(frames.get('official').solid.draws);
        if (frames.has('ours-batched')) ctx.draws.batched.push(frames.get('ours-batched').solid.draws);
        if (frames.has('ours')) {
            const { solid, stats } = frames.get('ours');

            // what the GPU interface saw, next to what the stats of the display object say
            ctx.draws.ours.push({ ...at, gpu: solid.draws, stat: stats?.drawCalls, masks: stats?.maskDraws ?? 0 });
        }
        if (frames.has('ours')) drawn = Math.max(drawn, coverage(frames.get('ours').clear.pixels, BACKGROUNDS.clear));
        measureOverdraw(ctx, live, frames);
    }
    // without an official picture to compare with, an empty picture of ours would pass unseen
    if (!plan.official && drawn >= 0) {
        const share = drawn / (plan.size * plan.size);

        report.cases.push({
            ...where,
            label: 'ours is not empty',
            kind: 'visible',
            reasons: share < VISIBLE_SHARE ? [`the fullest frame covers ${percent(share)} of the picture`] : [],
            info: { covered: drawn },
        });
    }
    for (const instance of live.values()) {
        try {
            instance.destroy();
        } catch (error) {
            report.notes.push(`destroy failed: ${message(error)}`);
        }
    }
}

/**
 * Asks the runtime of ours which render modes it has, with the first animation of the rig, and
 * adds what it says to the report. Returns which modes are drawn.
 */
async function askModes(ctx) {
    const { plan, options, report } = ctx;
    const [sequence] = plan.sequences;
    const url = (file) => `/fixtures/ours/${plan.version}/${file}`;
    const readings = await probeModes(ctx.ours, ctx.studio, {
        skeleton: url(plan.files.skel),
        atlas: url(plan.files.atlas),
        skin: sequence.skin,
        animation: sequence.animation,
        placement: plan.placement,
    });
    const { run, entry } = chooseModes(readings, options);

    report.cases.push(entry);
    ctx.modeEntry = entry;

    return run;
}

/** Runs every case of one rig. The result is plain data for the Node side. */
async function runRig(env, plan, options) {
    const report = { cases: [], notes: [], missing: env.missing };
    const ctx = {
        plan,
        options,
        report,
        studio: (env.ours ?? env.official).studio(plan.size),
        official: env.official,
        officialHere: env.officialHere,
        ours: env.ours,
        PIXI: env.PIXI,
        // which modes of ours are drawn. Without ours the tooling proof runs alone
        run: { mesh: false, batched: false, auto: false },
        // the modes the instance with the default options drew in, over the captured frames
        autoModes: new Set(),
        draws: { ours: [], batched: [], official: [] },
        overdraw: { on: [], off: [], polygons: [] },
        outlines: null,
        shotsLeft: options.shots,
        sampled: false,
    };

    if (ctx.ours) ctx.run = await askModes(ctx);
    ctx.sampleLabel = sampleLabel(ctx);
    for (const [index, sequence] of plan.sequences.entries()) await runSequence(ctx, sequence, index === 0);
    if (ctx.ours) {
        if (ctx.modeEntry) ctx.modeEntry.info.drew = [...ctx.autoModes];
        if (ctx.draws.ours.length || ctx.draws.batched.length) report.cases.push(drawCallCase(ctx));
        if (ctx.overdraw.on.length) report.cases.push(overdrawCase(ctx));
        report.cases.push(...(await bufferCases(ctx)));
        for (const mode of ['mesh', 'batched']) {
            if (ctx.run[mode]) report.cases.push(await multisampledCase(env, plan, mode));
        }
        // one image of 2 by 2 pixels, the same for every rig: the first rig runs it
        if (options.extras) report.cases.push(await premultipliedReadingCase(env, await env.loadCore()));
    }

    return report;
}

/** The comparison whose first passing frame gets its images saved, as a sample of the rig. */
function sampleLabel(ctx) {
    if (!ctx.ours) return 'official twice';
    if (!ctx.run.mesh) return 'ours batched';

    return ctx.plan.official ? 'ours' : 'ours, json and binary';
}

/**
 * Gives a side what it draws with: its pixi.js, and `studio(size)`, a render texture of that size
 * on its own renderer. Sides that share a renderer share the textures.
 *
 * @param stage `PIXI`, `renderer` and `builds` of the renderer the side draws with. The studios
 * of the renderer are kept on it.
 */
function withStudio(side, stage, draws) {
    stage.studios ??= new Map();

    return {
        ...side,
        PIXI: stage.PIXI,
        studio(size) {
            if (!stage.studios.has(size)) {
                stage.studios.set(size, createStudio(stage.PIXI, stage.renderer, size, draws, false, stage.builds));
            }

            return stage.studios.get(size);
        },
    };
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

/**
 * Loads the runtimes the address names, then creates the renderer named by `?renderer=`. The order
 * matters: a runtime registers its render pipe on import, and a renderer has the pipes that were
 * registered when it was created. Publishes `window.renderCheck` for the Node side. Its `renderer`
 * is the name of the renderer that came up, which is `webgl` when WebGPU is missing.
 *
 * With `loadReference` the page runs on another pixi.js than the package is developed with. The
 * official runtime is then loaded twice: on the pixi.js of the page, and as the reference on a
 * pixi.js and a renderer of its own, see `referenceOfficial` of scripts/render/serve.mjs.
 */
export async function start({ PIXI, loadOurs, loadOfficial, loadReference, loadCore }) {
    const params = new URLSearchParams(location.search);
    const preference = params.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
    const version = params.get('official');
    const draws = countDraws();
    // which step failed: a runtime that does not load is a finding, a missing renderer is not
    let step = 'load';

    try {
        const officialLib = version === 'none' ? null : await loadOfficial(version);
        // on a page that runs on another pixi.js: the official runtime on the pixi.js of the reference
        const reference = officialLib && loadReference ? await loadReference(version) : null;
        const lib = params.get('ours') === 'yes' ? await loadOurs() : null;
        const create = (pixi) =>
            pixi.autoDetectRenderer({ preference, width: 16, height: 16, antialias: false, backgroundAlpha: 0 });

        step = 'renderer';
        const renderer = await create(PIXI);
        const here = { PIXI, renderer, builds: countBuilds(renderer) };
        const there = reference ? { PIXI: reference.PIXI, renderer: await create(reference.PIXI) } : null;

        if (there) there.builds = countBuilds(there.renderer);
        const officialHere = officialLib ? withStudio(officialSide(PIXI, officialLib), here, draws) : null;
        const env = {
            PIXI,
            renderer,
            draws,
            builds: here.builds,
            // the official runtime the pictures are judged by: the reference where the page has one
            official: there ? withStudio(officialSide(there.PIXI, reference.lib), there, draws) : officialHere,
            // with a reference: the official runtime on the pixi.js of the page, for information
            officialHere: there ? { ...officialHere, name: 'official-here' } : null,
            ours: lib?.MarrowSpine ? withStudio(oursSide(PIXI, lib, params.get('skinning')), here, draws) : null,
            lib,
            loadCore,
            // the `skinning` option of every instance of ours, or null
            skinning: params.get('skinning'),
            // the package is built but has no display object yet
            missing: lib !== null && !lib.MarrowSpine,
        };

        // a display object of a runtime that runs on the pixi.js of this page is a container of it
        const onPage = (type) => (type ? type.prototype instanceof PIXI.Container : null);

        window.renderCheck = {
            renderer: renderer.name,
            skinning: params.get('skinning'),
            gpu: describe(PIXI, renderer),
            // The pixi.js of the page, and whether each runtime runs on that copy. Null: not loaded.
            // `reference` is the pixi.js of the reference, where the page has one
            pixi: {
                version: PIXI.VERSION,
                ours: onPage(lib?.MarrowSpine),
                official: onPage(officialLib?.Spine),
                reference: there ? there.PIXI.VERSION : null,
            },
            run: (plan, options) => runRig(env, plan, options),
            scene: (scene, options) => runScene(env, scene, options),
        };
    } catch (error) {
        window.renderCheck = { error: message(error), step };
    }
}
