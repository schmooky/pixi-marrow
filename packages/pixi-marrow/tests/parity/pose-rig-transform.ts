import type { SpineVersion } from '../../src/core';
import {
    type Constraint,
    constraintLists,
    inherit,
    type Json,
    keys,
    keysOf,
    keysXY,
    madeRig,
    type RigParts,
} from './pose-rig-kit';
import { wakeTransform } from './pose-rig-wake';

/*
 * A rig made for transform constraints. The official examples have them from world to world
 * only, absolute, with every property mapped to itself. This rig has the four variants of 4.1
 * and 4.2 (absolute and relative, world and local) and for 4.3 a local source, a local target,
 * additive, clamp and mappings from one property to others. Both have offsets, part mixes, single
 * properties, negative mixes, a mirrored source, constrained bones of every inherit mode whose
 * local pose a later constraint reads, bones without a size, two constraints on one bone, a
 * constrained bone below a bone that is constrained later, constraints and a source that need a
 * skin, and keys for the six mixes.
 */

/** The bones `w0` to `w8`: every inherit mode, then bones without a width or a height. */
const MODES: [mode: string, more: Json][] = [
    ['normal', {}],
    ['onlyTranslation', {}],
    ['noRotationOrReflection', {}],
    ['noScale', {}],
    ['noScaleOrReflection', {}],
    ['noScale', { scaleX: 0 }],
    ['normal', { scaleY: 0 }],
    ['noScaleOrReflection', { scaleY: 0 }],
    ['normal', { scaleX: 0 }],
];
const SIX = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];
const OFFSETS = { rotation: 20, x: 5, y: -3, scaleX: 0.1, scaleY: -0.2, shearY: 10 };
const PART = { mixRotate: 0.5, mixX: 0.25, mixY: 0.75, mixScaleX: 0.6, mixScaleY: 0.4, mixShearY: 0.5 };
const MINUS = { mixRotate: -0.5, mixX: -1, mixY: 0.5, mixScaleX: -0.3, mixScaleY: 0.2, mixShearY: -0.5 };
const NONE = { mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 };

/** The bones a constraint of this rig moves, by the number of each, with a tip below each. */
const b = (...numbers: number[]): string[] => numbers.map((n) => `b${n}`);

function bones(version: SpineVersion): Json[] {
    const fixed = [
        { name: 'root', rotation: 5, scaleX: 1.05 },
        { name: 'src', parent: 'root', x: 20, y: 10, rotation: 25, scaleX: 1.2, scaleY: 0.8, shearY: 10, length: 20 },
        // a source under a bone that moves
        { name: 'deep', parent: 'src', x: 30, y: 5, rotation: 15, scaleX: 0.9, shearX: 8 },
        { name: 'mirror', parent: 'root', x: -30, y: 20, rotation: -40, scaleY: -1.1 },
        { name: 'holder', parent: 'root', x: -10, y: -15, rotation: 20, scaleX: 0.9, scaleY: 1.2 },
        { name: 'hub', parent: 'root', x: 12, y: -8, rotation: -15, scaleX: 1.2, scaleY: -0.9, shearX: 6 },
        { name: 'st', parent: 'root', x: 40, y: -30, rotation: 70, skin: true },
    ];
    const moved = Array.from({ length: 30 }, (_, i) => {
        const n = i + 1;
        const bone: Json = {
            name: `b${n}`,
            parent: n % 3 === 0 ? 'root' : 'holder',
            x: (n % 6) * 14 - 35,
            y: Math.floor(n / 6) * 16 - 40,
            rotation: (n * 47) % 300,
            scaleX: [1, 1.2, -0.8, 0.7][n % 4],
            scaleY: [1, 0.9, 1.3, -1.1, 1][n % 5],
            shearX: n % 7 === 0 ? 12 : 0,
            shearY: n % 4 === 1 ? -9 : 0,
            length: 15,
            // two bones without a size: a constraint cannot scale them
            ...(n === 3 ? { scaleX: 0 } : {}),
            ...(n === 10 ? { scaleX: 0, scaleY: 0 } : {}),
        };

        return [bone, { name: `b${n}tip`, parent: `b${n}`, x: 15, y: 3, rotation: 10 }];
    });
    // bones of every inherit mode below a mirrored bone, and a bone that follows the local pose of each
    const modes = MODES.flatMap(([mode, more], i) => [
        {
            name: `w${i}`,
            parent: 'hub',
            x: i * 9 - 20,
            y: 14,
            rotation: 30 + i * 20,
            scaleX: 1.1,
            ...inherit(version, mode),
            ...more,
        },
        { name: `w${i}tip`, parent: `w${i}`, x: 12, rotation: -20 },
        { name: `f${i}`, parent: 'holder', x: i * 9 - 20, y: 30, scaleY: 0.8 },
    ]);

    return [...fixed, ...moved.flat(), ...modes];
}

