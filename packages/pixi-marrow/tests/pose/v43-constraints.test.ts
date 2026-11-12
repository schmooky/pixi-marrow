import { AnimationState, AnimationStateData, Physics, Skeleton, Slider } from 'spine-core-4.3';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type SkeletonModel, WORLD_STRIDE } from '../../src/core';
import { loadPoseRig } from '../parity/pose-official';
import { readData43 } from '../parity/pose-official43';
import { attachmentLabels, engineSubject, officialSubject, runScript } from '../parity/pose-run';
import { DT, type PoseScript, script } from '../parity/pose-script';
import { SCRIPT_FAMILIES } from '../parity/pose-scripts';
import type { OfficialPoseRig } from '../parity/pose-shared';

/** One page without regions. The rig below shows paths only. */
const ATLAS = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');

/** A path attachment through knots of x, y, with handles a fifth of the way to the next knot. */
function pathOf(knots: number[][], more: object = {}, weights?: number[]): object {
    const points = knots.flatMap(([x = 0, y = 0], i) => {
        const [nx = x + 10, ny = y] = knots[(i + 1) % knots.length] ?? [];
        const [px = x - 10, py = y] = knots[(i + knots.length - 1) % knots.length] ?? [];

        return [
            [x + (px - x) / 5, y + (py - y) / 5],
            [x, y],
            [x + (nx - x) / 5, y + (ny - y) / 5],
        ];
    });
    const vertices = points.flatMap(([x = 0, y = 0]) =>
        weights
            ? [weights.length, ...weights.flatMap((bone) => [bone, x - bone, y + bone, 1 / weights.length])]
            : [x, y],
    );
    const lengths = knots.map((_, i) => (i + 1) * 31.5);

    return { type: 'path', lengths, vertexCount: points.length, vertices, ...more };
}

/*
 * A skeleton with every kind of constraint: two bone and one bone IK, transform constraints from
 * world and local to world and local, path constraints of several modes on open, closed and
 * weighted paths, a constraint and bones that need a skin, a physics constraint and a slider.
 */
