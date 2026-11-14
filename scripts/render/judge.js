/*
 * Browser part of scripts/check-render.mjs: the comparisons of one captured frame, how each is
 * judged, and the second look at a frame that fails ours against official.
 */
import { BACKGROUNDS, compare, difference, displacedShare, picture } from './pixels.js';

/**
 * The comparisons of one frame of a rig. Each has a `label`, the keys `a` and `b` of the two
 * instances it compares, and a `kind` that says how it is judged.
 *
 * `exact` allows no difference. `match` and `pma` limit the largest difference and the shares of
 * the pixels over 1 and over 8. `formats` limits the share a small displacement cannot explain.
 * `cuts` limits the largest difference between ours with the cuts of overdraw on and off.
 * `polygons` and `polygonsOfficial` limit the shares of the pixels over 1 and over 8 between ours
 * with polygons and a picture of quads. They report the largest difference and do not limit it.
 * `modes` is ours in the batched mode against ours in the mesh mode, judged like `match` with
 * limits of its own. It is measured and not judged while `TOLERANCE.modes` of the check is null.
 * `pixi` is the official runtime on the pixi.js of the page against the reference, see
 * `TOLERANCE.pixi` of the check. What it finds is about the official runtime and fails nothing.
 * A `proof` is wrong on purpose: it passes when every criterion in `rejectedBy` rejects it.
 *
 * `group` names the line of the summary a comparison counts in, where that is not its kind. The
 * comparisons of the batched mode have lines of their own, so the lines of the mesh mode keep
 * their meaning. `auto` keeps a comparison for the frames in which the instance with the default
 * options drew in that mode.
 */
export const PAIRS = [
    { label: 'official twice', a: 'twin', b: 'official', kind: 'exact' },
    // on a page that runs on another pixi.js: the official runtime there against the reference
    { label: 'official, this pixi.js', a: 'official-here', b: 'official', kind: 'pixi' },
    { label: 'ours', a: 'ours', b: 'official', kind: 'match' },
    { label: 'ours, json', a: 'ours-json', b: 'official-json', kind: 'match' },
    { label: 'official, json and binary', a: 'official-json', b: 'official', kind: 'formats' },
    { label: 'ours, json and binary', a: 'ours-json', b: 'ours', kind: 'formats' },
    { label: 'official, premultiplied atlas', a: 'official-pma', b: 'official', kind: 'pma' },
    { label: 'ours, premultiplied atlas', a: 'ours-pma', b: 'ours', kind: 'pma' },
    // the cuts that are on by default must leave the picture as it is
    { label: 'ours, cuts on and off', a: 'ours', b: 'ours-plain', kind: 'cuts' },
    { label: 'ours, cuts on and off, premultiplied', a: 'ours-pma', b: 'ours-pma-plain', kind: 'cuts' },
    // polygons are asked for by name: other triangles, so the last bit of a pixel can differ
    { label: 'ours, polygons and quads', a: 'ours-polygons', b: 'ours-plain', kind: 'polygons' },
    {
        label: 'ours, polygons and quads, premultiplied',
        a: 'ours-pma-polygons',
        b: 'ours-pma-plain',
        kind: 'polygons',
    },
    { label: 'ours with polygons, official', a: 'ours-polygons', b: 'official', kind: 'polygonsOfficial' },
    // ours drawn instanced and alone, with skinning on the GPU: the same bits
    { label: 'ours, instancing on and off', a: 'ours', b: 'ours-alone', kind: 'exact', group: 'instancing' },
    // the batched mode: against the official runtime under the same rules, and against the mesh mode
    { label: 'ours batched', a: 'ours-batched', b: 'official', kind: 'match', group: 'matchBatched' },
    { label: 'ours, batched and mesh', a: 'ours-batched', b: 'ours', kind: 'modes' },
    {
        label: 'ours batched, premultiplied atlas',
        a: 'ours-batched-pma',
        b: 'ours-batched',
        kind: 'pma',
        group: 'pmaBatched',
    },
    {
        label: 'ours batched, cuts on and off',
        a: 'ours-batched',
        b: 'ours-batched-plain',
        kind: 'cuts',
        group: 'cutsBatched',
    },
    {
        label: 'ours batched, polygons and quads',
        a: 'ours-batched-polygons',
        b: 'ours-batched-plain',
        kind: 'polygons',
        group: 'polygonsBatched',
    },
    // the default options: `auto` picks a mode, and then draws what that mode draws, to the bit
    { label: 'ours, auto and mesh', a: 'ours-auto', b: 'ours', kind: 'exact', group: 'auto', auto: 'mesh' },
    {
        label: 'ours, auto and batched',
        a: 'ours-auto',
        b: 'ours-batched',
        kind: 'exact',
        group: 'auto',
        auto: 'batched',
    },
    // baked playback, at the sample times of a clip, under the rules of each mode
    { label: 'ours baked', a: 'ours-baked', b: 'official', kind: 'match', group: 'matchBaked' },
    { label: 'ours batched baked', a: 'ours-batched-baked', b: 'official', kind: 'match', group: 'matchBakedBatched' },
    { label: 'proof, shifted 1 px', a: 'shift', b: 'official', kind: 'proof', rejectedBy: ['match'] },
    { label: 'proof, shifted 0.25 px', a: 'nudge', b: 'official', kind: 'proof', rejectedBy: ['match'] },
    // a displacement is what `formats` allows, so only the changed slots are a proof for it
    { label: 'proof, slot tinted', a: 'tint', b: 'official', kind: 'proof', rejectedBy: ['match', 'formats'] },
    { label: 'proof, slot hidden', a: 'hide', b: 'official', kind: 'proof', rejectedBy: ['match', 'formats'] },
    { label: 'proof, ours shifted 1 px', a: 'ours-shift', b: 'official', kind: 'proof', rejectedBy: ['match'] },
    {
        label: 'proof, ours batched shifted 1 px',
        a: 'ours-batched-shift',
        b: 'official',
        kind: 'proof',
        rejectedBy: ['match'],
    },
];

