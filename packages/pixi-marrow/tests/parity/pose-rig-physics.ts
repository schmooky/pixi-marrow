import type { SpineVersion } from '../../src/core';
import {
    type Constraint,
    constraintLists,
    inherit,
    type Json,
    keys,
    keysXY,
    madeRig,
    physics,
    type RigParts,
} from './pose-rig-kit';
import { wakePhysics } from './pose-rig-wake';

/*
 * A rig made for physics constraints, for 4.2 and 4.3. The official examples have physics that
 * turns, moves and scales bones with the default limit and step. This rig has each property alone
 * and together, limits and steps that an update hits, every value of a constraint off its
 * default, a mix below 1 and of 0, each global flag on some constraints and off on others, bones
 * of every inherit mode below a mirrored and sheared bone, bones that are scaled, sheared and
 * mirrored themselves, a bone without a length, the two scaleY modes of 4.3 and a reference scale
 * that is not 100.
 *
 * Its animations move the bones further in one update than the limits allow, key every value of
 * one constraint and of all constraints at once with every kind of curve, and reset one
 * constraint and all of them, also at the two ends of a loop.
 */

/** The values 4.3 has as defaults. 4.2 has an inertia and a damping of 1. */
const SOFT = { inertia: 0.5, damping: 0.85 };

/** Constraints that differ in what they move. Each is on the bone of its name. */
const MOVES: [name: string, values: Json][] = [
    ['onlyX', { x: 1 }],
    ['onlyY', { y: 1 }],
    ['onlyRotate', { rotate: 1 }],
    ['onlyScale', { scaleX: 1 }],
    ['onlyShear', { shearX: 1 }],
    ['xy', { x: 1, y: 0.5 }],
    ['turnScale', { rotate: 1, scaleX: 0.7 }],
    ['turnShear', { rotate: 0.6, shearX: 0.8 }],
    ['scaleShear', { scaleX: 1, shearX: 0.5 }],
    ['all', { x: 0.8, y: 0.6, rotate: 0.9, scaleX: 0.5, shearX: 0.4 }],
];

/** Constraints that differ in their limit, their step and their values. */
const TUNED: [name: string, values: Json][] = [
    // a step longer than an update: some updates make no step
    ['slow', { rotate: 1, x: 0.5, fps: 15, inertia: 0.3, strength: 30, damping: 0.6, mass: 4, wind: -20, gravity: 25 }],
    // a limit that every move hits, and four steps in an update
    [
        'fast',
        { x: 1, y: 1, rotate: 1, fps: 120, limit: 40, inertia: 1, strength: 400, damping: 1, mass: 0.3, gravity: -15 },
    ],
    ['fine', { rotate: 0.5, scaleX: 1, fps: 240, limit: 300, inertia: 0.8, damping: 0.9, wind: 35, mix: 0.6 }],
    // off until an animation keys its mix
    ['off', { rotate: 1, x: 1, ...SOFT, mix: 0 }],
    // the defaults of the version
    ['plain', { rotate: 1 }],
    // moves nothing
    ['idle', SOFT],
    // a bone without a length: nothing to scale, and wind and gravity have no lever
    ['dot', { rotate: 1, scaleX: 1, ...SOFT, wind: 10, gravity: 10 }],
    // what only 4.3 has: scaleY follows scaleX
    ['uniform', { rotate: 1, scaleX: 1, scaleY: 'uniform', ...SOFT }],
    ['volume', { scaleX: 1, scaleY: 'volume', ...SOFT, strength: 60 }],
];

const VALUES = ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'];
/** Which values of a constraint follow the timelines for all constraints. */
const GLOBALS: [name: string, values: string[]][] = [
    ['g0', VALUES],
    ['g1', ['inertia', 'damping', 'wind', 'mix']],
    ['g2', ['strength', 'mass', 'gravity']],
    ['g3', []],
];

const MODES = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];

/** A bone for a physics constraint, with a tip below it that shows where the bone ends up. */
function pair(name: string, i: number, more: Json = {}): Json[] {
    const bone = {
        name,
        parent: 'carrier',
        x: (i % 6) * 35 - 90,
        y: Math.floor(i / 6) * 40 - 80,
        rotation: ((i * 53) % 360) - 180,
        length: 30,
        scaleX: [1, 1.3, 0.8][i % 3],
        scaleY: [1, 0.7, 1.2, -1][i % 4],
        shearX: i % 5 === 3 ? 12 : 0,
        shearY: i % 4 === 2 ? -8 : 0,
        ...more,
    };

    return [bone, { name: `${name}Tip`, parent: name, x: 30, y: 4, rotation: 15 }];
}

function bones(version: SpineVersion): Json[] {
    const plain = [...MOVES, ...TUNED, ...GLOBALS].map(([name], i) =>
        pair(name, i, name === 'dot' ? { length: 0 } : {}),
    );
    // every inherit mode below a bone that is turned, scaled, sheared and mirrored
    const modes = MODES.map((mode, i) =>
        pair(`mode${i}`, i, { parent: 'frame', y: 20, scaleY: 1.1, ...inherit(version, mode) }),
    );

    return [
        { name: 'root', rotation: 4 },
        { name: 'carrier', parent: 'root', x: 10, y: 5, length: 10 },
        { name: 'frame', parent: 'carrier', x: -40, y: 60, rotation: 20, scaleX: 1.2, scaleY: -0.8, shearX: 5 },
        ...plain.flat(),
        ...modes.flat(),
    ];
}

