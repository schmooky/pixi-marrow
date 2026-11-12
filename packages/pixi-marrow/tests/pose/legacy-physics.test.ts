import * as core42 from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import {
    createPoseEngine,
    importSkeleton,
    MarrowError,
    type PhysicsMode,
    type PoseEngine,
    poseStateBytes,
    type SkeletonModel,
    WORLD_STRIDE,
} from '../../src/core';
import { cacheOf } from '../../src/pose/legacy/cache';
import { createLegacyEngine } from '../../src/pose/legacy/index';
import { rigOf } from '../../src/pose/legacy/rig';
import { listFixtures, readFixture } from '../parity/fixtures';
import { loadPoseRig } from '../parity/pose-official';
import { attachmentLabels, engineSubject, officialSubject, runScript } from '../parity/pose-run';
import { DT, ODD, type PoseScript, script } from '../parity/pose-script';

/*
 * Physics constraints of the legacy engine, where the parity scripts do not reach: what the
 * engine refuses, the bytes of the physics state, the applied pose that is computed only for a
 * reader, a mass that is not the inverse of a number, constraints that are not active, and the y
 * axis that points down. The physics calls of the engine are in legacy-api.test.ts.
 */

type Json = Record<string, unknown>;

const ATLAS = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');
const SOFT = { inertia: 0.5, damping: 0.85 };
const MODES: readonly PhysicsMode[] = ['none', 'reset', 'update', 'pose'];

const wave = (a: number, b: number): Json[] => [{ value: a }, { time: 0.5, value: b }, { time: 1, value: a }];

/**
 * A 4.2 skeleton where something reads the applied pose of a physics bone after its constraint,
 * in each way the update order has: IK on the bone `b`, a local transform constraint that copies
 * from `d`, and `f`, which is posed again after the physics on its parent `g`. Nothing reads `a`,
 * `c` and `g`. The bone `h` and the constraint `pi` need a skin. `parts` picks the constraint kinds.
 *
 * The constraints differ in what they do: `pa` steps slower than the updates come and has a limit
 * that the moves hit, `pg` only stretches, `ph` only shears, and `pi` stretches a bone without a length.
 */
function readerRig(parts: { ik?: boolean; transform?: boolean; physics?: boolean } = {}): string {
    const { ik = true, transform = true, physics = true } = parts;

    return JSON.stringify({
        skeleton: { spine: '4.2.24' },
        bones: [
            { name: 'root', rotation: 5 },
            { name: 'aim', parent: 'root', x: 60, y: 30 },
            { name: 'a', parent: 'root', x: 10, length: 20, rotation: 20 },
            { name: 'b', parent: 'a', x: 20, length: 15, rotation: -10, scaleX: 1.1 },
            { name: 'c', parent: 'b', x: 15, length: 10, shearY: 6 },
            { name: 'd', parent: 'root', x: -20, y: 8, length: 12, rotation: 70 },
            { name: 'e', parent: 'root', x: -40, y: -6, rotation: -15 },
            { name: 'g', parent: 'root', x: 5, y: -30, length: 14, rotation: -80 },
            { name: 'f', parent: 'g', x: 14, length: 9, rotation: 25 },
            { name: 'h', parent: 'root', x: 30, y: -20, length: 11, skin: true },
            { name: 'i', parent: 'root', x: -5, y: 40, rotation: 100 },
        ],
        slots: [{ name: 'slot', bone: 'root' }],
        ik: ik ? [{ name: 'reach', order: 2, bones: ['b'], target: 'aim', mix: 0.5 }] : [],
        transform: transform
            ? [{ name: 'copy', order: 5, bones: ['e'], target: 'd', local: true, mixRotate: 0.6, mixX: 0.3 }]
            : [],
        physics: physics
            ? [
                  {
                      name: 'pa',
                      order: 0,
                      bone: 'a',
                      x: 1,
                      y: 0.6,
                      rotate: 1,
                      ...SOFT,
                      gravity: 8,
                      windGlobal: true,
                      fps: 15,
                      limit: 90,
                  },
                  { name: 'pb', order: 1, bone: 'b', rotate: 1, scaleX: 0.7, inertia: 0.6, damping: 0.8, wind: 5 },
                  { name: 'pc', order: 3, bone: 'c', rotate: 0.8, shearX: 0.5, inertia: 0.4, damping: 0.9, mass: 3 },
                  { name: 'pd', order: 4, bone: 'd', rotate: 1, x: 0.5, ...SOFT, windGlobal: true },
                  { name: 'pf', order: 6, bone: 'f', x: 1, y: 1, rotate: 1, inertia: 0.7, damping: 0.8, gravity: -6 },
                  { name: 'pg', order: 7, bone: 'g', scaleX: 1, ...SOFT, strength: 60, wind: 9 },
                  { name: 'ph', order: 8, bone: 'h', shearX: 1, y: 1, ...SOFT, windGlobal: true },
                  { name: 'pi', order: 9, bone: 'i', rotate: 1, x: 1, scaleX: 0.5, ...SOFT, skin: true },
              ]
            : [],
        skins: [{ name: 'default' }, { name: 'full', bones: ['h'], ...(physics ? { physics: ['pi'] } : {}) }],
        animations: {
            sway: {
                bones: {
                    root: {
                        translate: [{}, { time: 0.5, x: 40, y: -25 }, { time: 1 }],
                        rotate: wave(0, 50),
                    },
                    aim: { translate: [{}, { time: 0.5, x: -30, y: 20 }, { time: 1 }] },
                },
                physics: physics
                    ? {
                          // every constraint with the flag keeps its wind until the first key
                          '': { wind: [{ time: 0.2 }, { time: 0.6, value: 30 }, { time: 1 }], reset: [{ time: 0.8 }] },
                          // the mass keeps its value until the first key
                          pc: {
                              mass: [
                                  { time: 0.4, value: 2 },
                                  { time: 0.9, value: 0.5 },
                              ],
                          },
                          ph: { reset: [{ time: 0.3 }] },
                          pi: { mix: wave(1, 0.3) },
                      }
                    : {},
            },
            late: {
                bones: { e: { rotate: wave(0, -40) } },
                physics: physics
                    ? {
                          pa: {
                              mass: [
                                  { time: 0.6, value: 4 },
                                  { time: 1, value: 1 },
                              ],
                          },
                      }
                    : {},
            },
        },
    });
}

