import { describe, expect, it } from 'vitest';
import { isNewer, touchPose, WORLD_STRIDE } from '../../src/core';
import { createPair, differences, NO_REGIONS, type Pair, playBoth, updateBoth } from './v43-pair';

/*
 * Work that follows change in the 4.3 engine: stamps that say what changed, an update that
 * changes nothing and costs nothing, and what wakes a skeleton that rests. After every step the
 * pose is that of the official core, bit for bit.
 */

type Json = Record<string, unknown>;

const PATH: Json = { type: 'path', lengths: [10, 20], vertexCount: 6, vertices: [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
const STILL = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
const turn = (to: number): Json[] => [{ value: 0 }, { time: 0.5, value: to }, { time: 1, value: 0 }];

/* A hip with a leg of three bones, an arm with a hand, and eight bones that no animation of the first kind moves. */
const RIG: Json = {
    skeleton: { spine: '4.3.39-beta' },
    bones: [
        { name: 'root', rotation: 3 },
        { name: 'hip', parent: 'root', x: 5, y: 40, rotation: 10 },
        { name: 'l1', parent: 'hip', x: 10, length: 20, rotation: -80 },
        { name: 'l2', parent: 'l1', x: 20, length: 20, rotation: 15 },
        { name: 'l3', parent: 'l2', x: 20, length: 8, rotation: 70 },
        { name: 'arm', parent: 'root', x: 30, y: 60, length: 25, rotation: 30 },
        { name: 'hand', parent: 'arm', x: 25, length: 6, scaleX: 1.2 },
        ...STILL.map((name, i) => ({ name, parent: 'root', x: 12 * i, y: -20, rotation: 7 * i })),
    ],
    slots: [
        { name: 'body', bone: 'hip', color: 'ff8040ff', attachment: 'p0' },
        { name: 'glove', bone: 'hand', attachment: 'p0' },
        { name: 'prop', bone: 's1' },
    ],
    skins: [{ name: 'default', attachments: { body: { p0: PATH }, glove: { p0: PATH } } }],
    animations: {
        few: { bones: { hand: { rotate: turn(40) } } },
        all: {
            bones: {
                root: { rotate: turn(20) },
                arm: { rotate: turn(-30) },
            },
            slots: { body: { rgba: [{ color: 'ff8040ff' }, { time: 1, color: '2040ffff' }] } },
        },
        hold: {
            bones: { hand: { rotate: turn(25) } },
            attachments: {
                default: {
                    body: {
                        p0: {
                            deform: [
                                { vertices: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], curve: 'stepped' },
                                { time: 1, vertices: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
                            ],
                        },
                    },
                },
            },
            drawOrder: [{ offsets: [{ slot: 'body', offset: 2 }] }, { time: 1 }],
        },
    },
};
const TEXT = JSON.stringify(RIG);
const [FEW, ALL, HOLD] = [0, 1, 2];
const [HAND, FIRST_STILL] = [6, 7];
const DT = 1 / 32;

/** One update on both sides. Returns the bones and the slots whose stamps moved, and fails where the poses differ. */
function step(pair: Pair, dt = DT): { bones: number[]; slots: number[]; order: boolean; moved: boolean } {
    const { state } = pair.engine;
    const seen = state.version;
    const world = Array.from(state.world);

    updateBoth(pair, dt);
    expect(differences(pair, 'after an update')).toEqual([]);
    const bones = Array.from(state.boneStamps.keys()).filter((bone) => isNewer(Number(state.boneStamps[bone]), seen));
    const slots = Array.from(state.slotStamps.keys()).filter((slot) => isNewer(Number(state.slotStamps[slot]), seen));

    // a world transform never changes without its stamp, and no stamp is ahead of the version
    state.world.forEach((value, i) => {
        if (!Object.is(value, world[i])) expect(bones).toContain(Math.floor(i / WORLD_STRIDE));
    });
    for (const stamp of state.boneStamps) expect(isNewer(stamp, state.version)).toBe(false);

    return { bones, slots, order: isNewer(state.drawOrderStamp, seen), moved: state.version !== seen };
}

const start = (): Promise<Pair> => createPair({ skeleton: TEXT, atlas: NO_REGIONS });

/** Plays an animation once on both sides and runs past its end, until the engine has seen that the pose rests. */
async function rested(animation: number): Promise<Pair> {
    const pair = await start();

    playBoth(pair, 0, animation, false);
    for (let i = 0; i < 40; i++) step(pair);
    pair.engine.takeEvents();

    return pair;
}

describe('an update of the 4.3 engine that changes nothing', () => {
    it('leaves the version and every stamp alone, with no animation and after the end of one', async () => {
        const idle = await start();

        step(idle);
        step(idle);
        for (let i = 0; i < 5; i++) expect(step(idle).moved).toBe(false);
        const pair = await rested(ALL);

        for (let i = 0; i < 70; i++) expect(step(pair)).toEqual({ bones: [], slots: [], order: false, moved: false });
        expect(pair.engine.state.time).toBe(pair.skeleton.time);
    });

    it('fires the complete of an entry once, and of a looping entry without a length in every update', async () => {
        const pair = await start();
        const types = (): string[] => pair.engine.takeEvents().map((event) => event.type);

        playBoth(pair, 0, FEW, false);
        step(pair);
        expect(types()).toEqual(['start']);
        for (let i = 0; i < 31; i++) step(pair);
        expect(types()).toEqual(['complete']);
        for (let i = 0; i < 10; i++) step(pair);
        expect(types()).toEqual([]);
    });

    it('goes on from where it was when the track goes on', async () => {
        const pair = await rested(FEW);
        const { mine, theirs } = playBoth(pair, 0, ALL, true);

        pair.engine.configure(mine, { mixDuration: 0.25 });
        theirs.mixDuration = 0.25;
        for (let i = 0; i < 20; i++) step(pair);
        expect(step(pair).moved).toBe(true);
        pair.engine.clearTracks();
        pair.state.clearTracks();
        for (let i = 0; i < 4; i++) step(pair);
        expect(step(pair).moved).toBe(false);
    });
});

describe('what wakes a 4.3 skeleton that rests', () => {
    it('is a new place, which moves every bone', async () => {
        const pair = await rested(ALL);

        Object.assign(pair.engine.state, { x: 12.5, scaleX: -1.5 });
        Object.assign(pair.skeleton, { x: 12.5, scaleX: -1.5 });
        expect(step(pair).bones.length).toBe(pair.engine.state.boneStamps.length);
        step(pair);
        expect(step(pair).moved).toBe(false);
    });

    it('is a setup pose call, for the bones and for the slots', async () => {
        const pair = await rested(HOLD);
        const { state } = pair.engine;
        const seen = state.version;

        pair.engine.setupPoseSlots();
        pair.skeleton.setupPoseSlots();
        expect(differences(pair, 'after the setup pose of the slots')).toEqual([]);
        // the command stamps what it changed: the draw order and the deform went back
        expect(isNewer(state.drawOrderStamp, seen)).toBe(true);
        expect(isNewer(Number(state.slotStamps[0]), seen)).toBe(true);
        pair.engine.setupPoseBones();
        pair.skeleton.setupPoseBones();
        // the entry that rests is applied again, as the official one is in every update
        expect(step(pair).moved).toBe(true);
        step(pair);
        expect(step(pair).moved).toBe(false);
    });

    it('is a change of physics mode, a physics call or a force, although nothing moves here', async () => {
        const pair = await rested(FEW);

        pair.engine.physics = 'pose';
        pair.physics = 'pose';
        step(pair);
        pair.engine.physicsTranslate(3, 4);
        pair.skeleton.physicsTranslate(3, 4);
        step(pair);
        Object.assign(pair.engine.state, { windX: 0.5, gravityY: -1, yDown: true });
        Object.assign(pair.skeleton, { windX: 0.5, gravityY: -1 });
        step(pair);
        step(pair);
        expect(step(pair).moved).toBe(false);
    });

    it('is code that writes the pose state and raises its version', async () => {
        const pair = await rested(FEW);
        const { state } = pair.engine;
        const still = pair.skeleton.bones[FIRST_STILL];

        // a bone without a timeline keeps what was written, one with a timeline gets its key back
        state.local[FIRST_STILL * 7 + 2] = 55;
        state.local[HAND * 7 + 2] = 55;
        state.world[HAND * WORLD_STRIDE + 4] = 1000;
        state.drawOrder.reverse();
        touchPose(state);
        if (still) still.pose.rotation = 55;
        pair.skeleton.drawOrder.pose.reverse();
        const { bones } = step(pair);

        expect(bones).toContain(FIRST_STILL);
        expect(bones).toContain(HAND);
        step(pair);
        expect(step(pair).moved).toBe(false);
    });
});

describe('the stamps of the 4.3 engine while an animation plays', () => {
    it('are those of the bones that moved when few bones move', async () => {
        const pair = await start();

        playBoth(pair, 0, FEW, true);
        for (let i = 0; i < 5; i++) step(pair);
        for (let i = 0; i < 80; i++) {
            const { bones, slots } = step(pair);

            expect(bones.every((bone) => bone === HAND)).toBe(true);
            expect(slots).toEqual([]);
        }
    });

    it('are those of every bone while a large part of the skeleton moves, and tight again when it stops', async () => {
        const pair = await start();
        let loose = 0;

        playBoth(pair, 0, ALL, true);
        for (let i = 0; i < 100; i++) {
            const { bones, slots } = step(pair);

            if (bones.length === pair.engine.state.boneStamps.length) loose++;
            // the color of the one slot changes in every update, the other slots keep their stamps
            expect(slots.every((slot) => slot === 0)).toBe(true);
        }
        expect(loose).toBeGreaterThan(80);
        playBoth(pair, 0, FEW, true);
        for (let i = 0; i < 45; i++) step(pair);
        for (let i = 0; i < 40; i++) expect(step(pair).bones.every((bone) => bone === HAND)).toBe(true);
    });

    it('leave a deform and a draw order alone while their keys hold', async () => {
        const pair = await start();
        let slotStamps = 0;
        let orderStamps = 0;

        playBoth(pair, 0, HOLD, true);
        // three loops: each key of the deform and of the draw order comes into force once per loop
        for (let i = 0; i < 96; i++) {
            const { slots, order } = step(pair);

            if (slots.includes(0)) slotStamps++;
            if (order) orderStamps++;
        }
        expect(slotStamps).toBeGreaterThan(0);
        expect(slotStamps).toBeLessThanOrEqual(6);
        expect(orderStamps).toBeGreaterThan(0);
        expect(orderStamps).toBeLessThanOrEqual(6);
    });
});
