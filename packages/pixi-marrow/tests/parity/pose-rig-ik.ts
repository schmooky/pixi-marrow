import type { SpineVersion } from '../../src/core';
import {
    type Constraint,
    constraintLists,
    ik,
    inherit,
    type Json,
    keys,
    keysOf,
    keysXY,
    madeRig,
    type RigParts,
} from './pose-rig-kit';

/*
 * A rig made for IK. The official examples have one-bone and two-bone IK, both bend directions
 * and a mix below 1, all on bones with plain scale. This rig adds compress, stretch, uniform and
 * volume, softness, bones with negative and with uneven scale, sheared bones, every inherit mode,
 * a bone without a length, a parent without an area, a child that sits on its parent, a child off
 * the axis of its parent, an IK constraint and bones that need a skin, and keys for every value.
 */

/** A one-bone chain: the name of its bone, its parent, the bone and the constraint, and its target. */
type One = [name: string, parent: string, bone: Json, more: Json, target: string];

function ones(version: SpineVersion): One[] {
    return [
        ['o1', 'root', { x: 10, y: 10, length: 40 }, {}, 'tA'],
        // the target comes closer than the bone is long
        ['o2', 'root', { x: -10, y: 20, length: 60, rotation: 30 }, { compress: true }, 'tA'],
        ['o3', 'root', { x: 20, y: -10, length: 25 }, { stretch: true }, 'tA'],
        ['o4', 'root', { y: -30, length: 45, scaleY: 1.2 }, { compress: true, stretch: true, uniform: true }, 'tA'],
        ['o5', 'root', { x: -30, y: -20, length: 30 }, { stretch: true, volume: true, mix: 0.6 }, 'tB'],
        [
            'o6',
            'root',
            { x: 30, y: 30, length: 35, scaleX: -1.2, scaleY: 0.7, shearX: 12, shearY: -8 },
            { compress: true, stretch: true },
            'tB',
        ],
        ['o7', 'hub', { x: 15, y: 5, length: 30, ...inherit(version, 'onlyTranslation') }, { stretch: true }, 'tA'],
        [
            'o8',
            'hub',
            { x: -12, y: 9, length: 30, rotation: 20, ...inherit(version, 'noRotationOrReflection') },
            { compress: true, stretch: true, uniform: true },
            'tA',
        ],
        ['o9', 'hub', { x: 8, y: -14, length: 30, ...inherit(version, 'noScale') }, { stretch: true }, 'tB'],
        [
            'o10',
            'hub',
            { x: -6, y: -9, length: 50, ...inherit(version, 'noScaleOrReflection') },
            { compress: true },
            'tB',
        ],
        // no length: nothing to stretch
        ['o11', 'root', { x: 44, y: -22 }, { stretch: true }, 'tA'],
        // the parent has no area: the target cannot be brought into its space
        ['o12', 'flat', { x: 5, length: 20, rotation: 15 }, {}, 'tA'],
        ['o13', 'arm', { x: 20, y: 4, length: 30, scaleX: 0.8 }, { compress: true, mix: 0.75 }, 'tC'],
    ];
}

/** A two-bone chain: its number, the parent of the first bone, both bones, the constraint, and its target. */
type Two = [n: number, under: string, parent: Json, child: Json, more: Json, target: string];

