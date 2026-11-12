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
    physics,
    type RigParts,
} from './pose-rig-kit';
import { wakePhysicsOrder } from './pose-rig-wake';

/*
 * A rig made for physics among other constraints, for 4.2 and 4.3. Physics bones hang in a chain,
 * each below the one before. Others hang below bones that IK, a transform constraint and a path
 * constraint moved, or are such bones themselves. A physics bone is above the bone a transform
 * constraint moves later, so it is posed a second time. Then come the constraints that read
 * physics bones: a transform constraint in world and one in local space, IK that aims at one, and
 * a path that lies on one and is weighted to another. Two physics bones need a skin, two
 * constraints need a skin, and one bone has two physics constraints. Animations key and reset
 * these while no skin has them, by name and through the timelines for all constraints. The last two constraints are
 * on the bones above everything, one of them the bone without a parent.
 *
 * In 4.2 the lists are written last constraint first: the order numbers decide.
 */

const SOFT = { inertia: 0.5, damping: 0.85 };
const MIXES = ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'];
const ROPE = [1, 2, 3, 4, 5];

function bones(): Json[] {
    return [
        { name: 'root', rotation: 3 },
        { name: 'base', parent: 'root', length: 20, scaleX: 1.1 },
        // a chain of physics bones
        ...ROPE.map((n) => ({
            name: `rope${n}`,
            parent: n === 1 ? 'base' : `rope${n - 1}`,
            x: 20,
            length: 20,
            rotation: n === 1 ? -90 : 8,
            ...(n === 4 ? { scaleX: 0.8, shearY: 10 } : {}),
        })),
        // below an IK chain
        { name: 'target', parent: 'root', x: 90, y: 40 },
        { name: 'arm1', parent: 'base', x: -10, y: 30, length: 40, rotation: 30 },
        { name: 'arm2', parent: 'arm1', x: 40, length: 35, rotation: 40 },
        { name: 'hand', parent: 'arm2', x: 35, length: 15, scaleY: 0.9 },
        { name: 'finger', parent: 'hand', x: 15, length: 10, rotation: 20 },
        // below a transform constraint
        { name: 'src', parent: 'root', x: -60, y: 50, rotation: 30, scaleX: 1.2 },
        { name: 'follower', parent: 'root', x: -60, y: -20, length: 20 },
        { name: 'tail', parent: 'follower', x: 20, length: 25, rotation: -30 },
        { name: 'tailTip', parent: 'tail', x: 25, rotation: 10 },
        { name: 'early', parent: 'follower', x: 5, y: 10, length: 12, rotation: 80 },
        { name: 'earlyTip', parent: 'early', x: 12 },
        // below a path constraint
        { name: 'r1', parent: 'root', x: 40, y: -30, length: 20 },
        { name: 'r2', parent: 'r1', x: 20, length: 20 },
        { name: 'flag', parent: 'r2', x: 20, length: 18, rotation: 60 },
        // moved by the constraints that read physics bones
        { name: 'probe', parent: 'root', x: 70, y: -60 },
        { name: 'probeLocal', parent: 'root', x: 90, y: -60, scaleX: 0.9 },
        { name: 'aim', parent: 'root', y: -80, length: 30 },
        { name: 'h1', parent: 'root', x: -90, y: -80, length: 15 },
        { name: 'h2', parent: 'h1', x: 15, length: 15 },
        // need a skin
        { name: 'cape1', parent: 'base', x: -20, y: 20, length: 22, rotation: 150, skin: true },
        { name: 'cape2', parent: 'cape1', x: 22, length: 22, rotation: -15, skin: true },
        { name: 'pin', parent: 'base', x: 30, y: -20, length: 14, rotation: -60 },
    ];
}

function constraints(version: SpineVersion): Constraint[] {
    const part = { mixRotate: 0.8, mixX: 0.5, mixY: 0.5, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 };
    const turn = { rotate: 1, ...SOFT };

    return [
        // its parent moves later: the bone is posed again from what physics left
        physics(version, 'early', 'early', { ...turn, x: 1 }),
        copy(version, 'copy', { bones: ['follower'], from: 'src', ...part }),
        ik(version, 'reach', ['arm1', 'arm2'], 'target', { bendPositive: false }),
        // on a bone IK turned, then a chain of two below it
        physics(version, 'arm2', 'arm2', { rotate: 0.5, ...SOFT }),
        physics(version, 'hand', 'hand', { ...turn, x: 0.5, y: 0.5 }),
        physics(version, 'finger', 'finger', { ...turn, scaleX: 0.5 }),
        path(version, 'ride', ['r1', 'r2'], 'rail', { rotateMode: 'chain', position: 0.2, spacing: 5 }),
        physics(version, 'flag', 'flag', { ...turn, y: 0.6 }),
        // on the bone the transform constraint moved, then below it
        physics(version, 'drag', 'follower', { x: 0.6, y: 0.6, rotate: 0.4, ...SOFT }),
        physics(version, 'tail', 'tail', { ...turn, scaleX: 0.8, shearX: 0.3 }),
        ...ROPE.map((n) =>
            physics(version, `rope${n}`, `rope${n}`, {
                ...turn,
                inertia: 0.3 + n * 0.12,
                wind: n * 4,
                windGlobal: n % 2 === 1,
                gravityGlobal: true,
            }),
        ),
        // these read physics bones
        copy(version, 'readHand', { bones: ['probe'], from: 'hand', mixScaleX: 0.5, mixShearY: 0.5 }),
        copy(version, 'readFinger', { bones: ['probeLocal'], from: 'finger', local: true, mixX: 0, mixY: 0 }),
        ik(version, 'point', ['aim'], 'flag', { stretch: true }),
        path(version, 'hang', ['h1', 'h2'], 'line', { rotateMode: 'chainScale', spacingMode: 'percent', spacing: 0.4 }),
        // the bones need a skin. Without it the timelines for all constraints pass these two by.
        physics(version, 'cape1', 'cape1', { ...turn, gravityGlobal: true }),
        physics(version, 'cape2', 'cape2', { ...turn, x: 0.5, mixGlobal: true }),
        // the constraints need a skin. The second one is on a bone that has a physics constraint already.
        physics(version, 'gear', 'pin', { ...turn, skin: true, windGlobal: true }),
        physics(version, 'capeGear', 'cape2', { scaleX: 1, ...SOFT, skin: true }),
        // everything hangs below these two bones. The second has no parent.
        physics(version, 'sway', 'base', { rotate: 0.3, x: 0.2, ...SOFT, strength: 60 }),
        physics(version, 'ground', 'root', { rotate: 0.1, y: 0.2, scaleX: 0.1, ...SOFT }),
    ];
}

