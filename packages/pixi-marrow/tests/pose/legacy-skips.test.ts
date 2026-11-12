import { describe, expect, it } from 'vitest';
import {
    createPoseEngine,
    importSkeleton,
    type PoseEngine,
    type SkeletonModel,
    touchPose,
    WORLD_STRIDE,
} from '../../src/core';
import { cacheOf } from '../../src/pose/legacy/cache';
import { rigOf } from '../../src/pose/legacy/rig';
import { loadPoseRig } from '../parity/pose-official';
import { attachmentLabels, engineSubject, runScript } from '../parity/pose-run';
import { SCRIPT_FAMILIES } from '../parity/pose-scripts';
import { listPoseRigs } from '../parity/pose-synthetic';

/*
 * The work an update of the legacy engine leaves out: timelines that would leave the pose as it
 * is, world transforms of bones that nothing moved, groups of constraints that are at rest. The
 * engine can be told to leave nothing out, per model. Every script of the parity suite must give
 * the same pose, the same events and the same track entries both ways.
 *
 * Then what the stamps say: a skeleton at rest leaves its version alone, a bone that did not move
 * keeps its stamp, and a write from outside is seen.
 */

const DT = 1 / 30;

/** The rigs made for the parity suite, and official ones with every kind of constraint. */
const rigs = listPoseRigs().filter(
    ({ id, version }) =>
        version !== '4.3' &&
        (id.includes('/made-') ||
            /^4\.2\/(spineboy-pro|raptor-pro|celestial-circus-pro|cloud-pot|stretchyman-pro|tank-pro|hero-pro|mix-and-match-pro)\.json$/.test(
                id,
            ) ||
            /^4\.1\/(spineboy-pro|coin-pro)\.json$/.test(id)),
);

describe('the work the legacy engine skips', () => {
    it('has rigs of both versions to compare on', () => {
        expect(rigs.filter(({ version }) => version === '4.1').length).toBeGreaterThan(4);
        expect(rigs.filter(({ version }) => version === '4.2').length).toBeGreaterThan(10);
    });

    it.each(rigs)('$id: every script poses the same with nothing skipped', { timeout: 60_000 }, async (source) => {
        const files = source.read();
        const info = loadPoseRig(source.version, files).info;
        // two models, so that one of them can have the skipping switched off
        const lean = await importSkeleton(files.skeleton);
        const full = await importSkeleton(files.skeleton);
        const leanLabels = attachmentLabels(lean);
        const fullLabels = attachmentLabels(full);
        let scripts = 0;

        rigOf(full).skips = false;
        for (const family of SCRIPT_FAMILIES) {
            for (const script of family.scripts(info, `${source.version}/${source.rig}`)) {
                const failure = runScript(
                    script,
                    engineSubject(await createPoseEngine(lean), leanLabels.ofObject),
                    engineSubject(await createPoseEngine(full), fullLabels.ofObject),
                );

                if (failure !== null) expect.fail(`${source.id}, ${family.name}, ${failure}`);
                scripts++;
            }
        }
        expect(scripts).toBeGreaterThan(20);
    });
});

/** A skeleton with two arms below a body, a slot on each bone, and animations that move all, one arm or nothing. */
function armsRig(version: '4.1' | '4.2'): string {
    const turn = (to: number) => [{ value: 0 }, { time: 0.5, value: to }, { time: 1, value: 0 }];
    const hold = (value: number) => [{ value }, { time: 0.5, value }, { time: 1, value }];

    return JSON.stringify({
        skeleton: { spine: `${version}.24` },
        bones: [
            { name: 'root' },
            { name: 'body', parent: 'root', y: 20, length: 30, rotation: 90 },
            { name: 'left', parent: 'body', x: 30, length: 20, rotation: 40 },
            { name: 'leftHand', parent: 'left', x: 20, length: 8 },
            { name: 'right', parent: 'body', x: 30, length: 20, rotation: -40 },
            { name: 'rightHand', parent: 'right', x: 20, length: 8 },
            { name: 'aim', parent: 'root', x: 60, y: 60 },
        ],
        slots: [
            { name: 'bodySlot', bone: 'body', attachment: 'img' },
            { name: 'leftSlot', bone: 'leftHand', attachment: 'img' },
            { name: 'rightSlot', bone: 'rightHand', attachment: 'img' },
        ],
        ik: [{ name: 'reach', order: 0, bones: ['right'], target: 'aim', mix: 0.5 }],
        skins: [
            {
                name: 'default',
                attachments: {
                    bodySlot: { img: { width: 8, height: 8 } },
                    leftSlot: { img: { width: 8, height: 8 } },
                    rightSlot: { img: { width: 8, height: 8 } },
                },
            },
        ],
        animations: {
            all: {
                bones: {
                    body: { rotate: turn(30) },
                    left: { rotate: turn(-50) },
                    aim: { translate: [{}, { time: 1, x: 30 }] },
                },
            },
            wave: {
                bones: { left: { rotate: turn(70) } },
                slots: { leftSlot: { rgba: [{ color: 'ffffffff' }, { time: 1, color: 'ff000080' }] } },
            },
            pose: { bones: { left: { rotate: hold(25) }, body: { translate: [{ x: 4, y: 2 }] } } },
        },
    });
}

