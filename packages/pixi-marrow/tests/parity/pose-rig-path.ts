import type { SpineVersion } from '../../src/core';
import {
    type Constraint,
    constraintLists,
    type Json,
    keys,
    keysOf,
    keysXY,
    madeRig,
    type PathBone,
    path,
    pathAttachment,
    type RigParts,
} from './pose-rig-kit';

/*
 * A rig made for path constraints. The official examples have a position in percent, spacing by
 * length and in percent, the rotate modes chain and chain scale, and paths with weights and
 * constant speed. This rig adds a fixed position, fixed and proportional spacing, the tangent
 * mode, a rotation offset, paths without weights, without constant speed, open and closed in every
 * mix of these, positions before the start and past the end, part mixes, a spacing of zero, bones
 * without a length, a slot on a mirrored bone, a slot whose path changes and goes away, a path
 * that a skin replaces, a path and a constraint that need a skin, deform keys on a path with and
 * without weights, and keys for position, spacing and the mixes.
 */

/** The knots of the paths: x, y of each. */
const OPEN = [-80, -20, -40, 30, 0, -10, 40, 35, 90, 0];
const OPEN_GEAR = [-80, 20, -20, -30, 30, 20, 90, -25];
const CLOSED = [-50, -50, 50, -50, 50, 50, -50, 50];
const SLOW = [-90, 10, -30, -40, 30, 45, 85, -15];
const SLOW_LOOP = [0, 60, 55, 0, 0, -60, -55, 0];
const HEAVY = [-70, -60, -20, -20, 25, -55, 75, -25];
const HEAVY_LOOP = [-30, 20, 30, 20, 30, 70, -30, 70];
const ONE = [-60, 0, 0, 40, 60, 0];
const TWO = [0, 0, 40, 0, 40, 40];
const RAIL = [-90, -80, 0, -60, 90, -80];

/** The bones a constraint places. Each is below the one before, or all are below the root. */
function chain(prefix: string, lengths: number[], x: number, y: number, siblings = false): Json[] {
    return lengths.map((length, i) => ({
        name: `${prefix}${i + 1}`,
        parent: siblings || i === 0 ? 'root' : `${prefix}${i}`,
        x: siblings || i === 0 ? x + i * 12 : (lengths[i - 1] ?? 0),
        y: siblings || i === 0 ? y : 0,
        rotation: i * 15 - 10,
        ...(length > 0 ? { length } : {}),
    }));
}

function bones(): Json[] {
    return [
        { name: 'root', rotation: 4, scaleX: 1.05 },
        { name: 'track', parent: 'root', x: 5, y: -5, rotation: 10 },
        // a mirrored bone: a rotation offset turns the other way
        { name: 'track2', parent: 'root', x: -10, y: 10, rotation: -20, scaleY: -1 },
        { name: 'wa', parent: 'root', x: -40, y: -40 },
        { name: 'wb', parent: 'root', x: 40, y: -40, rotation: 15, scaleX: 1.2 },
        ...chain('t', [20, 20, 20], -60, 60, true),
        // some bones have no length
        ...chain('c', [25, 25, 0], -20, 70),
        ...chain('s', [18, 22, 0, 16], 20, 70),
        ...chain('p', [20, 0, 30], 60, 70),
        ...chain('w', [15, 15, 15], -70, 90, true),
        ...chain('v', [30, 0, 20], -30, 90),
        ...chain('x', [20, 25, 15], 10, 90, true),
        ...chain('h', [22, 0, 22], 50, 90),
        ...chain('g', [30, 30], -80, -90),
        ...chain('r', [20, 20, 20], -40, -90),
        ...chain('q', [35, 35], 0, -90, true),
        ...chain('m', [25, 25], 40, -90),
        ...chain('n', [25, 25], 80, -90),
        ...chain('k', [20, 20, 20], -90, 0),
        ...chain('a', [30, 30], 90, 0),
        ...chain('e', [20, 20], -90, -30, true),
        ...chain('d', [20, 20], 90, -30),
        ...chain('o', [20, 20], 0, 0),
        ...chain('u', [40], 30, 30),
    ];
}

