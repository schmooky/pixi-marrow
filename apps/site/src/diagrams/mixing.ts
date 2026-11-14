/*
 * How the runtime combines animations, on a square with three values: x, y and a scale. The
 * rules are those of the official runtime for a bone. Track 0 starts from the setup pose. A
 * higher track replaces what it keys, part of the way when its alpha is below 1, or adds to it.
 * A mix on one track blends from the animation before to the new one over the mix time.
 */

/** The values of the square. In the setup pose it stands at 0, 0 with scale 1. */
export interface Pose {
    x: number;
    y: number;
    scale: number;
}

/** The values an animation keys at one time. A value it does not key is left out. */
export type Keys = Partial<Pose>;

export const SETUP: Readonly<Pose> = { x: 0, y: 0, scale: 1 };

const NAMES = ['x', 'y', 'scale'] as const;

/** A value between two, a share `t` of the way from `a` to `b`. */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Applies an animation over a pose, as a track above another does. `replace` moves each keyed
 * value from the pose below toward the animation by `alpha`. `add` adds the difference between
 * the animation and the setup pose, times `alpha`. A value the animation does not key stays.
 *
 * @example
 * layer({ x: 100, y: 0, scale: 1 }, { scale: 1.5 }, 1, 'replace'); // { x: 100, y: 0, scale: 1.5 }
 */
export function layer(below: Pose, keys: Keys, alpha: number, blend: 'replace' | 'add'): Pose {
    const result = { ...below };

    for (const name of NAMES) {
        const value = keys[name];

        if (value === undefined) continue;
        result[name] = blend === 'add' ? below[name] + (value - SETUP[name]) * alpha : lerp(below[name], value, alpha);
    }

    return result;
}

/**
 * The pose of track 0 during a mix from one animation to the next, `weight` of the way through.
 * A value that one of them does not key is the setup value for that one, so a value only the
 * animation before keys goes back to the setup pose over the mix.
 */
export function mix(from: Keys, to: Keys, weight: number): Pose {
    const result = { ...SETUP };

    for (const name of NAMES) result[name] = lerp(from[name] ?? SETUP[name], to[name] ?? SETUP[name], weight);

    return result;
}

/** A wave from 0 to 1 and back, `period` seconds long, for a looping animation. */
export const wave = (time: number, period: number): number => 0.5 - 0.5 * Math.cos((time / period) * Math.PI * 2);