/** A 4.1 or 4.2 constraint: `local` and `relative` pick one of the four variants. */
function legacy(name: string, bones: string[], target: string, more: Json = {}): Constraint {
    return { type: 'transform', name, bones, target, ...more };
}

function legacyList(): Constraint[] {
    const local = { local: true };
    const relative = { relative: true };

    return [
        legacy('full', b(1), 'src', OFFSETS),
        legacy('part', b(2, 3), 'src', { ...OFFSETS, ...PART }),
        legacy('flip', b(4), 'mirror', { rotation: 30, shearY: -20, ...PART, mixRotate: 0.8, mixX: 0.8 }),
        legacy('rel', b(5), 'src', { ...relative, ...OFFSETS }),
        legacy('relPart', b(6, 7), 'mirror', { ...relative, ...OFFSETS, ...PART }),
        legacy('local', b(8), 'src', { ...local, ...OFFSETS }),
        // the second bone has no width: its scale is left alone
        legacy('localPart', b(9, 10), 'deep', { ...local, ...OFFSETS, ...PART }),
        legacy('localRel', b(11), 'src', { ...local, ...relative, ...OFFSETS }),
        legacy('localRelPart', b(12), 'mirror', { ...local, ...relative, ...OFFSETS, ...PART }),
        // one property each
        legacy('move', b(13), 'src', { ...NONE, mixX: 1, mixY: 0.5 }),
        legacy('turn', b(14), 'mirror', { ...NONE, mixRotate: 1 }),
        legacy('size', b(15), 'src', { ...relative, ...NONE, mixScaleX: 1, mixScaleY: 0.7, scaleX: 0.2 }),
        legacy('slant', b(16), 'mirror', { ...relative, ...NONE, mixShearY: 1, shearY: 15 }),
        // off in the setup pose, keyed on
        legacy('zero', b(17), 'src', { ...OFFSETS, ...NONE }),
        legacy('minus', b(18), 'src', { ...OFFSETS, ...MINUS }),
        legacy('minusRel', b(19), 'src', { ...relative, ...OFFSETS, ...MINUS }),
        legacy('minusLocal', b(20), 'src', { ...local, ...OFFSETS, ...MINUS }),
        legacy('skinned', b(21), 'src', { ...relative, skin: true, x: 10 }),
        legacy('skinSource', b(22), 'st', {}),
        // two on one bone
        legacy('twiceTurn', b(23), 'src', { ...NONE, mixRotate: 0.7, rotation: -15 }),
        legacy('twiceMove', b(23), 'mirror', { ...relative, ...NONE, mixX: 0.5, mixY: 0.5, x: 4, y: 4 }),
        // world constraints on every inherit mode, then a local one that reads what each left
        ...MODES.map((_, i) => legacy(`mode${i}`, [`w${i}`], 'src', { ...OFFSETS, ...PART, mixRotate: 1 })),
        ...MODES.map((_, i) => legacy(`read${i}`, [`f${i}`], `w${i}`, { ...local, rotation: 5 })),
        ...MODES.map((_, i) => legacy(`again${i}`, [`w${i}`], 'mirror', { ...relative, ...PART })),
        // the bone above them moves after that: they are posed again from what the constraints left
        legacy('hubTurn', ['hub'], 'src', { ...NONE, mixRotate: 0.3, mixX: 0.1 }),
        // the source of a local constraint was moved by a world constraint
        legacy('chain', b(24, 25), 'b1', { ...local, ...relative, mixRotate: 0.5 }),
        legacy('chainWorld', b(26), 'b8', { x: 6 }),
        // a local constraint on a bone a world constraint moved
        legacy('after', b(1, 3), 'deep', { ...local, ...relative, ...NONE, mixRotate: 0.5, mixScaleX: 0.5 }),
    ];
}