const [SWAY, LATE] = [0, 1];

const scripts: PoseScript[] = [
    script('bones and constraints that need a skin come and go while physics runs', (s) => {
        s.set(0, SWAY, true);
        // past the reset keys: a constraint that is not active is not reset
        s.update(DT, 27);
        // told to constraints that are not active too
        s.physicsTranslate(7, -3);
        s.skin(1);
        s.update(DT, 8);
        s.physicsRotate(4, 9, 60);
        s.skin(-1);
        s.update(ODD, 5);
        s.physics('pose');
        s.skin(1);
        s.update(DT, 3);
        s.physics('update');
        s.update(DT, 30);
    }),
    script('timelines leave the values of a constraint that is not active alone', (s) => {
        s.set(0, SWAY, true);
        s.update(DT, 11);
        // the values stay where the animation left them, for the constraints it reached
        s.clearTracks();
        s.skin(1);
        s.update(DT, 10);
    }),
    script('every physics mode with readers of the applied pose', (s) => {
        s.skin(1);
        s.set(0, SWAY, true);
        for (const mode of ['update', 'pose', 'none', 'reset', 'update', 'none', 'pose', 'update'] as const) {
            s.physics(mode);
            s.update(DT, 4);
        }
        s.setupPoseBones();
        s.update(ODD, 6);
    }),
    script('a mass timeline before its first key on a track that replaces and one that adds', (s) => {
        s.set(0, SWAY, true);
        s.set(1, LATE, true, { alpha: 0.7 });
        s.set(2, LATE, true, { mixBlend: 'add', alpha: 0.4, timeScale: 1.3 });
        s.update(DT, 40);
        s.setEmpty(1, 0.2);
        s.update(DT, 12);
    }),
];

/** The world transforms of the active bones, and zeros for the others. */
function worldOf(engine: PoseEngine): number[] {
    const { world, active } = engine.state;

    return Array.from(world, (value, i) => (active[Math.floor(i / WORLD_STRIDE)] === 1 ? value : 0));
}

/** The first place where two lists differ, down to the sign of a zero. -1 when they are equal. */
function firstDifference(ours: readonly number[], theirs: readonly number[]): number {
    if (ours.length !== theirs.length) return Math.min(ours.length, theirs.length);

    return ours.findIndex((value, i) => !Object.is(value, theirs[i]));
}

/** The official 4.2 core playing a skeleton as the engine does. `change` edits the data first. */
function officialPlayer(text: string, change: (data: core42.SkeletonData) => void = () => {}) {
    const loader = new core42.AtlasAttachmentLoader(new core42.TextureAtlas(''));
    const data = new core42.SkeletonJson(loader).readSkeletonData(text);

    change(data);
    const skeleton = new core42.Skeleton(data);
    const state = new core42.AnimationState(new core42.AnimationStateData(data));
    const animation = (index: number): core42.Animation => {
        const found = data.animations[index];

        if (found === undefined) throw new Error(`no animation ${index}`);

        return found;
    };

    return {
        skeleton,
        set: (track: number, index: number): core42.TrackEntry => state.setAnimationWith(track, animation(index), true),
        update(dt: number): void {
            state.update(dt);
            skeleton.update(dt);
            state.apply(skeleton);
            skeleton.updateWorldTransform(core42.Physics.update);
        },
        world: (): number[] =>
            skeleton.bones.flatMap((bone) =>
                bone.active ? [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY] : [0, 0, 0, 0, 0, 0],
            ),
    };
}

