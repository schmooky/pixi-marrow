/*
 * Browser entry of scripts/check-render.mjs. It creates one renderer and runs the cases of one rig
 * per call. Both runtimes play the same animation with the same time steps, each is drawn alone
 * into a render texture on two backgrounds, and the pixels are compared.
 */

import { bufferCases, drawCallCase } from './buffers.js';
import {
    BACKGROUNDS,
    compare,
    countDraws,
    coverage,
    createStudio,
    difference,
    displacedShare,
    picture,
} from './pixels.js';
import { officialSide, oursSide } from './sides.js';

/**
 * The comparisons of one frame: label, first picture, second picture, how it is judged.
 *
 * `exact` allows no difference. `match` and `pma` limit the largest difference and the shares of
 * the pixels over 1 and over 8. `formats` limits the share a small displacement cannot explain.
 * A `proof` is wrong on purpose: it passes when every criterion in its list rejects it.
 */
const PAIRS = [
    ['official twice', 'twin', 'official', 'exact'],
    ['ours', 'ours', 'official', 'match'],
    ['ours, json', 'ours-json', 'official-json', 'match'],
    ['official, json and binary', 'official-json', 'official', 'formats'],
    ['ours, json and binary', 'ours-json', 'ours', 'formats'],
    ['official, premultiplied atlas', 'official-pma', 'official', 'pma'],
    ['ours, premultiplied atlas', 'ours-pma', 'ours', 'pma'],
    ['proof, shifted 1 px', 'shift', 'official', 'proof', ['match']],
    ['proof, shifted 0.25 px', 'nudge', 'official', 'proof', ['match']],
    // a displacement is what `formats` allows, so only the changed slots are a proof for it
    ['proof, slot tinted', 'tint', 'official', 'proof', ['match', 'formats']],
    ['proof, slot hidden', 'hide', 'official', 'proof', ['match', 'formats']],
];
/** The share of the picture a rig must cover in some frame of an animation to count as drawn. */
const VISIBLE_SHARE = 0.005;

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const percent = (share) => `${(100 * share).toFixed(3)}%`;

/** Why a comparison is outside a criterion, or an empty string. Shares are of the covered pixels. */
function outside(criterion, metrics, tolerance, rig) {
    const { max, over1, over8, covered, displaced } = metrics;

    if (criterion === 'exact') return max > 0 ? `max ${max}, and no difference is allowed` : '';
    if (criterion === 'formats') {
        const limit = tolerance.formats.rigs[rig] ?? tolerance.formats.displaced;

        return displaced > limit ? `a displacement does not explain ${percent(displaced)} of the pixels` : '';
    }
    const limits = tolerance[criterion];

    if (max > limits.max) return `max ${max} is over ${limits.max}`;
    if (over8 > limits.over8 * covered) return `${percent(over8 / covered)} of the pixels differ by more than 8`;
    if (over1 > limits.over1 * covered) return `${percent(over1 / covered)} of the pixels differ by more than 1`;

    return '';
}

/** The instances of one sequence: which side, which files, and what the tooling proof changes. */
function roles(plan, official, ours, proof) {
    const { skel, json, atlas, pma } = plan.files;
    const { placement } = plan;
    const list = [];
    const add = (key, side, skeleton, atlasFile, setup) => list.push({ key, side, skeleton, atlas: atlasFile, setup });

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
        if (pma) add('ours-pma', ours, skel, pma);
    }

    return list;
}