/** The 4.3 mapping of properties to themselves, as the editor writes it. */
const same = (names: readonly string[] = SIX): Json =>
    Object.fromEntries(names.map((name) => [name, { to: { [name]: name.startsWith('scale') ? {} : { max: 100 } } }]));

function constraint43(name: string, bones: string[], source: string, properties: Json, more: Json = {}): Constraint {
    return { type: 'transform', name, bones, source, properties, ...more };
}

function list43(): Constraint[] {
    const local = { localSource: true, localTarget: true };
    const additive = { additive: true };
    // one property feeds several, with offsets and scales
    const cross = {
        rotate: { offset: 15, to: { x: { offset: 10, scale: 0.5 }, shearY: { scale: 0.2 }, rotate: { scale: -1 } } },
        x: { offset: 20, to: { rotate: { scale: 2 } } },
        y: { to: { y: { scale: -1, offset: 8 }, scaleX: { scale: 0.01, offset: 1 } } },
        scaleX: { offset: 1, to: { scaleY: { scale: 1.5, offset: 0.5 } } },
        shearY: { to: { x: { scale: 0.3 } } },
        // feeds nothing: the official reader drops it
        scaleY: { offset: 2 },
    };
    // the second range runs down: its offset is above its max
    const ranges = {
        rotate: { to: { rotate: { offset: -30, max: 30 }, y: { offset: 5, max: 25, scale: 0.2 } } },
        x: { to: { x: { offset: 50, max: -50, scale: 2 } } },
        scaleX: { to: { scaleX: { offset: 0.5, max: 1.5 }, shearY: { offset: -20, max: 20, scale: 30 } } },
        scaleY: { to: { scaleY: { offset: 1.2, max: 0.6 } } },
    };

    return [
        constraint43('full', b(1), 'src', same(), OFFSETS),
        constraint43('part', b(2, 3), 'src', same(), { ...OFFSETS, ...PART }),
        constraint43('flip', b(4), 'mirror', same(), { rotation: 30, shearY: -20, ...PART, mixRotate: 0.8, mixX: 0.8 }),
        constraint43('rel', b(5), 'src', same(), { ...additive, ...OFFSETS }),
        constraint43('relPart', b(6, 7), 'mirror', same(), { ...additive, ...OFFSETS, ...PART }),
        constraint43('local', b(8), 'src', same(), { ...local, ...OFFSETS }),
        constraint43('localPart', b(9, 10), 'deep', same(), { ...local, ...OFFSETS, ...PART }),
        constraint43('localRel', b(11), 'src', same(), { ...local, ...additive, ...OFFSETS }),
        constraint43('localRelPart', b(12), 'mirror', same(), { ...local, ...additive, ...OFFSETS, ...PART }),
        constraint43('move', b(13), 'src', same(['x', 'y']), { mixY: 0.5 }),
        constraint43('turn', b(14), 'mirror', same(['rotate'])),
        constraint43('size', b(15), 'src', same(['scaleX', 'scaleY']), { ...additive, mixScaleY: 0.7, scaleX: 0.2 }),
        constraint43('slant', b(16), 'mirror', same(['shearY']), { ...additive, shearY: 15 }),
        constraint43('zero', b(17), 'src', same(), { ...OFFSETS, ...NONE }),
        constraint43('minus', b(18), 'src', same(), { ...OFFSETS, ...MINUS }),
        constraint43('minusRel', b(19), 'src', same(), { ...additive, ...OFFSETS, ...MINUS }),
        constraint43('minusLocal', b(20), 'src', same(), { ...local, ...OFFSETS, ...MINUS }),
        constraint43('skinned', b(21), 'src', same(), { ...additive, skin: true, x: 10 }),
        constraint43('skinSource', b(22), 'st', same()),
        constraint43('twiceTurn', b(23), 'src', same(['rotate']), { mixRotate: 0.7, rotation: -15 }),
        constraint43('twiceMove', b(23), 'mirror', same(['x', 'y']), { ...additive, mixX: 0.5, mixY: 0.5, x: 4, y: 4 }),
        ...MODES.map((_, i) =>
            constraint43(`mode${i}`, [`w${i}`], 'src', same(), { ...OFFSETS, ...PART, mixRotate: 1 }),
        ),
        ...MODES.map((_, i) => constraint43(`read${i}`, [`f${i}`], `w${i}`, same(), { ...local, rotation: 5 })),
        ...MODES.map((_, i) => constraint43(`again${i}`, [`w${i}`], 'mirror', same(), { ...additive, ...PART })),
        constraint43('hubTurn', ['hub'], 'src', same(['rotate', 'x']), { mixRotate: 0.3, mixX: 0.1 }),
        constraint43('chain', b(24, 25), 'b1', same(), { ...local, ...additive, mixRotate: 0.5 }),
        constraint43('chainWorld', b(26), 'b8', same(), { x: 6 }),
        constraint43('after', b(1, 3), 'deep', same(['rotate', 'scaleX']), {
            ...local,
            ...additive,
            mixRotate: 0.5,
            mixScaleX: 0.5,
        }),
        // what only 4.3 has
        constraint43('localToWorld', b(27), 'src', same(), { localSource: true, ...OFFSETS, ...PART }),
        constraint43('worldToLocal', b(28), 'deep', same(), { localTarget: true, ...OFFSETS }),
        constraint43('cross', b(29), 'src', cross, { x: 3, mixY: 0.8, mixScaleX: 0.5 }),
        constraint43('crossLocal', b(30), 'deep', cross, { ...local, ...additive, mixShearY: 0.6 }),
        constraint43('clamp', b(27), 'mirror', ranges, { clamp: true, mixRotate: 0.9 }),
        constraint43('clampLocal', b(28), 'src', ranges, { ...local, ...additive, clamp: true, mixX: 0.4 }),
    ];
}

