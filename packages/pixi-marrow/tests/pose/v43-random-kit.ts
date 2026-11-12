/*
 * What the files that make random 4.3 skeletons share: the random numbers, the names of things
 * and keys with random times and curves.
 */

export type Json = Record<string, unknown>;

/** A random number source from a seed. */
export function random(seed: number) {
    let state = seed >>> 0;
    const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

        return state / 4294967296;
    };
    const int = (n: number): number => Math.floor(next() * n);

    return {
        next,
        int,
        /** A number between `low` and `high` with two decimals. */
        range: (low: number, high: number): number => Math.round((low + next() * (high - low)) * 100) / 100,
        chance: (p: number): boolean => next() < p,
        pick: <T>(list: readonly T[]): T => {
            const item = list[int(list.length)];

            if (item === undefined) throw new Error('Nothing to pick from');

            return item;
        },
    };
}

export type Random = ReturnType<typeof random>;

/** One page without regions: the rigs show paths only. */
export const ATLAS: string = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');
export const INHERIT = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];
export const SIX = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
export const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];
export const SCALES = [1, 1, 1, 1.4, 0.6, -1, -0.7, 0];
/** How many animations a rig has: `a0`, `a1` and so on. */
export const ANIMATIONS = 3;
/** How many skins a rig has. */
export const SKINS = 3;
export const HEX = '0123456789abcdef';

/** What the parts of a rig need to know about each other while it is made. */
export interface Draft {
    r: Random;
    bones: Json[];
    /** The parent of each bone. */
    parents: number[];
    /** The bones that need a skin. */
    gated: number[];
    slots: number;
    /** Per slot: whether it has a dark color. */
    dark: boolean[];
    /** Per slot and path name: how many numbers a deform of the path has. */
    deforms: number[][];
    constraints: Json[];
}

/** Key times that grow, and now and then a first key after time 0. */
export const times = (r: Random, count: number): number[] =>
    Array.from(
        { length: count },
        (_, i) => Math.round((i * 0.35 + (i > 0 || r.chance(0.3) ? r.next() * 0.3 : 0)) * 100) / 100,
    );

/** A linear, stepped or bezier curve for a key of `count` values. */
function curve(r: Random, count: number): Json {
    if (r.chance(0.3)) return { curve: 'stepped' };

    return r.chance(0.4) ? { curve: Array.from({ length: count * 4 }, () => r.range(0, 1)) } : {};
}

/** `count` keys with the values `values` makes, each with a curve for `curves` values. */
export const keys = (r: Random, count: number, curves: number, values: () => Json): Json[] =>
    times(r, count).map((time) => ({ time, ...values(), ...(curves > 0 ? curve(r, curves) : {}) }));
