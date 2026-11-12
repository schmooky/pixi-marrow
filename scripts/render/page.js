/*
 * Browser entry of scripts/check-render.mjs. It creates one renderer and runs the cases of one rig
 * per call. Both runtimes play the same animation with the same time steps, each is drawn alone
 * into a render texture on two backgrounds, and the pixels are compared.
 */

import { bufferCases, drawCallCase, overdrawCase, triangleArea } from './buffers.js';
import { multisampledCase, premultipliedReadingCase } from './cut-cases.js';
import { judge, PAIRS, SECOND_PLACEMENT } from './judge.js';
import { BACKGROUNDS, countDraws, coverage, createStudio } from './pixels.js';
import { officialSide, oursSide } from './sides.js';

/** The share of the picture a rig must cover in some frame of an animation to count as drawn. */
const VISIBLE_SHARE = 0.005;

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const percent = (share) => `${(100 * share).toFixed(3)}%`;

/** The instances of one sequence: which side, which files, and what the tooling proof changes. */
function roles(plan, official, ours, proof) {
    const { skel, json, atlas, pma } = plan.files;
    const { placement } = plan;
    const list = [];
    const add = (key, side, skeleton, atlasFile, setup, cuts = 'default') =>
        list.push({ key, side, skeleton, atlas: atlasFile, setup, cuts });

    if (official) {
        add('official', official, skel, atlas);
        add('twin', official, skel, atlas);
        add('official-json', official, json, atlas);
        if (pma) add('official-pma', official, skel, pma);
        if (proof) {
            add('shift', official, skel, atlas, (it) => it.place({ ...placement, x: placement.x + 1 }));
            add('nudge', official, skel, atlas, (it) => it.place({ ...placement, x: placement.x + 0.25 }));
            add('tint', official, skel, atlas, (it) => it.tint(proof.tint, 0.9));
            add('hide', official, skel, atlas, (it) => it.hide(proof.hide));
        }
    }
    if (ours) {
        add('ours', ours, skel, atlas);
        add('ours-json', ours, json, atlas);
        add('ours-plain', ours, skel, atlas, undefined, 'off');
        add('ours-polygons', ours, skel, atlas, undefined, 'polygons');
        if (pma) add('ours-pma', ours, skel, pma);
        if (pma) add('ours-pma-plain', ours, skel, pma, undefined, 'off');
        if (pma) add('ours-pma-polygons', ours, skel, pma, undefined, 'polygons');
        // a difference that is real on our side: it must fail at both placements
        if (proof && official)
            add('ours-shift', ours, skel, atlas, (it) => it.place({ ...placement, x: placement.x + 1 }));
    }

    return list;
}

/** One frame of an instance: its picture on both backgrounds, and what its stats say. */
async function capture(studio, instance) {
    return {
        clear: await studio.shoot(instance.root, BACKGROUNDS.clear),
        solid: await studio.shoot(instance.root, BACKGROUNDS.solid),
        stats: instance.stats(),
    };
}

/** One frame of an instance at the second placement. The instance is put back where it was. */
async function captureSecond(studio, instance) {
    const home = instance.home;

    instance.place({ ...home, x: home.x + SECOND_PLACEMENT.x, y: home.y + SECOND_PLACEMENT.y });
    try {
        return await capture(studio, instance);
    } finally {
        instance.place(home);
    }
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

    for (const role of roles(plan, ctx.official, ctx.ours, withProof ? plan.proof : null)) {
        // the twin loads its own copies. Every other instance shares the files of its side
        const tag = role.key === 'twin' ? 'twin' : role.side.name;
        const url = (file) => `/fixtures/${tag}/${plan.version}/${file}`;

        try {
            const instance = await role.side.create({
                skeleton: url(role.skeleton),
                atlas: url(role.atlas),
                cuts: role.cuts,
            });

            const place = instance.place;

            // where the instance is, so that a second look can move it and put it back
            instance.place = (placement) => {
                instance.home = placement;
                place(placement);
            };
            live.set(role.key, instance);
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

        for (const pair of PAIRS) {
            const a = frames.get(pair[1]);
            const b = frames.get(pair[2]);
            const again = async () => ({
                a: await captureSecond(studio, live.get(pair[1])),
                b: await captureSecond(studio, live.get(pair[2])),
            });

            if (a && b) report.cases.push(await judge(ctx, at, pair, a, b, again));
        }
        if (frames.has('official')) ctx.draws.official.push(frames.get('official').solid.draws);
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

/** Runs every case of one rig. The result is plain data for the Node side. */
async function runRig(env, plan, options) {
    const report = { cases: [], notes: [], missing: env.missing };
    const ctx = {
        plan,
        options,
        report,
        studio: createStudio(env.PIXI, env.renderer, plan.size, env.draws),
        official: env.official,
        ours: env.ours,
        PIXI: env.PIXI,
        draws: { ours: [], official: [] },
        overdraw: { on: [], off: [], polygons: [] },
        outlines: null,
        shotsLeft: options.shots,
        sampled: false,
    };

    ctx.sampleLabel = ctx.ours ? (plan.official ? 'ours' : 'ours, json and binary') : 'official twice';
    for (const [index, sequence] of plan.sequences.entries()) await runSequence(ctx, sequence, index === 0);
    if (ctx.ours) {
        if (ctx.draws.ours.length) report.cases.push(drawCallCase(ctx));
        if (ctx.overdraw.on.length) report.cases.push(overdrawCase(ctx));
        report.cases.push(...(await bufferCases(ctx)));
        report.cases.push(await multisampledCase(env, plan));
        // one image of 2 by 2 pixels, the same for every rig: the first rig runs it
        if (options.extras) report.cases.push(await premultipliedReadingCase(env, await env.loadCore()));
    }

    return report;
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
 */
export async function start({ PIXI, loadOurs, loadOfficial, loadCore }) {
    const params = new URLSearchParams(location.search);
    const preference = params.get('renderer') === 'webgpu' ? 'webgpu' : 'webgl';
    const version = params.get('official');
    const draws = countDraws();
    // which step failed: a runtime that does not load is a finding, a missing renderer is not
    let step = 'load';

    try {
        const official = version === 'none' ? null : officialSide(PIXI, await loadOfficial(version));
        const lib = params.get('ours') === 'yes' ? await loadOurs() : null;

        step = 'renderer';
        const renderer = await PIXI.autoDetectRenderer({
            preference,
            width: 16,
            height: 16,
            antialias: false,
            backgroundAlpha: 0,
        });
        const env = {
            PIXI,
            renderer,
            draws,
            official,
            ours: lib?.MarrowSpine ? oursSide(PIXI, lib) : null,
            lib,
            loadCore,
            // the package is built but has no display object yet
            missing: lib !== null && !lib.MarrowSpine,
        };

        window.renderCheck = {
            renderer: renderer.name,
            gpu: describe(PIXI, renderer),
            run: (plan, options) => runRig(env, plan, options),
        };
    } catch (error) {
        window.renderCheck = { error: message(error), step };
    }
}
