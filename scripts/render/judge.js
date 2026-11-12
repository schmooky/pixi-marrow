/*
 * Browser part of scripts/check-render.mjs: the comparisons of one captured frame, how each is
 * judged, and the second look at a frame that fails ours against official.
 */
import { BACKGROUNDS, compare, difference, displacedShare, picture } from './pixels.js';

/**
 * The comparisons of one frame: label, first picture, second picture, how it is judged.
 *
 * `exact` allows no difference. `match` and `pma` limit the largest difference and the shares of
 * the pixels over 1 and over 8. `formats` limits the share a small displacement cannot explain.
 * `cuts` limits the largest difference between ours with the cuts of overdraw on and off.
 * `polygons` and `polygonsOfficial` limit the shares of the pixels over 1 and over 8 between ours
 * with polygons and a picture of quads. They report the largest difference and do not limit it.
 * A `proof` is wrong on purpose: it passes when every criterion in its list rejects it.
 */
export const PAIRS = [
    ['official twice', 'twin', 'official', 'exact'],
    ['ours', 'ours', 'official', 'match'],
    ['ours, json', 'ours-json', 'official-json', 'match'],
    ['official, json and binary', 'official-json', 'official', 'formats'],
    ['ours, json and binary', 'ours-json', 'ours', 'formats'],
    ['official, premultiplied atlas', 'official-pma', 'official', 'pma'],
    ['ours, premultiplied atlas', 'ours-pma', 'ours', 'pma'],
    // the cuts that are on by default must leave the picture as it is
    ['ours, cuts on and off', 'ours', 'ours-plain', 'cuts'],
    ['ours, cuts on and off, premultiplied', 'ours-pma', 'ours-pma-plain', 'cuts'],
    // polygons are asked for by name: other triangles, so the last bit of a pixel can differ
    ['ours, polygons and quads', 'ours-polygons', 'ours-plain', 'polygons'],
    ['ours, polygons and quads, premultiplied', 'ours-pma-polygons', 'ours-pma-plain', 'polygons'],
    ['ours with polygons, official', 'ours-polygons', 'official', 'polygonsOfficial'],
    ['proof, shifted 1 px', 'shift', 'official', 'proof', ['match']],
    ['proof, shifted 0.25 px', 'nudge', 'official', 'proof', ['match']],
    // a displacement is what `formats` allows, so only the changed slots are a proof for it
    ['proof, slot tinted', 'tint', 'official', 'proof', ['match', 'formats']],
    ['proof, slot hidden', 'hide', 'official', 'proof', ['match', 'formats']],
    ['proof, ours shifted 1 px', 'ours-shift', 'official', 'proof', ['match']],
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
const AGAINST_OFFICIAL = ['match', 'polygonsOfficial'];

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
async function lookAgain(ctx, result, first, again) {
    const { a, b } = await again();
    const second = measure(ctx, 'match', ['match'], a, b);

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
 * Compares two frames on both backgrounds and judges the result.
 *
 * @param again Draws both sides of the pair at the second placement and returns the two frames.
 */
export async function judge(ctx, where, [label, , , kind, rejectedBy], a, b, again) {
    const result = { ...where, label, kind, reasons: [] };
    const criteria = rejectedBy ?? [kind];
    const first = measure(ctx, kind, criteria, a, b);
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
        if (kind === 'match' && flagged.length > 0) await lookAgain(ctx, result, first, again);
    }
    // a frame that ours draws through a clip mask is told apart in the report, and judged like any other
    if (kind === 'match' && a.stats?.maskDraws > 0) result.clipped = true;
    shots(ctx, result, flagged, a, b);

    return result;
}
