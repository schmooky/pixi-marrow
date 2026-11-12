import type { SpineVersion } from '../../src/core';
import {
    type Constraint,
    constraintLists,
    copy,
    ik,
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
import { longConstraints } from './pose-rig-long';
import { wakeOrder } from './pose-rig-wake';

/*
 * A rig made for the order of constraints: each one reads what the ones before it left. A
 * transform constraint moves the target of an IK chain. A path lies on a bone of that chain. An
 * IK constraint aims at a bone on the path. A local transform constraint reads the bone that IK
 * turned. Two constraints move one bone. A path with weights hangs on constrained bones. The root
 * bone is constrained last, so every bone is posed again from what its constraints left. Some
 * constraints, sources and slot bones need a skin.
 *
 * In 4.1 and 4.2 the lists are written last constraint first: the order numbers decide.
 *
 * 4.2 and 4.3 add a physics constraint in the middle, on a bone above bones that world
 * constraints moved before, and 4.3 adds two sliders. The bones below the physics bone are posed
 * again after it, and the sliders play an animation that keys the bones and the values of the
 * constraints before them.
 */

const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];

function bones(): Json[] {
    return [
        { name: 'root', rotation: 6 },
        { name: 'aim', parent: 'root', x: 50, y: 30, rotation: 20 },
        { name: 'hip', parent: 'root', rotation: 10, scaleX: 1.1 },
        { name: 'thigh', parent: 'hip', length: 40, rotation: -80 },
        { name: 'shin', parent: 'thigh', x: 40, length: 40, rotation: 20 },
        { name: 'foot', parent: 'shin', x: 40, length: 15, rotation: 60 },
        { name: 'ankle', parent: 'root', x: 10, y: -70 },
        { name: 'toe', parent: 'root', x: 30, y: -80, scaleY: 0.8 },
        { name: 'r1', parent: 'root', x: -30, y: -40, length: 20 },
        { name: 'r2', parent: 'r1', x: 20, length: 20 },
        { name: 'head', parent: 'hip', y: 50, length: 20, rotation: 90 },
        { name: 'arm', parent: 'hip', x: 10, y: 35, length: 30, rotation: -30 },
        { name: 'flag', parent: 'hip', x: -25, y: 20, length: 15, rotation: 140 },
        { name: 'flag2', parent: 'flag', x: 15, length: 15, rotation: 15, scaleX: 0.9 },
        { name: 't1', parent: 'hip', x: -10, y: -10, length: 18, rotation: 200 },
        { name: 't2', parent: 't1', x: 18, length: 18 },
        { name: 't3', parent: 't2', x: 18, length: 18 },
        { name: 'cape1', parent: 'hip', x: -5, y: 40, length: 25, rotation: 170, skin: true },
        { name: 'cape2', parent: 'cape1', x: 25, length: 25, rotation: -20, skin: true },
        { name: 'probe', parent: 'hip', x: 60, y: 10 },
        { name: 'probe2', parent: 'root', x: 70, y: -20 },
        { name: 'cp1', parent: 'root', x: -60, y: 60, length: 20 },
        { name: 'thigh2', parent: 'root', x: 45, y: -10, length: 30, rotation: -100, scaleX: 1.2, scaleY: 0.9 },
        { name: 'shin2', parent: 'thigh2', x: 30, length: 30, rotation: 30 },
    ];
}