function skins(all: Json[]): Json[] {
    // the path that hangs is weighted to a physics bone and to a bone a path constraint placed
    const weights: PathBone[] = ['tail', 'r2'].map((name) => ({
        index: all.findIndex((bone) => bone.name === name),
        x: 0,
        y: 0,
    }));

    return [
        {
            name: 'default',
            attachments: {
                rail: { rail: pathAttachment([0, 0, 30, 25, 60, -10, 95, 20]) },
                line: { line: pathAttachment([0, 0, 25, 15, 50, -5], { bones: weights }) },
            },
        },
        { name: 'caped', bones: ['cape1', 'cape2'] },
        { name: 'geared', physics: ['gear'] },
        // the bone list names the lower bone only: its parent comes with it
        { name: 'full', bones: ['cape2'], physics: ['gear', 'capeGear'] },
    ];
}

/** Every link moves: the base, the IK target, the source of the transform constraint and the place on the path. */
function swing(): Json {
    const k = (values: number[]): Json[] => keys(values, 2);
    const xy = (points: number[]): Json[] => keysXY(points, 2);

    return {
        bones: {
            base: { translate: xy([0, 0, 60, 30, -50, 45, 20, -40]), rotate: k([0, 50, -70]) },
            target: { translate: xy([0, 0, -120, -30, 30, 60]) },
            src: { rotate: k([0, 160, -90]), translate: xy([0, 0, 40, -50]), scale: xy([1, 1, 1.5, 0.7]) },
            rope1: { rotate: k([0, 35, -35]) },
            cape1: { rotate: k([0, 70]) },
            pin: { translate: xy([0, 0, 15, 15]) },
        },
        ik: { reach: keysOf(['mix', 'softness'], [1, 0, 0.3, 10, 1, 0], 2) },
        transform: { copy: keysOf(MIXES, [0.8, 0.5, 0.5, 0, 0, 0, 0, 1, 1, 0.5, 0.5, 0, 1, 0, 0, 0, 0, 0.5], 2) },
        path: { ride: { position: k([0.2, 0.9, -0.1]) }, hang: { spacing: k([0.4, 0.1]) } },
        physics: {
            rope3: { wind: k([12, -40, 30]) },
            arm2: { mix: k([1, 0, 0.5]) },
            sway: { inertia: k([0.5, 1]) },
        },
    };
}

/** Jumps of the base, physics bones that move themselves, and resets of one constraint and of all. */
function whip(): Json {
    const k = (values: number[]): Json[] => keys(values, 1);
    const xy = (points: number[]): Json[] => keysXY(points, 1);
    const stepped = { curve: 'stepped' };

    return {
        bones: {
            base: {
                translate: [
                    stepped,
                    { time: 0.3, x: 260, y: -180, ...stepped },
                    { time: 0.6, x: -200, y: 90 },
                    { time: 1 },
                ],
                rotate: k([0, -140, 100]),
            },
            target: { translate: xy([0, 0, 40, -90]) },
            hand: { rotate: k([0, 80]) },
            tail: { translate: xy([0, 0, 10, 20]), scale: xy([1, 1, 1.4, 0.8]) },
            cape2: { rotate: k([0, -60, 40]) },
            follower: { rotate: k([0, 90]) },
        },
        physics: {
            '': { reset: [{}, { time: 1 }], gravity: k([0, 30]), mix: k([1, 0.6]), wind: k([0, 18]) },
            hand: { reset: [{ time: 0.5 }] },
            // these three are not active without a skin: their keys and their resets change nothing then
            cape1: { reset: [{ time: 0.7 }] },
            cape2: { strength: k([100, 20]) },
            gear: { mix: k([1, 0.2]), wind: k([0, -25]), reset: [{ time: 0.4 }] },
        },
    };
}

/** One key at time 0: an animation without a length. */
function still(): Json {
    return {
        bones: { base: { rotate: [{ value: 30 }] }, target: { translate: [{ x: -40, y: 20 }] } },
        ik: { reach: [{ mix: 0.5 }] },
        physics: { tail: { mix: [{ value: 0.4 }] }, '': { wind: [{ value: 20 }] } },
    };
}

function parts(version: SpineVersion): RigParts {
    const all = bones();
    const slot = (name: string, bone: string): Json => ({ name, bone, attachment: name });

    return {
        bones: all,
        slots: [slot('rail', 'base'), slot('line', 'tail')],
        constraints: constraintLists(version, constraints(version), true),
        skins: skins(all),
        animations: { swing: swing(), whip: whip(), wake: wakePhysicsOrder(), still: still() },
    };
}

/** The rig for physics among other constraints, for the two versions that have physics. */
export const physicsOrderRigs = () => madeRig('made-physics-order', parts, ['4.2', '4.3']);