/** The sources turn past half a turn, shrink through zero and flip, and the mixes are keyed. */
function drive(): Json {
    const k = (values: number[]): Json[] => keys(values, 2);
    const xy = (points: number[]): Json[] => keysXY(points, 2);
    // six mixes for each key
    const mix = (values: number[]): Json[] => keysOf(MIXES, values, 2);
    const src = {
        rotate: k([0, 150, 400, -230]),
        translate: xy([0, 0, 30, -20, -45, 15]),
        scale: xy([1, 1, 1.5, -0.8, -0.6, 1.2, 0.4, 0.4]),
        shear: xy([0, 0, 25, -30, -10, 40]),
    };

    return {
        bones: {
            src,
            mirror: { rotate: k([0, -190, 75]), scale: xy([1, 1, 0.7, -1, 1.3, 1.3]) },
            deep: { rotate: k([0, 90, -45]), translate: xy([0, 0, -12, 9]) },
            b2: { rotate: k([0, 170, -170]) },
            b9: { scale: xy([1, 1, 0.3, 2, -1, 1]) },
            w3: { rotate: k([0, 60]), scale: xy([1, 1, -1.2, 0.8]) },
        },
        transform: {
            full: mix([1, 1, 1, 1, 1, 1, 0.2, 0.6, 0, 1, 0.5, 0.8, 0, 0, 0, 0, 0, 0, 1, 0.3, 0.9, 0.1, 0.7, 0.4]),
            zero: mix([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0.5, 0, 0, 0, 0]),
            local: mix([1, 1, 1, 1, 1, 1, 0.5, 0, 0.5, 2, 0.5, -0.5, 0, 1, 0, 0, 1, 1]),
            localRelPart: mix([0.5, 0.25, 0.75, 0.6, 0.4, 0.5, 1, 1, 1, 1, 1, 1]),
            skinned: mix([1, 1, 1, 1, 1, 1, 0, 0.5, 1, 0.5, 0, 0.5]),
            mode2: mix([1, 0.25, 0.75, 0.6, 0.4, 0.5, 0, 1, 1, 0, 0, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
        },
    };
}

/** Other keys on some of the same values, so that mixes hold and release. */
function other(version: SpineVersion): Json {
    const k = (values: number[]): Json[] => keys(values, 1.3);
    const xy = (points: number[]): Json[] => keysXY(points, 1.3);
    const mix = (values: number[]): Json[] => keysOf(MIXES, values, 1.3);
    const mode = [{ inherit: 'noScale' }, { time: 0.5, inherit: 'normal' }, { time: 0.9, inherit: 'onlyTranslation' }];

    return {
        bones: {
            src: { rotate: k([40, -80]), scale: xy([1.2, 1, 1, -1.4]) },
            mirror: { translate: xy([0, 0, 25, 25, -25, 10]), shear: xy([0, 0, 0, 35]) },
            holder: { rotate: k([0, 45, -45]), scale: xy([1, 1, 1.3, 0.7, -1, 1]) },
            hub: { rotate: k([0, -60]) },
            root: { scale: xy([1, 1, 0.8, 1.2]) },
            b8: { rotate: k([0, 200]), translate: xy([0, 0, 9, 9]) },
            // mirrored and sheared far while they are constrained
            w3: { scale: xy([1, 1, 1, -1.3, -1, 1]), shear: xy([0, 0, 0, 140, 50, -100]) },
            w4: { scale: xy([1, 1, 1.2, -0.7]), shear: xy([0, 0, 0, 120, 0, -150]) },
            // the mode of a constrained bone changes while it is constrained
            ...(version === '4.1' ? {} : { w0: { inherit: mode }, b4: { inherit: mode } }),
        },
        transform: {
            full: mix([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 0, 1, 0, 1, 0]),
            part: mix([0.5, 0.25, 0.75, 0.6, 0.4, 0.5, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1]),
            rel: mix([1, 1, 1, 1, 1, 1, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]),
            localRel: mix([1, 1, 1, 1, 1, 1, 0, 0.4, 0.8, 1.2, 0.6, 0.2]),
            chain: mix([0.5, 1, 1, 1, 1, 1, 1, 0, 0, 0.5, 0.5, 0]),
            read1: mix([1, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
        },
    };
}

function parts(version: SpineVersion): RigParts {
    return {
        bones: bones(version),
        slots: [{ name: 's', bone: 'root' }],
        constraints: constraintLists(version, version === '4.3' ? list43() : legacyList()),
        skins: [
            { name: 'default' },
            { name: 'gear', bones: ['st'], transform: ['skinned'] },
            { name: 'half', transform: ['skinned'] },
        ],
        animations: {
            drive: drive(),
            other: other(version),
            wake: wakeTransform(),
            // one key at time 0: an animation without a length
            still: {
                bones: { src: { rotate: [{ value: -60 }], scale: [{ x: 0.8, y: 1.6 }] } },
                transform: { full: [{ mixRotate: 0.4, mixX: 0.4, mixScaleX: 0.4, mixShearY: 0.4 }], zero: [{}] },
            },
        },
    };
}

/** The transform constraint rig, once for each version. */
export const transformRigs = () => madeRig('made-transform', parts);
