import type { SpineVersion } from '../../src/core';
import type { Json } from './pose-rig-kit';

/*
 * The `wake` animations of the rigs made here. A `wake` animation keys no bone. It keys values of
 * constraints, each from a mix of 0 that holds for a while, so that the bones stand still at
 * first and a constraint then starts to move them. The scripts for bones that do not move play
 * every animation whose name starts with `wake`.
 */

const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];

/**
 * Keys of a mix, under the names given: 0 for a while, up to 1, held, and back to 0. `shift`
 * moves the keys later, so that two constraints do not wake in the same update.
 */
function wakeKeys(names: readonly string[], shift = 0, more: Json = {}): Json[] {
    const key = (time: number, value: number, extra: Json = {}): Json => ({
        ...(time > 0 ? { time } : {}),
        ...Object.fromEntries(names.map((name) => [name, value])),
        ...more,
        ...extra,
    });

    return [
        key(0, 0),
        key(0.3 + shift, 0),
        key(0.7 + shift, 1),
        key(1 + shift, 1, { curve: 'stepped' }),
        key(1.3 + shift, 0),
    ];
}

const mix = (shift = 0, more: Json = {}): Json[] => wakeKeys(['mix'], shift, more);
const value = (shift = 0): Json[] => wakeKeys(['value'], shift);
const six = (shift = 0): Json[] => wakeKeys(MIXES, shift);
const three = (shift = 0): Json[] => wakeKeys(MIXES.slice(0, 3), shift);

/** For `made-ik`: one-bone and two-bone chains, one below a bone of another inherit mode, one that needs a skin. */
export const wakeIk = (): Json => ({
    ik: {
        i1: mix(),
        i5: mix(0.1, { softness: 10 }),
        io2: mix(0.05, { compress: true }),
        io7: mix(0.15, { stretch: true }),
        i15: mix(0.2),
    },
});

/** For `made-transform`: world and local constraints, and one on a bone with many bones below it. */
export const wakeTransform = (): Json => ({
    transform: { full: six(), local: six(0.1), hubTurn: six(0.15), mode2: six(0.05), zero: six(0.2) },
});

/** For `made-path`: the mixes of two constraints, the position of a third alone, and a path that changes its shape. */
export const wakePath = (): Json => ({
    path: {
        tangent: { mix: three() },
        chain: { mix: three(0.1) },
        wrap: { position: [{ value: 30 }, { time: 0.5, value: 30 }, { time: 1.2, value: 90 }] },
    },
    attachments: {
        default: {
            closed: {
                closed: { deform: [{ time: 0.8 }, { time: 1.1, offset: 4, vertices: [6, -6, 4, 4] }, { time: 1.5 }] },
            },
        },
    },
});

/** For `made-order`: a constraint of every kind the version has. The transform constraint turns the root bone. */
export function wakeOrder(version: SpineVersion): Json {
    return {
        ik: { leg: mix() },
        transform: { rootTurn: six(0.2) },
        path: { ride: { mix: three(0.1) } },
        ...(version === '4.1' ? {} : { physics: { sway: { mix: value(0.05) } } }),
        ...(version === '4.3' ? { slider: { dial: { mix: value(0.15) } } } : {}),
    };
}

/** For `made-physics`: a constraint that is off in the setup pose, one that is on, and the mix of all that follow it. */
export const wakePhysics = (): Json => ({
    physics: {
        off: { mix: value(), wind: [{ value: 30 }] },
        onlyX: { mix: value(0.1), wind: [{ value: -20 }] },
        '': { mix: value(0.2), gravity: [{ value: 15 }] },
    },
});

/** For `made-physics-order`: physics in the middle of a chain, and the constraints the physics bones hang on. */
export const wakePhysicsOrder = (): Json => ({
    ik: { reach: mix() },
    transform: { copy: six(0.1) },
    path: { ride: { mix: three(0.2) } },
    physics: { rope3: { mix: value(0.05), wind: [{ value: 25 }] }, hand: { mix: value(0.15) } },
});

/** For `made-slider`: sliders that read a bone, one with its own time, and the ones around the other constraints. */
export const wakeSlider = (): Json => ({
    slider: {
        rotate: { mix: value() },
        own: { mix: value(0.1), time: [{ value: 0.2 }, { time: 1.5, value: 0.9 }] },
        driver: { mix: value(0.05) },
        post: { mix: value(0.2) },
    },
});

/** For `made-slider-slots`: sliders that write slots and the draw order while every bone stands still. */
export const wakeSliderSlots = (): Json => ({
    slider: {
        paint: { mix: value() },
        shuffle: { mix: value(0.1) },
        fade: { mix: value(0.2), time: [{ value: 0.1 }, { time: 1.5, value: 0.8 }] },
    },
});

/** For `made-for-pose`, which has no constraints: slots and the draw order change while every bone stands still. */
export const wakeSlots = (): Json => ({
    slots: {
        s0: {
            rgba: [
                { time: 0.3, color: 'ff8040c0' },
                { time: 0.9, color: '2040ff40' },
            ],
        },
        s2: {
            attachment: [
                { time: 0.5, name: null },
                { time: 1.1, name: 'img' },
            ],
        },
        s4: {
            alpha: [
                { time: 0.4, value: 1 },
                { time: 1.2, value: 0.2 },
            ],
        },
    },
    attachments: {
        default: { s3: { quad: { deform: [{ time: 0.6 }, { time: 1, vertices: [1, 1, -1, 1] }, { time: 1.4 }] } } },
    },
    drawOrder: [{ time: 0.7, offsets: [{ slot: 's0', offset: 2 }] }, { time: 1.3 }],
});