/**
 * Switches the saving off for a model: every physics constraint computes the applied pose of its
 * bone, with every skin. Returns how many active constraints did not before.
 */
function computeEveryAppliedPose(model: SkeletonModel): number {
    const rig = rigOf(model);
    let skipped = 0;

    for (let skin = -1; skin < model.skins.length; skin++) {
        const cache = cacheOf(rig, skin);

        for (const index of rig.plan.physics) {
            if (cache.constraintActive[index] === 1 && cache.appliedRead[index] === 0) skipped++;
        }
        cache.appliedRead.fill(1);
    }

    return skipped;
}

/** Updates two engines 30 times, the first ten in the mode they are in. Returns the first update after which they differ, or -1. */
function firstUpdateThatDiffers(ours: PoseEngine, reference: PoseEngine): number {
    for (let step = 0; step < 30; step++) {
        for (const engine of [ours, reference]) {
            if (step === 10) engine.physics = 'update';
            engine.update(step % 4 === 3 ? ODD : DT);
        }
        if (firstDifference(worldOf(ours), worldOf(reference)) !== -1) return step;
    }

    return -1;
}

function codeOf(call: () => unknown): string {
    try {
        call();
    } catch (error) {
        if (error instanceof MarrowError) return error.code;
        throw error;
    }

    return 'nothing thrown';
}

