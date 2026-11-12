import type { TrackFields } from '../../src/core';
import { DT, ODD, type PoseScript, type ScriptBuilder, script, thresholds } from './pose-script';
import { BONE_FIELDS, type PoseRigInfo } from './pose-shared';

/*
 * The random script: every kind of call in an order no hand-written script has, the calls for
 * physics, for the place and the y direction of the skeleton and for writes to bones among them. It is seeded, so a fixture gets the same
 * script on every run and on every machine.
 */

/** How many calls a random script makes before its closing updates. */
const CALLS = 70;
const STEPS = [1 / 60, DT, ODD, 0.05, 0.1, 0] as const;
const MIXES = [0, 0.1, 0.25, 0.4] as const;
const DELAYS = [0, 0, 0.2, 0.5, -0.1] as const;
/** `update` comes up most, so that physics runs most of the time. */
const MODES = ['update', 'update', 'update', 'pose', 'none', 'reset'] as const;
const PLACES = [-60, -7.5, 0, 0, 12, 90] as const;
const SCALES = [1, 1, -1, 0.6, -1.5, 2] as const;
const DIRECTIONS = [-1, 0, 0, 0.5, 1, 3] as const;
/** Values for a write to a bone, by the kind of its field. No scale of zero: the official core divides by it. */
const TURNS = [-170, -30, 15, 90, 400] as const;
const SHEARS = [-30, 0, 20] as const;

/** mulberry32, seeded with a hash of the text. */
function generator(seed: string): () => number {
    let state = 0x811c9dc5;

    for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 0x01000193);

    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** The dice of one script. */
interface Dice {
    chance(probability: number): boolean;
    below(count: number): number;
    of<T>(values: readonly [T, ...T[]]): T;
}

function dice(seed: string): Dice {
    const random = generator(seed);
    const below = (count: number): number => Math.floor(random() * count);

    return {
        chance: (probability) => random() < probability,
        below,
        of: (values) => values[below(values.length)] ?? values[0],
    };
}

/** Fields for a new entry: the common ones and the ones of the dialect of the rig. */
function randomFields(rig: PoseRigInfo, { chance, of }: Dice): TrackFields {
    const fields: TrackFields = {};

    if (chance(0.3)) fields.alpha = of([0.25, 0.5, 0.75, 1]);
    if (chance(0.2)) fields.timeScale = of([0, 0.5, 1.5, 2]);
    if (chance(0.15)) fields.reverse = true;
    if (chance(0.2)) fields.shortestRotation = true;
    if (chance(0.2)) fields.mixDuration = of([0, 0.1, 0.3]);
    if (chance(0.15)) Object.assign(fields, thresholds(rig, of([0.5, 1])));
    if (chance(0.1)) fields.trackEnd = of([0.2, 0.5, 1]);
    if (rig.version !== '4.1' && chance(0.1)) fields.alphaAttachmentThreshold = 0.5;
    if (rig.version === '4.3') {
        if (chance(0.15)) fields.additive = true;
        if (chance(0.1)) fields.keepHold = true;
    } else {
        if (chance(0.15)) fields.holdPrevious = true;
        if (chance(0.15)) fields.mixBlend = 'add';
    }

    return fields;
}

/** A write to one field of any bone of the rig, a bone that is not active or that a constraint writes among them. */
function writeBone(s: ScriptBuilder, rig: PoseRigInfo, { below, of }: Dice): void {
    const field = of(BONE_FIELDS);
    const value =
        field === 'rotation'
            ? of(TURNS)
            : field === 'x' || field === 'y'
              ? of(PLACES)
              : field === 'scaleX' || field === 'scaleY'
                ? of(SCALES)
                : of(SHEARS);

    s.bone(below(rig.bones), field, value);
}

/** A seeded script that mixes every kind of call on four tracks. */
export function randomScript(rig: PoseRigInfo, seed: string): PoseScript {
    const roll = dice(seed);
    const { below, chance, of } = roll;
    const animation = (): number => below(rig.animations.length);
    const track = (): number => below(4);
    const loop = (): boolean => chance(0.6);
    const fields = (): TrackFields => randomFields(rig, roll);

    return script(`random, seed ${seed}`, (s) => {
        // weight, call. The weights add up to 100.
        const calls: [number, () => void][] = [
            [35, () => s.update(of(STEPS), 1 + below(4))],
            [15, () => s.set(track(), animation(), loop(), fields())],
            [9, () => s.add(track(), animation(), loop(), of(DELAYS), fields())],
            [4, () => s.setEmpty(track(), of(MIXES))],
            [4, () => s.addEmpty(track(), of(MIXES), of(DELAYS))],
            [3, () => s.clearTrack(track())],
            [2, () => s.clearTracks()],
            [1, () => s.setupPose()],
            [1, () => s.setupPoseBones()],
            [1, () => s.setupPoseSlots()],
            [4, () => s.skin(below(rig.skins + 1) - 1)],
            [3, () => s.timeScale(of([0, 0.5, 1, 1, 2]))],
            [2, () => s.setMix(animation(), animation(), of(MIXES))],
            [2, () => s.defaultMix(of(MIXES))],
            [3, () => s.physics(of(MODES))],
            [2, () => s.physicsTranslate(of(PLACES), of(PLACES))],
            [2, () => s.physicsRotate(of(PLACES), of(PLACES), of([-200, -30, 15, 90]))],
            [2, () => s.place(of(PLACES), of(PLACES), of(SCALES), of(SCALES))],
            [1, () => s.forces(of(DIRECTIONS), of(DIRECTIONS), of(DIRECTIONS), of(DIRECTIONS))],
            [1, () => s.yDown(chance(0.6))],
            [3, () => writeBone(s, rig, roll)],
        ];

        s.defaultMix(of(MIXES));
        for (let i = 0; i < CALLS; i++) {
            let left = below(100);

            for (const [weight, call] of calls) {
                left -= weight;
                if (left < 0) {
                    call();
                    break;
                }
            }
        }
        s.timeScale(1);
        s.physics('update');
        s.update(DT, 6);
    });
}