function constraints(version: SpineVersion): Constraint[] {
    const part = { mixRotate: 0.5, mixX: 0.6, mixY: 0.6, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 };
    const sway: Constraint = {
        type: 'physics',
        name: 'sway',
        bone: 'hip',
        rotate: 1,
        x: 0.5,
        inertia: 0.5,
        damping: 0.85,
    };
    const slider = { type: 'slider', animation: 'slide' } as const;
    const knob: Constraint = { ...slider, name: 'knob', bone: 'aim', property: 'y', scale: 0.01, loop: true };
    const dial: Constraint = { ...slider, name: 'dial', time: 0.4, mix: 0.7, additive: true };
    const hang = { rotateMode: 'chainScale', spacingMode: 'percent', spacing: 0.3 };

    return [
        // the target of the leg follows `aim`
        copy(version, 'ankleFollow', { bones: ['ankle'], from: 'aim', ...part }),
        ik(version, 'leg', ['thigh', 'shin'], 'ankle', { bendPositive: false, softness: 5 }),
        // reads the end of the leg that IK placed
        copy(version, 'toeCopy', { bones: ['toe'], from: 'foot', x: 5, mixScaleX: 0.5 }),
        // the path lies on the shin
        path(version, 'ride', ['r1', 'r2'], 'rail', { rotateMode: 'chain', position: 0.2, spacing: 3 }),
        ik(version, 'lookAt', ['head'], 'r2', { stretch: true }),
        // reads the local pose IK left on the head, then IK turns the arm again
        copy(version, 'armCopy', { bones: ['arm'], from: 'head', local: true, rotation: -90, mixX: 0, mixY: 0 }),
        ik(version, 'armIk', ['arm'], 'aim', { mix: 0.5 }),
        copy(version, 'flagCopy', { bones: ['flag', 'flag2'], from: 'aim', ...part, mixX: 0.3, mixY: 0.3 }),
        // the bones below `hip` are posed again after it
        ...(version === '4.1' ? [] : [sway]),
        // the path hangs on `hip` and `flag`
        path(version, 'tail', ['t1', 't2', 't3'], 'line', hang),
        ik(version, 'capeIk', ['cape1', 'cape2'], 'aim', { skin: true }),
        // its source and the bone of its slot need a skin
        copy(version, 'capeCopy', { bones: ['probe2'], from: 'cape2', mixRotate: 0.8 }),
        path(version, 'capePath', ['cp1'], 'capeLine', { position: 0.5 }),
        ...(version === '4.3' ? [knob, dial] : []),
        // a target that an earlier constraint moved
        ik(version, 'late', ['thigh2', 'shin2'], 'toe', { stretch: true, uniform: true }),
        // the root turns last: every bone below it is posed again
        copy(version, 'rootTurn', { bones: ['root'], from: 'aim', ...part, mixRotate: 0.2, mixX: 0.1, mixY: 0 }),
        copy(version, 'readRoot', { bones: ['probe'], from: 'root', local: true, mixX: 0, mixY: 0, mixScaleX: 0.5 }),
    ];
}

function skins(all: Json[]): Json[] {
    const bones: PathBone[] = ['hip', 'flag'].map((name) => {
        const index = all.findIndex((bone) => bone.name === name);
        const bone = all[index];

        return { index, x: Number(bone?.x ?? 0), y: Number(bone?.y ?? 0) };
    });

    return [
        {
            name: 'default',
            attachments: {
                rail: { rail: pathAttachment([0, 0, 20, 25, 45, 10, 70, 30]) },
                line: { line: pathAttachment([-20, -10, -50, -30, -80, -10, -110, -35], { bones }) },
                capeLine: { capeLine: pathAttachment([0, 0, 30, 10, 60, 0], { constantSpeed: false }) },
            },
        },
        { name: 'caped', bones: ['cape1', 'cape2'], ik: ['capeIk'] },
        // the bones without the constraint
        { name: 'loose', bones: ['cape2'] },
    ];
}

/** Keys for the constraints not every version has: physics in 4.2 and 4.3, sliders in 4.3. */
function newerKeys(version: SpineVersion, k: (values: number[]) => Json[]): Json {
    const sway = {
        mix: k([1, 0.2, 0.8]),
        inertia: k([0.5, 0.9]),
        wind: k([0, 30, -20]),
        reset: [{ time: 0.5 }, { time: 1.4 }],
    };
    const slider = { dial: { time: k([0.4, 0.9, 0.1]), mix: k([0.7, 0, 1]) }, knob: { mix: k([1, 0.5]) } };

    if (version === '4.1') return {};

    // the timelines without a name are for every physics constraint
    return { physics: { sway, '': { gravity: k([0, 10]) } }, ...(version === '4.3' ? { slider } : {}) };
}