const BONES = [
    { name: 'root' },
    { name: 'hip', parent: 'root', x: 10, y: 20, rotation: 30, scaleX: 1.2 },
    { name: 'arm1', parent: 'hip', length: 30, rotation: 20 },
    { name: 'arm2', parent: 'arm1', length: 25, x: 30, rotation: -35, scaleX: 0.9 },
    { name: 'hand', parent: 'arm2', length: 10, x: 25, rotation: 10 },
    { name: 'goal', parent: 'root', x: 62, y: 44 },
    { name: 'leg', parent: 'hip', length: 40, rotation: -80, inherit: 'noScale' },
    { name: 'step', parent: 'root', x: 24, y: -52 },
    { name: 'src', parent: 'root', x: -30, y: 12, rotation: 45, scaleX: 1.2, scaleY: -0.8, shearY: 10 },
    { name: 'follow1', parent: 'hip', x: 5, y: 9, rotation: -20, inherit: 'noRotationOrReflection' },
    { name: 'follow2', parent: 'root', x: -12, y: -30, rotation: 70, scaleX: 0.7 },
    { name: 'c1', parent: 'root', length: 18, x: 4, y: 6, rotation: 12 },
    { name: 'c2', parent: 'c1', length: 16, x: 18, rotation: -25 },
    { name: 'c3', parent: 'c2', length: 0, x: 16, rotation: 40, inherit: 'onlyTranslation' },
    { name: 'c4', parent: 'root', length: 12, x: -40, y: -20 },
    { name: 'gated', parent: 'hip', length: 14, x: 3, rotation: 15, skin: true },
    { name: 'tip', parent: 'gated', x: 14, y: 2 },
];
const CONSTRAINTS = [
    {
        type: 'ik',
        name: 'reach',
        bones: ['arm1', 'arm2'],
        target: 'goal',
        mix: 0.8,
        softness: 6,
        stretch: true,
        scaleY: 'uniform',
    },
    { type: 'ik', name: 'stand', bones: ['leg'], target: 'step', compress: true, stretch: true, scaleY: 'volume' },
    {
        type: 'transform',
        name: 'copy',
        bones: ['follow1', 'hand'],
        source: 'src',
        rotation: 15,
        x: 4,
        y: -3,
        scaleX: 0.1,
        shearY: 8,
        mixRotate: 0.6,
        mixX: 0.5,
        mixY: 0.4,
        mixScaleX: 0.7,
        mixScaleY: 0.3,
        mixShearY: 0.5,
        properties: {
            rotate: { to: { rotate: {} } },
            x: { to: { x: {} } },
            y: { to: { y: {} } },
            scaleX: { to: { scaleX: {} } },
            scaleY: { to: { scaleY: {} } },
            shearY: { to: { shearY: {} } },
        },
    },
    {
        type: 'transform',
        name: 'local',
        bones: ['follow2'],
        source: 'src',
        localSource: true,
        localTarget: true,
        additive: true,
        clamp: true,
        mixRotate: 0.5,
        mixX: 0.8,
        mixScaleX: 0.6,
        mixShearY: 0.4,
        properties: {
            rotate: { offset: 10, to: { x: { offset: -5, max: 20, scale: 0.5 }, shearY: { max: 30 } } },
            scaleX: { to: { scaleX: { offset: 1, max: 2 }, rotate: { scale: 40, max: 90 } } },
        },
    },
    {
        type: 'path',
        name: 'ride',
        bones: ['c1', 'c2', 'c3'],
        slot: 'track',
        positionMode: 'fixed',
        spacingMode: 'length',
        rotateMode: 'chain',
        position: 20,
        spacing: 4,
        mixRotate: 0.9,
        mixX: 0.8,
    },
    {
        type: 'path',
        name: 'loop',
        bones: ['c4', 'follow2'],
        slot: 'ring',
        positionMode: 'percent',
        spacingMode: 'percent',
        rotateMode: 'tangent',
        rotation: 25,
        position: 0.3,
        spacing: 0.4,
    },
    {
        type: 'path',
        name: 'grow',
        bones: ['tip', 'c4'],
        slot: 'track',
        positionMode: 'percent',
        spacingMode: 'proportional',
        rotateMode: 'chainScale',
        position: -0.2,
        spacing: 1.5,
        mixRotate: 0.5,
        skin: true,
    },
    { type: 'ik', name: 'gatedIk', bones: ['gated'], target: 'goal', skin: true },
    { type: 'physics', name: 'sway', bone: 'hand', x: 1, y: 1, rotate: 1 },
    { type: 'slider', name: 'slide', animation: 'wave', bone: 'src', property: 'x', scale: 0.1 },
];
const keys = (name: string, values: number[]): object[] =>
    values.map((value, i) => ({ time: i * 0.4, [name]: value, ...(i === 1 ? { curve: 'stepped' } : {}) }));