/**
 * How far both sides are moved for the second look at a frame, in pixels of the picture.
 *
 * The official runtime moves vertices to the screen on the CPU in 64-bit numbers. Ours does it in
 * the vertex shader in 32-bit numbers. A GPU then snaps every vertex to a grid of 1/256 pixel and
 * interpolates texture coordinates from there. When a vertex lands on the border between two
 * grid cells, the two sides can snap it to different cells, and every pixel of its triangles
 * samples the texture a little apart. That is a tie of rounding, not a difference of the two
 * runtimes: it is gone when both are moved by an amount that is no multiple of the grid. A real
 * difference moves along with them and stays.
 */
export const SECOND_PLACEMENT = { x: 0.37 / 8, y: 0.61 / 8 };

/** The kinds whose pictures are ours against the official runtime. */
const AGAINST_OFFICIAL = ['match', 'polygonsOfficial', 'idleOfficial'];
/**
 * The kinds that get a second look. `own` is ours in the batched mode judged against ours in the
 * mesh mode, in a scene the official runtime cannot draw. `modes` is the same pair for a rig, once
 * it has a limit. The two modes move vertices to the screen in different places, one on the CPU
 * and one in the vertex shader, like the two runtimes.
 */
const SECOND_LOOK = ['match', 'own', 'modes', 'pixi'];

const percent = (share) => `${(100 * share).toFixed(3)}%`;

/**
 * Why the pixels over 8 and over 1 are outside some limits, or an empty string. A limit is a
 * share of the covered pixels. `few8` and `few1` allow that many pixels in any picture: one
 * pixel is a large share of a picture that covers a few hundred.
 */