/** Every link of the chain of constraints moves, and the values of each are keyed. */
function main(version: SpineVersion): Json {
    const k = (values: number[]): Json[] => keys(values, 2);
    const xy = (points: number[]): Json[] => keysXY(points, 2);
    // six mixes for each key
    const mix = (values: number[]): Json[] => keysOf(MIXES, values, 2);
    const leg = keysOf(['mix', 'softness'], [1, 5, 0.3, 0, 1, 20], 2);
    const lookAt = keysOf(['mix', 'softness'], [1, 0, 0, 0, 0.6, 0], 2);
    const rail = [{ vertices: [0, 5, 0, -5, 3, 3] }, { time: 1, offset: 6, vertices: [10, -8, 4, 4] }, { time: 2 }];
    const ride = {
        position: k([0.2, 1.3, -0.2]),
        spacing: k([3, 20]),
        mix: keysOf(MIXES.slice(0, 3), [1, 1, 1, 0.5, 1, 0.5], 2),
    };

    return {
        bones: {
            aim: { translate: xy([0, 0, -90, -60, 20, 50, -40, -120]), rotate: k([0, 200, -100]) },
            hip: { rotate: k([0, 40, -30]), translate: xy([0, 0, 15, 10]) },
            thigh: { scale: xy([1, 1, 1.3, 0.8, 0.7, 1]) },
            ankle: { translate: xy([0, 0, 30, 40, -50, 0]) },
            cape1: { rotate: k([0, 60]) },
        },
        ik: {
            leg: leg.map((key, i) => ({ ...key, bendPositive: i % 2 === 1 })),
            lookAt: lookAt.map((key) => ({ ...key, stretch: true })),
        },
        transform: {
            ankleFollow: mix([0.5, 0.6, 0.6, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
            rootTurn: mix([0.2, 0.1, 0, 0, 0, 0, 0.6, 0, 0.2, 0, 0, 0]),
            armCopy: mix([1, 0, 0, 1, 1, 1, 0.4, 0, 0, 1, 0.5, 0]),
        },
        path: { ride, tail: { position: k([0, 0.4]) } },
        attachments: { default: { rail: { rail: { deform: rail } } } },
        ...newerKeys(version, k),
    };
}

/** The animation the sliders of 4.3 play. Every version has it as an animation of its own too. */
function slide(): Json {
    const k = (values: number[]): Json[] => keys(values, 1);
    const xy = (points: number[]): Json[] => keysXY(points, 1);
    const mix = (values: number[]): Json[] => keysOf(MIXES, values, 1);
    const ik = (values: number[]): Json[] => keysOf(['mix', 'softness'], values, 1);

    return {
        bones: {
            thigh: { rotate: k([0, 50, -30]) },
            flag: { translate: xy([0, 0, 20, 20]), scale: xy([1, 1, 1.5, 0.6]) },
            aim: { translate: xy([10, 10, 60, -40]) },
        },
        slots: {
            rail: {
                attachment: [
                    { time: 0.4, name: null },
                    { time: 0.7, name: 'rail' },
                ],
            },
        },
        ik: { leg: ik([0.2, 0, 1, 10]), armIk: ik([0.5, 0, 1, 0, 0, 0]) },
        transform: {
            flagCopy: mix([0.5, 0.3, 0.3, 0, 0, 0, 1, 1, 1, 0.5, 0.5, 0.5]),
            toeCopy: mix([1, 1, 1, 0.5, 1, 1, 0, 0.5, 0.5, 1, 0, 0]),
        },
        path: {
            ride: { position: k([0.6, 0.1]) },
            tail: { spacing: k([0.3, 0.1, 0.5]) },
            capePath: { position: k([0.5, 1.2, -0.3]) },
        },
    };
}

/** One key at time 0: an animation without a length. It keys what `main` keys, also for physics and a slider. */
function still(version: SpineVersion): Json {
    return {
        bones: { aim: { translate: [{ x: -70, y: -90 }] } },
        ik: { leg: [{ mix: 0.5, bendPositive: false }] },
        transform: { flagCopy: [{ mixRotate: 0, mixX: 1, mixScaleX: 0 }] },
        path: { ride: { position: [{ value: 0.8 }] } },
        ...(version === '4.1' ? {} : { physics: { sway: { mix: [{ value: 0.5 }], wind: [{ value: 5 }] } } }),
        ...(version === '4.3' ? { slider: { dial: { mix: [{ value: 0.2 }], time: [{ value: 0.6 }] } } } : {}),
    };
}

function parts(version: SpineVersion): RigParts {
    const all = bones();
    const slot = (name: string, bone: string): Json => ({ name, bone, attachment: name });

    return {
        bones: all,
        slots: [slot('rail', 'shin'), slot('line', 'hip'), slot('capeLine', 'cape1')],
        constraints: constraintLists(version, constraints(version), true),
        skins: skins(all),
        animations: {
            main: main(version),
            slide: slide(),
            long: longConstraints(version),
            wake: wakeOrder(version),
            still: still(version),
        },
    };
}

/** The rig for the order of constraints, once for each version. */
export const orderRigs = () => madeRig('made-order', parts);