const RIG = JSON.stringify({
    skeleton: { spine: '4.3.39-beta' },
    bones: BONES,
    slots: [
        { name: 'track', bone: 'hip', attachment: 'line' },
        { name: 'ring', bone: 'src', attachment: 'ring' },
    ],
    constraints: CONSTRAINTS,
    skins: [
        {
            name: 'default',
            attachments: {
                track: {
                    line: pathOf([
                        [0, 0],
                        [40, 30],
                        [90, -10],
                        [140, 20],
                    ]),
                    bent: pathOf(
                        [
                            [0, 0],
                            [30, 50],
                            [80, 60],
                        ],
                        { constantSpeed: false },
                        [1, 5, 11],
                    ),
                },
                ring: {
                    ring: pathOf(
                        [
                            [0, 0],
                            [50, 10],
                            [40, 60],
                            [-10, 40],
                        ],
                        { closed: true, constantSpeed: false },
                    ),
                },
            },
        },
        {
            name: 'armed',
            bones: ['gated'],
            ik: ['gatedIk'],
            path: ['grow'],
            attachments: {
                ring: {
                    ring: pathOf(
                        [
                            [5, 5],
                            [60, 0],
                        ],
                        { closed: true },
                    ),
                },
            },
        },
    ],
    animations: {
        wave: {
            bones: {
                hip: { rotate: keys('value', [0, 40, -30]), translate: [{ x: 0 }, { time: 0.8, x: 15, y: -8 }] },
                goal: {
                    translate: [
                        { x: -40, y: 10 },
                        { time: 0.5, x: 30, y: 30, curve: [0.6, 20, 0.7, 40, 0.6, 10, 0.7, 60] },
                        { time: 1, x: -90, y: -60 },
                    ],
                },
                step: { translate: [{ y: 30 }, { time: 1, x: 20, y: -30 }] },
                src: { rotate: keys('value', [0, 200, -100]), scale: [{ x: 1 }, { time: 0.8, x: -1.5, y: 0.5 }] },
                arm1: {
                    scale: [
                        { x: 1, y: 1 },
                        { time: 0.6, x: 1.4, y: 0.7 },
                    ],
                },
            },
        },
        aim: {
            ik: {
                reach: [
                    { mix: 0.2, softness: 0, bendPositive: false },
                    { time: 0.4, mix: 1, softness: 12, stretch: true, curve: [0.5, 0.2, 0.6, 1.2, 0.5, 0, 0.6, 20] },
                    { time: 0.9, mix: 0.5 },
                ],
                stand: [
                    { time: 0.2, mix: 0.7, compress: true },
                    { time: 0.7, mix: 0, stretch: true },
                ],
                gatedIk: [{ mix: 0.5 }, { time: 0.5, mix: 1 }],
            },
            transform: {
                copy: [
                    { mixRotate: 0, mixX: 1, mixScaleX: 0.5, mixShearY: 0 },
                    { time: 0.5, mixRotate: 1.2, mixX: -0.5, mixY: 0.3, mixScaleY: 0.9, mixShearY: 1 },
                ],
                local: [
                    { time: 0.3, mixRotate: 1, mixX: 0, mixScaleX: 1, mixShearY: 1 },
                    { time: 0.8, mixRotate: 0 },
                ],
            },
        },
        travel: {
            path: {
                ride: {
                    position: keys('value', [-30, 60, 190]),
                    spacing: keys('value', [0, 12, -6]),
                    mix: [
                        { mixRotate: 0, mixX: 1 },
                        { time: 0.6, mixRotate: 1, mixX: 0.2, mixY: 0.5 },
                    ],
                },
                loop: { position: keys('value', [0, 1.4, -0.6]), spacing: [{ value: 0 }, { time: 0.7, value: 0.5 }] },
                grow: {
                    position: keys('value', [0.5, 1.2, -0.4]),
                    mix: [{ time: 0.3, mixRotate: 1, mixX: 0.5, mixY: 0.5 }],
                },
            },
            slots: {
                track: {
                    attachment: [
                        { time: 0.3, name: 'bent' },
                        { time: 0.7, name: null },
                        { time: 0.9, name: 'line' },
                    ],
                },
            },
            attachments: {
                default: {
                    track: {
                        line: { deform: [{ vertices: Array.from({ length: 24 }, (_, i) => i - 12) }, { time: 0.8 }] },
                    },
                },
            },
            physics: { sway: { mix: [{ value: 0.5 }, { time: 1, value: 1 }] } },
            slider: { slide: { time: [{ value: 0 }, { time: 1, value: 1 }] } },
        },
    },
});

const [WAVE, AIM, TRAVEL] = [0, 1, 2];

/** Scripts for what the families of the parity suite do not reach on this skeleton. */
const SCRIPTS: PoseScript[] = [
    script('constraint timelines that mix, hold and add', (s) => {
        s.defaultMix(0.3);
        s.set(0, WAVE, true);
        s.set(1, AIM, true, { alpha: 0.6 });
        s.update(DT, 20);
        s.set(1, TRAVEL, true, { alpha: 0.8 });
        s.set(2, AIM, true, { additive: true, alpha: 0.5 });
        s.update(DT, 30);
        s.skin(1);
        s.set(2, TRAVEL, false, { additive: true });
        s.setEmpty(1, 0.2);
        s.update(DT, 25);
        s.setupPoseBones();
        s.skin(-1);
        s.update(DT, 10);
    }),
    script('constraints with a scaled and mirrored skeleton that changes skins', (s) => {
        s.set(0, TRAVEL, true);
        s.set(1, WAVE, true, { reverse: true });
        s.update(0.13, 9);
        s.skin(1);
        s.update(0.13, 9);
        s.set(2, AIM, false);
        s.skin(0);
        s.update(0.21, 7);
        s.setupPose();
        s.update(0.21, 3);
    }),
];

