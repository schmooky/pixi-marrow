import type { SpineVersion } from '../../src/core';
import { type Json, keysAt, swing, unevenTimes } from './pose-rig-kit';

/*
 * Animations with long timelines, for the lookup of keys. The official examples have at most 54
 * keys in a timeline, at even steps for the most part, and the rigs made here had eight. These
 * animations have up to 160 keys per timeline at uneven times, in timelines of every kind, so
 * that an update skips several keys of one timeline and none of another.
 */

const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];
const SEQUENCE_MODES = ['hold', 'once', 'loop', 'pingpong', 'onceReverse', 'loopReverse', 'pingpongReverse'];
const INHERIT_MODES = ['normal', 'noScale', 'onlyTranslation', 'noRotationOrReflection'];

/** Two hex digits that change from key to key. */
const hex = (n: number): string =>
    Math.round(((Math.sin(n) + 1) / 2) * 255)
        .toString(16)
        .padStart(2, '0');
const rgb = (i: number): string => `${hex(i * 1.3)}${hex(i * 2.1 + 1)}${hex(i * 0.7 + 2)}`;
const stepped = (i: number): Json => (i % 3 === 2 ? { curve: 'stepped' } : {});

/** Keys of one value that swings around `base`. */
const one = (times: number[], amplitude: number, base = 0): Json[] =>
    keysAt(times, (i) => ({ value: base + swing(i, amplitude) }));

/** The long animation of the rig `made-for-pose`: bone, slot, attachment, draw order and event timelines. */
export function longPose(version: SpineVersion): Json {
    const at = (count: number, phase: number): number[] => unevenTimes(count, 3, phase);
    const inherit = at(20, 4).map((time, i) => ({ time, inherit: INHERIT_MODES[i % 4] }));
    const sequence = at(30, 1).map((time, i) => ({
        time,
        mode: SEQUENCE_MODES[i % 7],
        index: i % 5,
        delay: 0.02 + (i % 3) * 0.03,
    }));
    const deform = at(40, 3).map((time, i) => ({
        time,
        offset: i % 3,
        vertices: [swing(i, 1), swing(i, 0.5, 2.9), 0, swing(i, 0.7, 0.9)],
        ...stepped(i),
    }));

    return {
        bones: {
            a: { rotate: one(at(160, 0), 170), scalex: one(at(47, 3), 0.6, 1) },
            b: {
                translatex: one(at(90, 1), 25),
                translatey: one(at(61, 2), 25),
                ...(version === '4.1' ? {} : { inherit }),
            },
            c: { shearx: one(at(33, 5), 30) },
            e: { translate: keysAt(at(75, 6), (i) => ({ x: swing(i, 12), y: swing(i, 9, 2.3) })) },
        },
        slots: {
            s0: { rgba: at(64, 7).map((time, i) => ({ time, color: `${rgb(i)}${hex(i * 1.9)}`, ...stepped(i) })) },
            s1: { rgb2: at(40, 2).map((time, i) => ({ time, light: rgb(i), dark: rgb(i + 7), ...stepped(i) })) },
            s2: { attachment: at(50, 8).map((time, i) => ({ time, name: i % 2 === 0 ? null : 'img' })) },
            s4: { alpha: one(at(80, 9), 0.5, 0.5) },
        },
        attachments: { default: { s0: { img: { sequence } }, s3: { quad: { deform } } } },
        drawOrder: at(30, 5).map((time, i) => ({
            time,
            ...(i % 3 === 0 ? {} : { offsets: [{ slot: i % 2 === 0 ? 's0' : 's1', offset: 1 + (i % 3) }] }),
        })),
        events: at(25, 6).map((time, i) => ({ time, name: i % 2 === 0 ? 'hit' : 'done', int: i })),
    };
}

/** The long animation of the rig `made-order`: a timeline of every kind of constraint its version has. */
export function longConstraints(version: SpineVersion): Json {
    const at = (count: number, phase: number): number[] => unevenTimes(count, 2.5, phase);
    const mixes = (times: number[], names: readonly string[]): Json[] =>
        keysAt(times, (i) => Object.fromEntries(names.map((name, n) => [name, 0.5 + swing(i + n * 3, 0.5)])));
    const leg = keysAt(at(40, 0), (i) => ({ mix: 0.5 + swing(i, 0.5), softness: 14 + swing(i, 6, 0.9) }));
    const sway = {
        wind: one(at(45, 7), 30),
        mix: one(at(28, 8), 0.5, 0.5),
        reset: at(20, 9).map((time) => ({ time })),
    };
    const slider = {
        dial: { time: one(at(40, 5), 0.5, 0.5), mix: one(at(25, 1), 0.5, 0.5) },
        knob: { mix: one(at(18, 3), 0.5, 0.5) },
    };

    return {
        bones: { aim: { translate: keysAt(at(12, 2), (i) => ({ x: swing(i, 60), y: swing(i, 50, 2.1) })) } },
        ik: { leg: leg.map((key, i) => ({ ...key, bendPositive: i % 4 < 2 })) },
        transform: { ankleFollow: mixes(at(30, 1), MIXES), toeCopy: mixes(at(17, 5), MIXES) },
        path: {
            ride: {
                position: one(at(50, 3), 0.6, 0.5),
                spacing: one(at(35, 4), 10, 10),
                mix: mixes(at(22, 6), MIXES.slice(0, 3)),
            },
        },
        ...(version === '4.1' ? {} : { physics: { sway } }),
        ...(version === '4.3' ? { slider } : {}),
    };
}