/** The slots, each with the path of its name. `swap` starts with `one`. The path of `rail` is in a skin only. */
function slots(): Json[] {
    const onTrack = ['open', 'closed', 'heavy', 'heavyLoop', 'rail'].map((name) => ({ name, bone: 'track' }));
    const onTrack2 = ['slow', 'slowLoop'].map((name) => ({ name, bone: 'track2' }));

    return [
        ...[...onTrack, ...onTrack2].map((slot) => ({ ...slot, attachment: slot.name })),
        { name: 'swap', bone: 'track', attachment: 'one' },
    ];
}

/** The three modes of a path constraint. An empty text is the default: tangent, percent, length. */
function modes(rotateMode: string, positionMode = '', spacingMode = ''): Json {
    const all = Object.entries({ rotateMode, positionMode, spacingMode });

    return Object.fromEntries(all.filter(([, mode]) => mode !== ''));
}

function constraints(version: SpineVersion): Constraint[] {
    const make = (name: string, prefix: string, count: number, slot: string, more: Json): Constraint => {
        const bones = Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`);

        return path(version, name, bones, slot, more);
    };
    const part = { mixRotate: 0.5, mixX: 0.3, mixY: 0.8 };

    return [
        // the defaults: tangent, position in percent, spacing by length
        make('tangent', 't', 3, 'open', { position: 0.1, spacing: 5 }),
        make('chain', 'c', 3, 'open', { ...modes('chain', 'fixed', 'fixed'), position: 20, spacing: 25 }),
        make('chainScale', 's', 4, 'open', { ...modes('chainScale', '', 'percent'), position: 0.05, spacing: 0.2 }),
        make('proportional', 'p', 3, 'closed', {
            ...modes('chainScale', '', 'proportional'),
            position: 0.3,
            spacing: 0.5,
        }),
        make('wrap', 'w', 3, 'closed', { ...modes('', 'fixed', 'percent'), position: 30, spacing: 0.4 }),
        make('slowChain', 'v', 3, 'slow', { ...modes('chain'), position: 0.2, spacing: 4 }),
        make('slowWrap', 'x', 3, 'slowLoop', {
            ...modes('', '', 'proportional'),
            position: 0.6,
            spacing: 0.3,
            rotation: 20,
        }),
        make('heavy', 'h', 3, 'heavy', { ...modes('chainScale', 'fixed'), position: 15 }),
        make('heavyWrap', 'g', 2, 'heavyLoop', { ...modes('chain', '', 'fixed'), position: 0.9, spacing: 45 }),
        // a rotation offset on a mirrored slot bone, which also keeps the chain from closing its gaps
        make('turned', 'r', 3, 'slow', {
            ...modes('chain', '', 'percent'),
            position: 0.1,
            spacing: 0.25,
            rotation: 30,
        }),
        make('part', 'q', 2, 'open', { position: 0.4, spacing: 10, rotation: -45, ...part }),
        // starts where the path starts
        make('moveOnly', 'm', 2, 'closed', { ...modes('chain'), mixRotate: 0 }),
        make('minus', 'n', 2, 'slowLoop', {
            ...modes('chainScale'),
            position: 0.2,
            spacing: 6,
            mixRotate: -0.5,
            mixX: 0.5,
        }),
        // no spacing: the bones share a point and take the direction of the path there
        make('together', 'k', 3, 'open', { ...modes('chain', '', 'fixed'), position: 0.5 }),
        make('swap', 'a', 2, 'swap', { ...modes('chain'), position: 0.25 }),
        make('skinned', 'e', 2, 'closed', { skin: true, position: 0.15, spacing: 8 }),
        make('rail', 'd', 2, 'rail', { ...modes('chainScale'), position: 0.3 }),
        // off in the setup pose, keyed on
        make('off', 'o', 2, 'slow', { ...modes('chain'), position: 0.5, mixRotate: 0, mixX: 0 }),
        make('single', 'u', 1, 'heavyLoop', { ...modes('chainScale', '', 'percent'), position: 0.4, spacing: 0.5 }),
    ];
}

function skins(all: Json[]): Json[] {
    const bones: PathBone[] = ['wa', 'wb'].map((name) => {
        const index = all.findIndex((bone) => bone.name === name);
        const bone = all[index];

        return { index, x: Number(bone?.x), y: Number(bone?.y) };
    });
    const box = { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 10, 0, 0, 10] };
    const slow = { constantSpeed: false };
    const closed = { closed: true };

    return [
        {
            name: 'default',
            attachments: {
                open: { open: pathAttachment(OPEN) },
                closed: { closed: pathAttachment(CLOSED, closed) },
                slow: { slow: pathAttachment(SLOW, slow) },
                slowLoop: { slowLoop: pathAttachment(SLOW_LOOP, { ...closed, ...slow }) },
                heavy: { heavy: pathAttachment(HEAVY, { bones }) },
                heavyLoop: { heavyLoop: pathAttachment(HEAVY_LOOP, { ...closed, ...slow, bones }) },
                swap: { one: pathAttachment(ONE), two: pathAttachment(TWO, closed), box },
            },
        },
        {
            name: 'gear',
            path: ['skinned'],
            attachments: { open: { open: pathAttachment(OPEN_GEAR, { bones }) }, rail: { rail: pathAttachment(RAIL) } },
        },
    ];
}

/** Deform keys for a path with `count` numbers: offsets for some of them, with a curve. */
function deform(duration: number, count: number): Json[] {
    const wave = (scale: number): number[] =>
        Array.from({ length: count }, (_, i) => Math.round(Math.sin(i * 1.7) * scale * 10) / 10);
    const curve = [duration * 0.5, 0.2, duration * 0.8, 1.4];

    return [
        { vertices: wave(6) },
        { time: duration * 0.4, offset: 2, vertices: wave(-14).slice(2, count - 2), curve },
        { time: duration * 0.9 },
        { time: duration, vertices: wave(6) },
    ];
}

/** The paths move, bend and swap, and the bones travel past both ends of them. */
function travel(): Json {
    const k = (values: number[]): Json[] => keys(values, 2);
    const xy = (points: number[]): Json[] => keysXY(points, 2);
    // mixRotate, mixX and mixY for each key
    const mix = (values: number[]): Json[] => keysOf(['mixRotate', 'mixX', 'mixY'], values, 2);
    const track = {
        rotate: k([0, 60, -45]),
        translate: xy([0, 0, 20, -15, -25, 10]),
        scale: xy([1, 1, 1.3, 0.7, -0.8, 1.1]),
    };
    const swaps = [
        { time: 0.3, name: 'two' },
        { time: 0.8, name: null },
        { time: 1.1, name: 'box' },
        { time: 1.5, name: 'one' },
    ];

    return {
        bones: {
            track,
            track2: { rotate: k([0, -90, 30]), scale: xy([1, 1, 1, -1, 0.6, 1.4]) },
            wa: { translate: xy([0, 0, -25, 30, 15, -10]), rotate: k([0, 120]) },
            wb: { translate: xy([0, 0, 10, 40]), scale: xy([1, 1, 0.5, 1.5]) },
            // the length of a bone on the path changes
            s1: { scale: xy([1, 1, 2, 1, -0.5, 1]) },
            p1: { scale: xy([1, 1, 0.4, 1.2]), rotate: k([0, 100]) },
        },
        slots: {
            swap: { attachment: swaps },
            closed: {
                attachment: [
                    { time: 1.2, name: null },
                    { time: 1.6, name: 'closed' },
                ],
            },
        },
        path: {
            // from before the start to past the end
            tangent: { position: k([0.1, -0.4, 0.5, 1.6]), spacing: k([5, 30, -10]) },
            chain: {
                position: k([20, -60, 150, 420]),
                spacing: k([25, 0, 60]),
                mix: mix([1, 1, 1, 0.5, 0.2, 0.9, 0, 1, 0]),
            },
            chainScale: { position: k([0.05, 0.6, -0.2]), spacing: k([0.2, 0.5, 0, -0.1]) },
            proportional: { position: k([0.3, 1.4, -0.8]), spacing: k([0.5, 1, 0.1]) },
            wrap: { position: k([30, 500, -200]) },
            slowChain: { position: k([0.2, 1.3, -0.3, 0.7]), mix: mix([1, 1, 1, 0.3, 1, 0.3]) },
            slowWrap: { position: k([0.6, -1.2, 2.5]) },
            heavy: { position: k([15, 200, -30]), spacing: k([0, 12]) },
            off: { mix: mix([0, 0, 0, 1, 1, 1, 0, 0.5, 1, -0.5, 1, 0]) },
            skinned: { position: k([0.15, 0.9]), mix: mix([1, 1, 1, 0, 0, 0]) },
        },
        attachments: {
            default: {
                open: { open: { deform: deform(2, OPEN.length * 3) } },
                // two bones for each of its numbers
                heavy: { heavy: { deform: deform(2, HEAVY.length * 6) } },
            },
        },
    };
}

/** Other keys on some of the same values, so that mixes hold and release. */
function other(): Json {
    const k = (values: number[]): Json[] => keys(values, 1.3);
    const xy = (points: number[]): Json[] => keysXY(points, 1.3);
    const mix = (values: number[]): Json[] => keysOf(['mixRotate', 'mixX', 'mixY'], values, 1.3);
    const part = { position: k([0.4, 0.9, 0]), spacing: k([10, 0, 25]), mix: mix([0.5, 0.3, 0.8, 1, 0, 0, 0, 1, 1]) };

    return {
        bones: {
            track: { rotate: k([20, -70]), shear: xy([0, 0, 20, -15]) },
            root: { scale: xy([1, 1, 1.2, 0.8, -1, 1]) },
            t2: { rotate: k([0, 180]), scale: xy([1, 1, 1.6, 1]) },
            c1: { translate: xy([0, 0, 30, 30]) },
            v1: { scale: xy([1, 1, 0, 1, 1.5, 1]) },
        },
        slots: { swap: { attachment: [{ name: 'two' }, { time: 0.6, name: 'one' }] } },
        path: {
            tangent: { position: k([0.8, 0.2]), mix: mix([1, 1, 1, 0.4, 0.4, 0.4]) },
            chain: { spacing: k([10, 40]) },
            part,
            together: { position: k([0.5, 0.1]), spacing: k([0, 15, 0]) },
            heavyWrap: { position: k([0.9, 0.1, 1.7]), spacing: k([45, 5]) },
            turned: { position: k([0.1, 0.8]), spacing: k([0.25, 0.05]) },
            minus: { mix: mix([-0.5, 0.5, 0.5, 0.5, -0.5, 1]) },
            single: { position: k([0.4, 1.4]) },
            swap: { position: k([0.25, 0.75]) },
            rail: { position: k([0.3, 0.6]), spacing: k([0, 20]) },
        },
        attachments: {
            default: { open: { open: { deform: deform(1.3, OPEN.length * 3).slice(1) } } },
            gear: {
                open: { open: { deform: deform(1.3, OPEN_GEAR.length * 6) } },
                rail: { rail: { deform: deform(1.3, RAIL.length * 3) } },
            },
        },
    };
}

function parts(version: SpineVersion): RigParts {
    const all = bones();
    const still = {
        bones: { track: { rotate: [{ value: 35 }] } },
        path: {
            tangent: { position: [{ value: 0.7 }] },
            chain: { spacing: [{ value: 12 }], mix: [{ mixRotate: 0.5 }] },
        },
    };

    return {
        bones: all,
        slots: slots(),
        constraints: constraintLists(version, constraints(version)),
        skins: skins(all),
        // `still` has one key at time 0: an animation without a length
        animations: { travel: travel(), other: other(), still },
    };
}

/** The path constraint rig, once for each version. */
export const pathRigs = () => madeRig('made-path', parts);