describe('physics constraints of the legacy engine', () => {
    const files = { skeleton: readerRig(), atlas: ATLAS };
    const official = loadPoseRig('4.2', files);

    it.each(scripts)('poses like the official core: $name', async (each) => {
        const model = await importSkeleton(files.skeleton);
        const labels = attachmentLabels(model);
        const engine = await createPoseEngine(model);
        const reference = officialSubject(official.createDriver(), labels.ofRef);

        expect(runScript(each, engineSubject(engine, labels.ofObject), reference)).toBeNull();
    });

    it('computes the applied pose of a physics bone only when the update order reads it', async () => {
        const model = await importSkeleton(files.skeleton);
        const rig = rigOf(model);
        const names = model.constraints.map((constraint) => constraint.name);
        const read = (skin: number): string[] => names.filter((_, i) => cacheOf(rig, skin).appliedRead[i] === 1);

        // b has IK, d is the source of a local transform constraint, f is posed again after its parent
        expect(read(-1)).toEqual(['pb', 'pd', 'pf']);
        // with the skin two more constraints run, on bones that nothing reads
        expect(read(1)).toEqual(['pb', 'pd', 'pf']);
        expect(names.filter((_, i) => cacheOf(rig, 1).constraintActive[i] === 1)).toHaveLength(names.length);
    });

    const physicsFixtures = listFixtures().filter(({ id }) =>
        /^4\.2\/(celestial-circus-pro|cloud-pot|sack-pro|snowglobe-pro)\.json$/.test(id),
    );

    it('has the official physics fixtures to test with', () => {
        expect(physicsFixtures).toHaveLength(4);
    });

    it.each([
        { id: 'the rig of this file', text: () => files.skeleton },
        ...physicsFixtures.map((fixture) => ({ id: fixture.id, text: () => readFixture(fixture).skeleton })),
    ])('poses $id the same with the applied pose computed for every physics bone', async ({ text }) => {
        // two models, so that each engine has update caches of its own
        const lean = await importSkeleton(text());
        const full = await importSkeleton(text());

        expect(computeEveryAppliedPose(full)).toBeGreaterThan(0);
        const ours = await createPoseEngine(lean);
        const reference = await createPoseEngine(full);

        for (let animation = 0; animation < lean.animations.length; animation++) {
            for (const engine of [ours, reference]) {
                engine.setSkin(animation % 2 === 0 ? lean.skins.length - 1 : -1);
                engine.physics = MODES[(animation + 2) % MODES.length] ?? 'update';
                engine.setAnimation(0, animation, true);
            }
            expect(firstUpdateThatDiffers(ours, reference), `animation ${animation}`).toBe(-1);
        }
    });

    it('inverts a mass that is not the inverse of a number twice, like the official timeline', async () => {
        // the binary format stores the inverse of the mass in 32 bits, so it can be a number like this one
        const massInverse = Math.fround(0.37);

        expect(1 / (1 / massInverse)).not.toBe(massInverse);
        const model = await importSkeleton(files.skeleton);
        const changed = model.constraints.map((data) => (data.name === 'pa' ? { ...data, massInverse } : data));
        const engine = createLegacyEngine({ ...model, constraints: changed });
        const player = officialPlayer(files.skeleton, (data) => {
            const constraint = data.physicsConstraints.find(({ name }) => name === 'pa');

            if (constraint === undefined) throw new Error('no constraint pa');
            constraint.massInverse = massInverse;
        });

        engine.setAnimation(0, SWAY, true);
        player.set(0, SWAY);
        // only this track keys the mass. It adds, so before its first key it leaves the mass as it is
        engine.configure(engine.setAnimation(1, LATE, true), { mixBlend: 'add' });
        player.set(1, LATE).mixBlend = core42.MixBlend.add;
        for (let step = 0; step < 15; step++) {
            engine.update(DT);
            player.update(DT);
            expect(firstDifference(worldOf(engine), player.world()), `update ${step}`).toBe(-1);
        }
    });

    it('turns the gravity around for a y axis that points down, like the official core', async () => {
        const text = JSON.stringify({
            skeleton: { spine: '4.2.24' },
            bones: [
                { name: 'root' },
                { name: 'p', parent: 'root', x: 10, length: 30, rotation: -70 },
                { name: 'tip', parent: 'p', x: 30 },
            ],
            physics: [{ name: 'hang', bone: 'p', rotate: 1, scaleX: 1, x: 0.5, y: 0.5, ...SOFT, gravity: 12, wind: 3 }],
            animations: {
                swing: {
                    bones: {
                        root: { translate: [{}, { time: 0.5, x: 25, y: -10 }, { time: 1 }], rotate: wave(0, 200) },
                    },
                },
            },
        });
        const model = await importSkeleton(text);
        /** Plays the rig on both sides with the official y scale `scaleY`. Returns the last pose of the engine. */
        const play = async (yDown: boolean, scaleY: number): Promise<number[]> => {
            const engine = await createPoseEngine(model);
            const player = officialPlayer(text);

            // the official skeleton negates its y scale when the flag is set. The pose state has the result.
            Object.assign(engine.state, { yDown, scaleY: yDown ? -scaleY : scaleY });
            player.skeleton.scaleY = scaleY;
            engine.setAnimation(0, 0, true);
            player.set(0, 0);
            core42.Skeleton.yDown = yDown;
            try {
                for (let step = 0; step < 24; step++) {
                    engine.update(DT);
                    player.update(DT);
                    expect(firstDifference(worldOf(engine), player.world()), `update ${step}`).toBe(-1);
                }
            } finally {
                core42.Skeleton.yDown = false;
            }

            return worldOf(engine);
        };
        const down = await play(true, 1);
        const up = await play(false, 1);
        // a mirrored skeleton is not the same: the gravity that turns the bone has its own sign
        const mirrored = await play(false, -1);

        expect(down).not.toEqual(up);
        expect(down).not.toEqual(mirrored);
    });

    it('counts the physics state in the bytes of an instance, and nothing without physics', async () => {
        const bytes = async (parts: Parameters<typeof readerRig>[0]): Promise<number> => {
            const engine = await createPoseEngine(await importSkeleton(readerRig(parts)));
            const { bones, slots } = engine.state.model;

            // what every instance has: the pose state and one number per slot for the attachment timelines
            return engine.bytes - poseStateBytes(engine.state) - slots.count * 8 - bones.count * 7 * 8;
        };
        const applied = 11 * 7 * 8;

        // the applied pose of every bone, six numbers for IK and for transform, 24 for each physics constraint
        expect(await bytes({})).toBe(2 * 6 * 8 + 8 * 24 * 8);
        expect(await bytes({ physics: false })).toBe(2 * 6 * 8);
        expect(await bytes({ ik: false, transform: false })).toBe(8 * 24 * 8);
        // a skeleton without constraints has no applied pose of its own
        expect(await bytes({ ik: false, transform: false, physics: false })).toBe(-applied);
    });

    it('refuses a physics constraint in a 4.1 skeleton and a step that never ends an update', async () => {
        const model = await importSkeleton(files.skeleton);
        const withStep = (step: number): SkeletonModel => ({
            ...model,
            constraints: model.constraints.map((data) => (data.type === 'physics' ? { ...data, step } : data)),
        });

        expect(codeOf(() => createLegacyEngine({ ...model, version: '4.1' }))).toBe('unsupported-feature');
        expect(codeOf(() => createLegacyEngine(withStep(0)))).toBe('invalid-data');
        expect(codeOf(() => createLegacyEngine(withStep(-1 / 60)))).toBe('invalid-data');
        expect(codeOf(() => createLegacyEngine(withStep(1 / 30)))).toBe('nothing thrown');
    });
});