function outsideShares(limits, { over1, over8, covered }) {
    if (over8 > Math.max(limits.over8 * covered, limits.few8 ?? 0)) {
        return `${over8} px, ${percent(over8 / covered)} of the pixels, differ by more than 8`;
    }
    if (over1 > Math.max(limits.over1 * covered, limits.few1 ?? 0)) {
        return `${over1} px, ${percent(over1 / covered)} of the pixels, differ by more than 1`;
    }

    return '';
}

/** Why a comparison is outside a criterion, or an empty string. Shares are of the covered pixels. */
function outside(criterion, metrics, tolerance, rig) {
    const { max, displaced } = metrics;

    if (criterion === 'exact') return max > 0 ? `max ${max}, and no difference is allowed` : '';
    if (criterion === 'cuts') return max > tolerance.cuts.max ? `max ${max} is over ${tolerance.cuts.max}` : '';
    if (criterion === 'polygons' || criterion === 'polygonsOfficial') {
        return outsideShares(tolerance[criterion], metrics);
    }
    if (criterion === 'formats') {
        const limit = tolerance.formats.rigs[rig] ?? tolerance.formats.displaced;

        return displaced > limit ? `a displacement does not explain ${percent(displaced)} of the pixels` : '';
    }
    const limits = tolerance[criterion];

    if (max > limits.max) return `max ${max} is over ${limits.max}`;

    return outsideShares(limits, metrics);
}

/**
 * Compares two frames on both backgrounds against some criteria. Returns the numbers of each
 * background, and for every criterion a background is outside of, the reason.
 */
function measure(ctx, kind, criteria, a, b) {
    const { plan, options } = ctx;
    // the official additive blend adds alpha to a transparent target, the single draw of ours adds none
    const noAlpha = AGAINST_OFFICIAL.includes(kind) && plan.additive;
    const out = { flagged: [] };

    for (const name of ['clear', 'solid']) {
        const background = BACKGROUNDS[name];
        const first = a[name].pixels;
        const second = b[name].pixels;
        const full = compare(first, second, plan.size, background);
        const skipAlpha = noAlpha && name === 'clear';
        const judged = skipAlpha ? compare(first, second, plan.size, background, false) : full;

        if (skipAlpha) out.alphaMax = full.channelMax[3];
        if (criteria.includes('formats')) judged.displaced = displacedShare(first, second, plan.size, background);
        out[name] = judged;
        for (const criterion of criteria) {
            const why = outside(criterion, judged, options.tolerance, plan.rig);

            if (why) out.flagged.push({ name, criterion, why, skipAlpha });
        }
    }

    return out;
}

/** The numbers of a frame that a tie is told by: the worse of its two backgrounds. */
function brief(measured) {
    const both = [measured.clear, measured.solid];

    return {
        max: Math.max(...both.map((m) => m.max)),
        differ: Math.max(...both.map((m) => m.differ)),
        over1: Math.max(...both.map((m) => m.over1)),
    };
}

/**
 * The second look at a frame that is outside the tolerance of ours against official. `again`
 * draws both sides at the second placement. A frame that is inside the tolerance there is a tie
 * of rounding: it passes, and the report lists it with the numbers of both placements. A frame
 * that is outside at both placements fails. Returns the numbers of the second placement.
 */
async function lookAgain(ctx, result, first, again, kind = 'match') {
    const { a, b } = await again();
    const second = measure(ctx, kind, [kind], a, b);

    if (second.flagged.length > 0) {
        for (const { name, why } of second.flagged) result.reasons.push(`second placement, ${name} background: ${why}`);

        return second;
    }
    // the numbers that passed are the ones of the frame. The first ones stay in the tie
    result.reasons = [];
    result.tie = { first: brief(first), second: brief(second) };
    result.clear = second.clear;
    result.solid = second.solid;

    return second;
}

/**
 * The second look at a proof. A picture that is wrong on purpose goes through the second look
 * of a frame of ours, and must come out of it as a failure. A proof that comes out as a tie
 * shows that the second look would let a real difference pass.
 */