function twos(version: SpineVersion): Two[] {
    const at = (x: number, y: number, more: Json = {}): Json => ({ x, y, length: 40, ...more });
    const child = (more: Json = {}): Json => ({ x: 40, length: 30, ...more });

    return [
        [1, 'root', at(-50, -40, { rotation: 20 }), child({ rotation: 30 }), {}, 'tA'],
        [2, 'root', at(-50, 50), child({ rotation: -40 }), { bendPositive: false }, 'tA'],
        [3, 'root', at(50, 50), child(), { stretch: true }, 'tB'],
        [4, 'root', at(50, -50, { scaleY: 1 }), child(), { stretch: true, uniform: true, bendPositive: false }, 'tB'],
        [5, 'root', at(0, 60), child({ rotation: 10 }), { softness: 20 }, 'tA'],
        [6, 'root', at(0, -60), child(), { softness: 12, stretch: true, mix: 0.8 }, 'tB'],
        // uneven scale on the parent: the other solver
        [7, 'root', at(-80, 0, { scaleX: 1.3, scaleY: 0.8 }), child({ rotation: 25 }), {}, 'tA'],
        [8, 'root', at(80, 0, { scaleX: 0.7, scaleY: 1.5 }), child(), { bendPositive: false, softness: 6 }, 'tB'],
        [9, 'root', at(-20, 80, { scaleX: -1.1, scaleY: -1.1 }), child({ scaleX: -0.9 }), {}, 'tA'],
        // the child is off the axis of its parent, rotated and sheared
        [10, 'root', at(20, -80, { rotation: 40 }), child({ y: 6, rotation: 20, shearX: 10 }), {}, 'tA'],
        // the child sits on its parent: one-bone IK on the parent
        [11, 'root', at(-70, -70), { length: 30, rotation: 50 }, { stretch: true }, 'tB'],
        [12, 'root', at(70, 70), child(), { mix: 0.5 }, 'tA'],
        [13, 'arm', at(10, -5), child(), { stretch: true, volume: true, mix: 0.7 }, 'tC'],
        // 4.2 and 4.3 leave a chain alone when a bone does not inherit everything, 4.1 solves it
        [14, 'hub', at(-30, 10, inherit(version, 'noScale')), child(), {}, 'tA'],
        // needs the skin
        [15, 'root', at(30, -20, { skin: true }), child({ skin: true }), { skin: true, bendPositive: false }, 'tB'],
        // the bone above the chain is mirrored and sheared
        [16, 'hub', at(25, -25), child({ scaleY: 0.6 }), { softness: 4 }, 'tB'],
        [17, 'root', at(-90, 40, { scaleY: -1 }), child({ rotation: 15 }), { bendPositive: false }, 'tA'],
        [18, 'root', at(90, -40, { scaleX: 1.2, scaleY: -0.7 }), child({ y: 4 }), { stretch: true }, 'tC'],
        // uneven scale and a child longer than its distance: the target passes closer than the chain can fold
        [19, 'root', at(18, 6, { scaleX: 1.5, scaleY: 0.5 }), { x: 10, length: 30 }, {}, 'tA'],
        // the child turns the long way round
        [20, 'root', at(-60, 90), child({ rotation: 165 }), { bendPositive: false }, 'tA'],
    ];
}

function bones(version: SpineVersion): Json[] {
    const fixed = [
        { name: 'root', rotation: 8, scaleX: 1.1 },
        { name: 'tA', parent: 'root', x: 60, y: 40 },
        { name: 'tB', parent: 'root', x: -70, y: 30 },
        { name: 'hub', parent: 'root', x: 12, y: -8, rotation: -15, scaleX: 1.2, scaleY: -0.9, shearX: 6 },
        { name: 'flat', parent: 'root', x: -25, y: 25, scaleY: 0 },
        { name: 'arm', parent: 'root', x: -15, y: 12, rotation: 35, scaleX: 0.9, scaleY: 1.1, length: 30 },
        // a target below a bone that moves
        { name: 'tC', parent: 'arm', x: 55, y: 20 },
    ];
    const one = ones(version).flatMap(([name, parent, bone]) => [
        { name, parent, ...bone },
        { name: `${name}tip`, parent: name, x: 30, y: 2, rotation: 10 },
    ]);
    const two = twos(version).flatMap(([n, under, parent, child]) => [
        { name: `p${n}`, parent: under, ...parent },
        { name: `c${n}`, parent: `p${n}`, ...child },
        { name: `c${n}tip`, parent: `c${n}`, x: 30, rotation: -5, ...(child.skin ? { skin: true } : {}) },
    ]);

    return [...fixed, ...one, ...two];
}

function constraints(version: SpineVersion): Constraint[] {
    return [
        ...ones(version).map(([name, , , more, target]) => ik(version, `i${name}`, [name], target, more)),
        ...twos(version).map(([n, , , , more, target]) => ik(version, `i${n}`, [`p${n}`, `c${n}`], target, more)),
    ];
}

/** Keys of an IK constraint: mix and softness with curves for both, and the three flags. */
function ikKeys(mixes: number[], softness: number[], flags: Json[], duration: number): Json[] {
    const flat = mixes.flatMap((mix, i) => [mix, softness[i] ?? 0]);

    return keysOf(['mix', 'softness'], flat, duration).map((key, i) => ({ ...key, ...flags[i % flags.length] }));
}