/** Compares two frames on both backgrounds and judges the result. */
function judge(ctx, where, [label, , , kind, rejectedBy], a, b) {
    const { plan, options } = ctx;
    const result = { ...where, label, kind, reasons: [] };
    const criteria = rejectedBy ?? [kind];
    // the official additive blend adds alpha to a transparent target, the single draw of ours adds none
    const noAlpha = kind === 'match' && plan.additive;
    const flagged = [];

    for (const name of ['clear', 'solid']) {
        const background = BACKGROUNDS[name];
        const first = a[name].pixels;
        const second = b[name].pixels;
        const full = compare(first, second, plan.size, background);
        const skipAlpha = noAlpha && name === 'clear';
        const judged = skipAlpha ? compare(first, second, plan.size, background, false) : full;

        if (skipAlpha) result.alphaMax = full.channelMax[3];
        if (criteria.includes('formats')) judged.displaced = displacedShare(first, second, plan.size, background);
        result[name] = judged;
        for (const criterion of criteria) {
            const why = outside(criterion, judged, options.tolerance, plan.rig);

            if (why) flagged.push({ name, criterion, why, skipAlpha });
        }
    }
    if (kind === 'proof') {
        for (const criterion of criteria) {
            if (!flagged.some((flag) => flag.criterion === criterion)) {
                result.reasons.push(`not reported: the change is inside the ${criterion} tolerance`);
            }
        }
    } else {
        for (const { name, why } of flagged) result.reasons.push(`${name} background: ${why}`);
    }
    // Clipping arrives with milestone M3. Until then a capture that is off while ours reports a
    // clipping attachment it ignored is a known gap, unless the run is strict about clipping
    if (kind === 'match' && result.reasons.length && !options.strictClipping && a.stats?.clippingIgnored > 0) {
        result.gap = result.reasons;
        result.reasons = [];
    }
    const off = result.reasons.length > 0 || result.gap !== undefined;
    const sample = !off && label === ctx.sampleLabel && where.step > 0 && !ctx.sampled;
    // the known gap has a budget of its own, so it takes no image away from a failure
    const budget = result.gap ? 'gapShotsLeft' : 'shotsLeft';

    if ((off && ctx[budget] > 0) || sample) {
        const { name, skipAlpha } = (kind !== 'proof' && flagged[0]) || { name: 'solid', skipAlpha: false };

        if (sample) ctx.sampled = true;
        else ctx[budget]--;
        result.shots = {
            background: name,
            a: picture(a[name].pixels, plan.size),
            b: picture(b[name].pixels, plan.size),
            diff: difference(a[name].pixels, b[name].pixels, plan.size, !skipAlpha),
        };
    }

    return result;
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
            const instance = await role.side.create({ skeleton: url(role.skeleton), atlas: url(role.atlas) });

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
                frames.set(key, {
                    clear: await studio.shoot(instance.root, BACKGROUNDS.clear),
                    solid: await studio.shoot(instance.root, BACKGROUNDS.solid),
                    stats: instance.stats(),
                });
            } catch (error) {
                fail(key, `failed in render at step ${step}`, error);
            }
        }
        const at = { ...where, step, time: Math.round(step * sequence.dt * 1000) / 1000 };

        for (const pair of PAIRS) {
            const a = frames.get(pair[1]);
            const b = frames.get(pair[2]);

            if (a && b) report.cases.push(judge(ctx, at, pair, a, b));
        }
        for (const key of ['ours', 'official']) {
            const frame = frames.get(key);

            if (frame) ctx.draws[key].push(frame.solid.draws);
            if (frame?.stats) ctx.draws.stat.push(frame.stats.drawCalls);
        }
        if (frames.has('ours')) drawn = Math.max(drawn, coverage(frames.get('ours').clear.pixels, BACKGROUNDS.clear));
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
        draws: { ours: [], official: [], stat: [] },
        shotsLeft: options.shots,
        gapShotsLeft: options.shots,
        sampled: false,
    };

    ctx.sampleLabel = ctx.ours ? (plan.official ? 'ours' : 'ours, json and binary') : 'official twice';
    for (const [index, sequence] of plan.sequences.entries()) await runSequence(ctx, sequence, index === 0);
    if (ctx.ours) {
        if (ctx.draws.ours.length) report.cases.push(drawCallCase(ctx));
        report.cases.push(...(await bufferCases(ctx)));
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
export async function start({ PIXI, loadOurs, loadOfficial }) {
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
