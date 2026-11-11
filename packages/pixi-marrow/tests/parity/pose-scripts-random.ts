import type { TrackFields } from '../../src/core';
import { DT, ODD, type PoseScript, script, thresholds } from './pose-script';
import type { PoseRigInfo } from './pose-shared';

/*
 * The random script: every kind of call in an order no hand-written script has. It is seeded, so
 * a fixture gets the same script on every run and on every machine.
 */

/** How many calls a random script makes before its closing updates. */
const CALLS = 70;
const STEPS = [1 / 60, DT, ODD, 0.05, 0.1, 0] as const;
const MIXES = [0, 0.1, 0.25, 0.4] as const;
const DELAYS = [0, 0, 0.2, 0.5, -0.1] as const;

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
            [40, () => s.update(of(STEPS), 1 + below(4))],
            [18, () => s.set(track(), animation(), loop(), fields())],
            [10, () => s.add(track(), animation(), loop(), of(DELAYS), fields())],
            [5, () => s.setEmpty(track(), of(MIXES))],
            [5, () => s.addEmpty(track(), of(MIXES), of(DELAYS))],
            [4, () => s.clearTrack(track())],
            [2, () => s.clearTracks()],
            [1, () => s.setupPose()],
            [1, () => s.setupPoseBones()],
            [1, () => s.setupPoseSlots()],
            [4, () => s.skin(below(rig.skins + 1) - 1)],
            [3, () => s.timeScale(of([0, 0.5, 1, 1, 2]))],
            [3, () => s.setMix(animation(), animation(), of(MIXES))],
            [3, () => s.defaultMix(of(MIXES))],
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
        s.update(DT, 6);
    });
}