/** The targets pass through, inside and outside the reach of every chain, and the constraint values are keyed. */
function reach(version: SpineVersion): Json {
    const flip = [{}, { bendPositive: false }, { bendPositive: false }, {}];
    const k = (values: number[]): Json[] => keys(values, 2);
    const xy = (points: number[]): Json[] => keysXY(points, 2);
    const both = { compress: true, stretch: true };
    // a chain stops and starts being solved, a bone changes how it reaches
    const modes = {
        p14: { inherit: [{ inherit: 'noScale' }, { time: 0.7, inherit: 'normal' }, { time: 1.5, inherit: 'noScale' }] },
        c3: {
            inherit: [
                { time: 0.4, inherit: 'onlyTranslation' },
                { time: 1.1, inherit: 'normal' },
            ],
        },
        o7: {
            inherit: [
                { time: 0.5, inherit: 'noScale' },
                { time: 1.2, inherit: 'noRotationOrReflection' },
            ],
        },
    };

    return {
        bones: {
            tA: { translate: xy([0, 0, 80, -20, -40, -35, -100, 20, 30, -110, -55, -45, 150, 90]) },
            tB: { translate: xy([0, 0, 120, -60, 70, 40, -90, -100, 60, 10]) },
            arm: { rotate: k([0, 70, -50, 200]), scale: xy([1, 1, 1.4, 0.7, 0.8, 1.2]) },
            tC: { translate: xy([0, 0, -60, -30, 40, 25]) },
            // the scale of a chain changes sign while it is solved
            p7: { scale: xy([1, 1, -0.9, 1.4, 0.6, -0.5, 1.5, 1.5]) },
            c9: { scale: xy([1, 1, -1.2, 1, 0.5, 1]), shear: xy([0, 0, 20, -10]) },
            o6: { scale: xy([1, 1, -0.8, -1.3, 0.4, 1.1]), shear: xy([0, 0, -25, 15]) },
            c10: { translate: xy([0, 0, -15, 12, 10, -20]), rotate: k([0, 90, -120]) },
            hub: { rotate: k([0, 40, -30]), scale: xy([1, 1, 0.7, -1.3, 1.2, 0.4]) },
            ...(version === '4.1' ? {} : modes),
        },
        ik: {
            i1: ikKeys([1, 0.3, 0, 0.8, 1], [0, 10, 30, 0, 5], flip, 2),
            i5: ikKeys([1, 1, 0.5, 1], [20, 0, 45, 5], [{}], 2),
            i6: ikKeys([0.8, 1, 0.2], [12, 40, 0], [{ stretch: true }, {}, { stretch: true }], 2),
            i8: ikKeys([1, 0.6, 1], [6, 0, 18], flip, 2),
            io2: ikKeys([1, 0.5, 1, 0], [0, 0, 0, 0], [{ compress: true }, {}, both], 2),
            io4: ikKeys([1, 0.25, 0.9], [0, 0, 0], [both, { stretch: true }, {}], 2),
            i15: ikKeys([1, 0, 1], [0, 8, 0], flip, 2),
        },
    };
}

/** Other keys on some of the same values, so that mixes hold and release. */
function swing(): Json {
    const k = (values: number[]): Json[] => keys(values, 1.3);
    const xy = (points: number[]): Json[] => keysXY(points, 1.3);
    const both = { compress: true, stretch: true };

    return {
        bones: {
            tA: { translate: xy([20, 20, -70, -80, 110, -10]) },
            tB: { translate: xy([-20, 10, 150, -20, 40, -90, 130, 80]) },
            root: { scale: xy([1, 1, 1.3, 0.8, -1, 1]), rotate: k([0, -25, 30]) },
            p1: { rotate: k([0, 100, -100]), translate: xy([0, 0, 15, -10]) },
            c1: { scale: xy([1, 1, 1.5, 1, -0.7, 1]) },
            p9: { scale: xy([1, 1, 1, -1, -1.3, -0.6]) },
            p17: { scale: xy([1, 1, 1.2, -1.2, 0.9, 1.6]) },
            o1: { scale: xy([1, 1, -1, 1, 1.4, 0.5]), shear: xy([0, 0, 15, 30]) },
        },
        ik: {
            i1: ikKeys([0.5, 1], [0, 0], [{ bendPositive: false }, {}], 1.3),
            i2: ikKeys([1, 0.7, 0], [0, 15, 0], [{}, { bendPositive: false }], 1.3),
            i3: ikKeys([1, 1, 0.4], [0, 25, 10], [{}, { stretch: true }, { stretch: true }], 1.3),
            i12: ikKeys([0.5, 1, 0, 0.2], [0, 0, 9, 0], [{}], 1.3),
            io3: ikKeys([1, 0.2], [0, 0], [{}, { stretch: true }], 1.3),
            io6: ikKeys([1, 0.6, 1], [0, 0, 0], [both, { compress: true }, {}], 1.3),
            io8: ikKeys([0, 1, 0.5], [0, 0, 0], [{ stretch: true }, both], 1.3),
        },
    };
}

function parts(version: SpineVersion): RigParts {
    return {
        bones: bones(version),
        slots: [{ name: 's', bone: 'root' }],
        constraints: constraintLists(version, constraints(version)),
        skins: [{ name: 'default' }, { name: 'gear', bones: ['p15', 'c15', 'c15tip'], ik: ['i15'] }],
        animations: {
            reach: reach(version),
            swing: swing(),
            // one key at time 0: an animation without a length
            still: {
                bones: { tA: { translate: [{ x: -30, y: 15 }] }, tB: { translate: [{ x: 45, y: -35 }] } },
                ik: { i1: [{ mix: 0.4, softness: 8 }], i3: [{ mix: 0.9 }], io2: [{ mix: 0.5 }] },
            },
        },
    };
}

/** The IK rig, once for each version. */
export const ikRigs = () => madeRig('made-ik', parts);