function constraints(version: SpineVersion): Constraint[] {
    const swing = { rotate: 1, x: 0.5, y: 0.5, ...SOFT };

    return [
        ...MOVES.map(([name, values]) => physics(version, name, name, { ...SOFT, ...values })),
        ...TUNED.map(([name, values]) => physics(version, name, name, values)),
        ...GLOBALS.map(([name, values]) =>
            physics(version, name, name, {
                ...swing,
                ...Object.fromEntries(values.map((value) => [`${value}Global`, true])),
            }),
        ),
        ...MODES.map((_, i) =>
            physics(version, `mode${i}`, `mode${i}`, {
                x: 0.7,
                y: 0.7,
                rotate: 1,
                scaleX: 0.5,
                shearX: i % 2,
                ...SOFT,
            }),
        ),
    ];
}

/** The carrier turns and moves, and one constraint has a timeline of every kind. */
function shake(): Json {
    const k = (values: number[]): Json[] => keys(values, 2);
    const xy = (points: number[]): Json[] => keysXY(points, 2);

    return {
        bones: {
            carrier: {
                translate: xy([0, 0, 150, -60, -120, 90, 60, -160, -30, 40, 200, 120]),
                rotate: k([0, 220, -160, 90]),
            },
            frame: { rotate: k([0, -70, 50]), scale: xy([1, 1, 1.4, 0.6, 0.7, 1.3]) },
            all: { rotate: k([0, 60, -60]) },
            mode2: { translate: xy([0, 0, 25, -15]) },
        },
        physics: {
            all: {
                inertia: k([0.5, 1, 0.1, 0.8]),
                strength: k([100, 30, 300, 150]),
                damping: k([0.85, 0.5, 1, 0.7]),
                mass: k([1, 3, 0.4, 2]),
                wind: k([0, 40, -40, 15]),
                gravity: k([0, -30, 30, 10]),
                mix: k([1, 0.3, 0, 0.8]),
            },
            off: { mix: k([0, 1, 0.5]) },
            slow: { reset: [{ time: 0.7 }] },
            // a constraint that follows the timelines for all constraints has its own too
            g1: { wind: k([0, 20]) },
        },
    };
}

/** Timelines for all constraints at once: a constraint follows those its global flags name. */
function gust(): Json {
    const k = (values: number[]): Json[] => keys(values, 1.5);
    const xy = (points: number[]): Json[] => keysXY(points, 1.5);

    return {
        bones: {
            carrier: { translate: xy([0, 0, -80, 40, 60, 70]), rotate: k([0, -45, 30]) },
            frame: { shear: xy([0, 0, 20, -15]) },
        },
        physics: {
            '': {
                inertia: k([0.5, 0.9, 0.2, 0.7]),
                strength: k([100, 250, 40]),
                damping: k([0.85, 0.6, 0.95]),
                mass: k([1, 2.5, 0.5]),
                wind: k([0, 50, -30, 15]),
                gravity: k([0, 20, -40]),
                mix: k([1, 0.2, 0.7]),
                // at both ends of a loop and inside it
                reset: [{}, { time: 0.6 }, { time: 1.5 }],
            },
            // the global timeline and this one write the same value
            g0: { wind: k([10, -10]) },
        },
    };
}

/** Jumps that are further than any limit allows, physics bones that move themselves, and resets of single constraints. */
function jolt(): Json {
    const k = (values: number[]): Json[] => keys(values, 0.8);
    const xy = (points: number[]): Json[] => keysXY(points, 0.8);
    const stepped = { curve: 'stepped' };

    return {
        bones: {
            carrier: {
                translate: [
                    stepped,
                    { time: 0.2, x: 420, y: -310, ...stepped },
                    { time: 0.4, x: -380, y: 250 },
                    { time: 0.8 },
                ],
                rotate: [stepped, { time: 0.3, value: 170, ...stepped }, { time: 0.6, value: -100 }, { time: 0.8 }],
            },
            onlyRotate: { rotate: k([0, 90, -90]) },
            xy: { translate: xy([0, 0, 60, 60, -60, 20]) },
            turnScale: { scale: xy([1, 1, 2, 0.5, 0.3, 1]) },
            mode3: { rotate: k([0, -120]), shear: xy([0, 0, 30, 30]) },
            // the inherit mode of a physics bone changes while physics runs
            mode1: {
                inherit: [
                    { inherit: 'noScale' },
                    { time: 0.3, inherit: 'normal' },
                    { time: 0.6, inherit: 'onlyTranslation' },
                ],
            },
            fast: { translate: xy([0, 0, 0, 90]) },
        },
        physics: {
            fast: { reset: [{}, { time: 0.4 }, { time: 0.8 }] },
            slow: { reset: [{ time: 0.8 }], strength: k([30, 200]) },
            onlyX: { reset: [{ time: 0.1 }] },
            fine: { mix: k([0.6, 1, 0]) },
        },
    };
}

/** One key at time 0: an animation without a length. */
function still(): Json {
    return {
        bones: { carrier: { translate: [{ x: 50, y: -30 }], rotate: [{ value: 45 }] } },
        physics: {
            all: { mix: [{ value: 0.5 }], wind: [{ value: 10 }] },
            off: { mix: [{ value: 1 }] },
            '': { gravity: [{ value: -30 }], strength: [{ value: 60 }] },
        },
    };
}

function parts(version: SpineVersion): RigParts {
    return {
        bones: bones(version),
        slots: [{ name: 's', bone: 'root' }],
        constraints: constraintLists(version, constraints(version)),
        skins: [{ name: 'default' }],
        animations: { shake: shake(), gust: gust(), jolt: jolt(), wake: wakePhysics(), still: still() },
        header: { referenceScale: 80 },
    };
}

/** The physics rig, for the two versions that have physics. */
export const physicsRigs = () => madeRig('made-physics', parts, ['4.2', '4.3']);