describe('the constraints of the 4.3 pose engine', () => {
    let rig: OfficialPoseRig;
    let model: SkeletonModel;
    let labels: ReturnType<typeof attachmentLabels>;
    const run = async (each: PoseScript): Promise<void> => {
        const engine = await createPoseEngine(model, { constraints: 'ignore' });
        const failure = runScript(
            each,
            engineSubject(engine, labels.ofObject),
            officialSubject(rig.createDriver(), labels.ofRef),
        );

        if (failure !== null) expect.fail(failure);
    };

    beforeAll(async () => {
        rig = loadPoseRig('4.3', { skeleton: RIG, atlas: ATLAS });
        model = await importSkeleton(RIG);
        labels = attachmentLabels(model);
    });

    it.each(SCRIPT_FAMILIES)('pose like the official core: $name', async (family) => {
        for (const each of family.scripts(rig.info, 'constraints')) await run(each);
    });

    it.each(SCRIPTS)('pose like the official core: $name', run);

    it('give every bone the official world transform, also a bone that is not active', async () => {
        const data = readData43({ skeleton: RIG, atlas: ATLAS });
        const engine = await createPoseEngine(model, { constraints: 'ignore' });
        const skeleton = new Skeleton(data);
        const state = new AnimationState(new AnimationStateData(data));
        const compare = (where: string): void => {
            const theirs = skeleton.bones.flatMap(({ appliedPose: p }) => [p.a, p.b, p.c, p.d, p.worldX, p.worldY]);

            expect(Array.from(engine.state.world), where).toEqual(theirs);
        };

        // a slider that does nothing and physics that are not updated: what the engine leaves out
        for (const constraint of skeleton.constraints) if (constraint instanceof Slider) constraint.update = () => {};
        Object.assign(engine.state, { x: 7, y: -3, scaleX: -1.25, scaleY: 0.75 });
        Object.assign(skeleton, { x: 7, y: -3, scaleX: -1.25, scaleY: 0.75 });
        [WAVE, AIM, TRAVEL].forEach((animation, track) => {
            engine.setAnimation(track, animation, true);
            state.setAnimation(track, data.animations[animation]?.name ?? '', true);
        });
        // more than 255 updates: the marks of what an update has done start over on the way
        for (let step = 0; step < 300; step++) {
            if (step % 7 === 3) {
                const skin = step % 2 === 0 ? -1 : 1;

                // a bone that gets or loses its constrained pose shows what that pose held last
                engine.setSkin(skin);
                skeleton.setSkin(data.skins[skin] ?? null);
                compare(`after skin ${skin} at step ${step}`);
            }
            engine.update(0.07);
            state.update(0.07);
            state.apply(skeleton);
            skeleton.updateWorldTransform(Physics.none);
            compare(`update ${step}`);
        }
        // the constraints leave the animated pose alone
        skeleton.bones.forEach(({ pose }, i) => {
            const mine = Array.from(engine.state.local.subarray(i * 7, i * 7 + 7));

            expect(mine).toEqual([pose.x, pose.y, pose.rotation, pose.scaleX, pose.scaleY, pose.shearX, pose.shearY]);
        });
    });

    it('moves bones only where a constraint is active', async () => {
        const plain = await importSkeleton(RIG);
        const bare = await importSkeleton(RIG);

        bare.constraints.length = 0;
        for (const animation of bare.animations) {
            animation.timelines = animation.timelines.filter(({ kind }) => !/[cC]onstraint|slider/.test(kind));
        }
        for (const skin of bare.skins) skin.constraints = new Int16Array(0);
        const [engine, free] = await Promise.all(
            [plain, bare].map((each) => createPoseEngine(each, { constraints: 'ignore' })),
        );
        const moved = (): string[] => {
            engine?.update(0);
            free?.update(0);

            return plain.bones.names.filter((_, bone) =>
                [0, 1, 2, 3, 4, 5].some(
                    (k) => engine?.state.world[bone * WORLD_STRIDE + k] !== free?.state.world[bone * WORLD_STRIDE + k],
                ),
            );
        };

        // gated and tip need the skin, like the constraints gatedIk and grow
        expect(moved()).toEqual(['arm1', 'arm2', 'hand', 'leg', 'follow1', 'follow2', 'c1', 'c2', 'c3', 'c4']);
        engine?.setSkin(1);
        free?.setSkin(1);
        expect(moved()).toEqual([
            'arm1',
            'arm2',
            'hand',
            'leg',
            'follow1',
            'follow2',
            'c1',
            'c2',
            'c3',
            'c4',
            'gated',
            'tip',
        ]);
    });
});