const [ALL, WAVE, POSE] = [0, 1, 2];

/** A bone that only a skin poses, and an IK constraint that turns it whether or not the skin is worn. */
function unlistedRig(version: '4.1' | '4.2'): string {
    return JSON.stringify({
        skeleton: { spine: `${version}.24` },
        bones: [
            { name: 'root' },
            { name: 'aim', parent: 'root', x: 50, y: 20 },
            { name: 'arm', parent: 'root', length: 20, skin: true },
        ],
        ik: [{ name: 'reach', order: 0, bones: ['arm'], target: 'aim' }],
        skins: [{ name: 'default' }, { name: 'armed', bones: ['arm'] }],
        animations: { move: { bones: { aim: { translate: [{}, { time: 1, x: 30, y: 40 }] } } } },
    });
}

/** The bones and the slots whose stamp is the version of the pose: what the last change touched. */
function stamped(engine: PoseEngine): { bones: string[]; slots: string[] } {
    const { model, version, boneStamps, slotStamps } = engine.state;

    return {
        bones: model.bones.names.filter((_, i) => boneStamps[i] === version),
        slots: model.slots.names.filter((_, i) => slotStamps[i] === version),
    };
}

describe.each(['4.1', '4.2'] as const)('the stamps of the legacy engine on a %s skeleton', (version) => {
    const create = async (): Promise<{ model: SkeletonModel; engine: PoseEngine }> => {
        const model = await importSkeleton(armsRig(version));

        return { model, engine: await createPoseEngine(model) };
    };

    it('starts at version 1 with every stamp at 1', async () => {
        const { engine } = await create();
        const { version: at, boneStamps, slotStamps, drawOrderStamp } = engine.state;

        expect([at, drawOrderStamp, ...boneStamps, ...slotStamps].every((stamp) => stamp === 1)).toBe(true);
    });

    it('leaves the version alone once an animation has ended, and fires complete once', async () => {
        const { engine } = await create();

        engine.setAnimation(0, ALL, false);
        for (let i = 0; i < 40; i++) engine.update(DT);
        const completes = engine.takeEvents().filter(({ type }) => type === 'complete');
        const at = engine.state.version;
        const world = engine.state.world.slice();

        expect(completes).toHaveLength(1);
        for (let i = 0; i < 20; i++) engine.update(DT);
        expect(engine.state.version).toBe(at);
        expect(engine.state.world).toEqual(world);
        expect(engine.takeEvents()).toEqual([]);
        // the track times went on: a queued animation starts when the official one would
        engine.addAnimation(0, WAVE, true, 0);
        engine.update(DT);
        expect(engine.state.version).not.toBe(at);
        expect(engine.takeEvents().map(({ type }) => type)).toContain('start');
        // the update after the change of animations moves only what the new one keys
        engine.update(DT);
        expect(stamped(engine).bones).toEqual(['left', 'leftHand']);
    });

    it('leaves the version alone without tracks, with time standing still and for a pose that loops', async () => {
        const { engine } = await create();
        const rests = (updates: number, dt: number): boolean => {
            const at = engine.state.version;

            for (let i = 0; i < updates; i++) engine.update(dt);

            return engine.state.version === at;
        };

        engine.update(DT);
        engine.update(DT);
        expect(rests(10, DT)).toBe(true);
        engine.setAnimation(0, ALL, true);
        expect(rests(3, DT)).toBe(false);
        // the engine stands still, then one entry does
        engine.timeScale = 0;
        engine.update(DT);
        engine.update(DT);
        expect(rests(10, DT)).toBe(true);
        engine.timeScale = 1;
        expect(rests(3, DT)).toBe(false);
        // every timeline of this animation holds one value: once it is applied, its loops change nothing
        engine.setAnimation(0, POSE, true);
        for (let i = 0; i < 4; i++) engine.update(DT);
        engine.takeEvents();
        expect(rests(80, DT)).toBe(true);
        // the loops still complete, as they do in the official runtime
        expect(engine.takeEvents().map(({ type }) => type)).toEqual(['complete', 'complete']);
    });

    it('stamps only the bones and the slots that changed', async () => {
        const { engine } = await create();

        engine.setAnimation(0, WAVE, true);
        for (let i = 0; i < 5; i++) engine.update(DT);
        // the arm that waves and the bone below it, and the slot whose color is keyed
        expect(stamped(engine)).toEqual({ bones: ['left', 'leftHand'], slots: ['leftSlot'] });
        const body = engine.state.boneStamps[1];

        for (let i = 0; i < 10; i++) engine.update(DT);
        expect(engine.state.boneStamps[1]).toBe(body);
        // a second track moves the body and the target of the IK. Now most bones move in every update,
        // and the engine stops looking for those that do not: every bone is stamped
        engine.setAnimation(1, ALL, true);
        for (let i = 0; i < 4; i++) engine.update(DT);
        expect(stamped(engine).bones).toHaveLength(7);
        // back to the wave alone, the stamps are tight again within a few updates
        engine.setEmptyAnimation(1, 0);
        for (let i = 0; i < 6; i++) engine.update(DT);
        expect(stamped(engine)).toEqual({ bones: ['left', 'leftHand'], slots: ['leftSlot'] });
    });

    it('sees the skeleton placed and the pose written from outside', async () => {
        const { model, engine } = await create();
        const leftHand = model.bones.names.indexOf('leftHand') * WORLD_STRIDE;

        engine.update(DT);
        engine.update(DT);
        const at = engine.state.version;
        const x = Number(engine.state.world[leftHand + 4]);

        engine.state.x = 5;
        engine.update(DT);
        expect(engine.state.world[leftHand + 4]).toBeCloseTo(x + 5, 10);
        expect(engine.state.version).not.toBe(at);
        expect(stamped(engine).bones).toHaveLength(model.bones.count);
        // a write to the local pose is seen once the version says so
        engine.update(DT);
        const still = engine.state.version;

        engine.state.local[0] = 7;
        engine.update(DT);
        expect(engine.state.version).toBe(still);
        touchPose(engine.state);
        engine.update(DT);
        expect(engine.state.world[leftHand + 4]).toBeCloseTo(x + 5 + 7, 10);
    });

    it('stamps what a command changes when it is called', async () => {
        const { engine } = await create();

        engine.setAnimation(0, WAVE, false);
        for (let i = 0; i < 20; i++) engine.update(DT);
        const at = engine.state.version;

        engine.setupPoseSlots();
        expect(engine.state.version).not.toBe(at);
        expect(stamped(engine).slots).toEqual(['bodySlot', 'leftSlot', 'rightSlot']);
        expect(engine.state.drawOrderStamp).toBe(engine.state.version);
        const slots = engine.state.version;

        engine.setupPoseBones();
        // the bones move with the next update, not with the call
        expect(engine.state.version).toBe(slots);
        engine.clearTracks();
        engine.update(DT);
        expect(engine.state.version).not.toBe(slots);
        expect(stamped(engine).bones).toHaveLength(7);
    });

    it('stamps a bone that a constraint poses although no skin lists it', async () => {
        const model = await importSkeleton(unlistedRig(version));
        const engine = await createPoseEngine(model);
        const arm = model.bones.names.indexOf('arm');
        const { state } = engine;
        const worldOfArm = (): number[] =>
            Array.from(state.world.subarray(arm * WORLD_STRIDE, (arm + 1) * WORLD_STRIDE));

        expect(state.active[arm]).toBe(0);
        expect(Array.from(cacheOf(rigOf(model), -1).groups.unlisted)).toEqual([arm]);
        engine.setAnimation(0, 0, true);
        // the first updates look for what changed, the later ones compute everything: both stamp the bone
        for (let i = 0; i < 8; i++) {
            const before = worldOfArm();

            engine.update(DT);
            expect(worldOfArm()).not.toEqual(before);
            expect(state.boneStamps[arm]).toBe(state.version);
        }
        state.x = 3;
        engine.update(DT);
        expect(state.boneStamps[arm]).toBe(state.version);
    });

    it('groups a constraint with the bones it writes and leaves the others free', async () => {
        const { model } = await create();
        const { groups, entries } = cacheOf(rigOf(model), -1);
        const names = Array.from(
            entries,
            (entry, i) => `${entry < 0 ? 'reach' : model.bones.names[entry]}:${groups.of[i]}`,
        );

        // the bone the IK turns and the IK are one group, and the hand below it comes after
        expect(names).toEqual([
            'root:-1',
            'aim:-1',
            'body:-1',
            'right:0',
            'reach:0',
            'left:-1',
            'leftHand:-1',
            'rightHand:-1',
        ]);
        expect(groups.count).toBe(1);
    });
});