async function proveAgain(ctx, result, first, again) {
    const shadow = { reasons: ['outside the tolerance at the first placement'] };
    const second = await lookAgain(ctx, shadow, first, again);

    result.second = brief(second);
    if (shadow.tie)
        result.reasons.push('a tie at the second placement: the second look would let this difference pass');
}

/** The pictures of a result, for the images the Node side saves. */
function shots(ctx, result, flagged, a, b) {
    const { plan } = ctx;
    const off = result.reasons.length > 0 || result.tie !== undefined;
    const sample = !off && result.label === ctx.sampleLabel && result.step > 0 && !ctx.sampled;

    if (!(off && ctx.shotsLeft > 0) && !sample) return;
    const { name, skipAlpha } = (result.kind !== 'proof' && flagged[0]) || { name: 'solid', skipAlpha: false };

    if (sample) ctx.sampled = true;
    else ctx.shotsLeft--;
    result.shots = {
        background: name,
        a: picture(a[name].pixels, plan.size),
        b: picture(b[name].pixels, plan.size),
        diff: difference(a[name].pixels, b[name].pixels, plan.size, !skipAlpha),
    };
}

/**
 * One frame of an instance: its picture on both backgrounds, and what its stats say. An instance
 * with a `studio` of its own is drawn there: a side can have a renderer of its own.
 */
export async function capture(studio, instance) {
    const own = instance.studio ?? studio;

    return {
        clear: await own.shoot(instance.root, BACKGROUNDS.clear),
        solid: await own.shoot(instance.root, BACKGROUNDS.solid),
        stats: instance.stats(),
    };
}

/** One frame of an instance at the second placement. The instance is put back where it was. */
export async function captureSecond(studio, instance) {
    const home = instance.home;

    instance.place({ ...home, x: home.x + SECOND_PLACEMENT.x, y: home.y + SECOND_PLACEMENT.y });
    try {
        return await capture(studio, instance);
    } finally {
        instance.place(home);
    }
}

/**
 * Compares two frames on both backgrounds and judges the result.
 *
 * @param pair One entry of `PAIRS`, or of the comparisons of a scene.
 * @param again Draws both sides of the pair at the second placement and returns the two frames.
 */
export async function judge(ctx, where, pair, a, b, again) {
    const { label, kind, rejectedBy, group } = pair;
    const result = { ...where, label, kind, reasons: [] };
    // a kind whose tolerance is null is measured and not judged
    const criteria = rejectedBy ?? (ctx.options.tolerance[kind] === null ? [] : [kind]);
    const first = measure(ctx, kind, criteria, a, b);

    if (group) result.group = group;
    // the mode that drew the batched side of this frame, where a comparison has one
    if (pair.a.includes('batched') && ctx.batchedDrew) result.drew = ctx.batchedDrew;
    const { flagged } = first;

    result.clear = first.clear;
    result.solid = first.solid;
    if (first.alphaMax !== undefined) result.alphaMax = first.alphaMax;
    if (kind === 'proof') {
        for (const criterion of criteria) {
            if (!flagged.some((flag) => flag.criterion === criterion)) {
                result.reasons.push(`not reported: the change is inside the ${criterion} tolerance`);
            }
        }
        if (result.reasons.length === 0 && criteria.includes('match')) await proveAgain(ctx, result, first, again);
    } else {
        for (const { name, why } of flagged) result.reasons.push(`${name} background: ${why}`);
        if (SECOND_LOOK.includes(kind) && flagged.length > 0) await lookAgain(ctx, result, first, again, kind);
    }
    // A frame that ours draws through a clip mask is told apart in the report, and judged like any
    // other. The batched mode has no mask draws, so its frame counts when the mesh frame of the
    // same pose does: `ctx.clipped`
    if (kind === 'match' && (a.stats?.maskDraws > 0 || (group && ctx.clipped))) result.clipped = true;
    shots(ctx, result, flagged, a, b);

    return result;
}
