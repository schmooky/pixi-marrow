import * as core41 from 'spine-core-4.1';
import * as core42 from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton } from '../../src/core';

/*
 * Skeletons made from random numbers, with IK, transform and path constraints in every mode and
 * in any order, on bones with every inherit mode. Each plays one animation that keys the bones and
 * the constraint values. After every update the world transforms must be those of the official
 * core, bit for bit. The numbers come from a seed, so a failure names a skeleton that can be made again.
 */

type Version = '4.1' | '4.2';
type Json = Record<string, unknown>;

/** A random number source from a seed: the mulberry32 generator. */
function random(seed: number) {
    let state = seed;
    const next = (): number => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);

        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n: number): number => Math.floor(next() * n);

    return {
        int,
        /** A number between `low` and `high` with two decimals. */
        range: (low: number, high: number): number => Math.round((low + next() * (high - low)) * 100) / 100,
        chance: (p: number): boolean => next() < p,
        pick: <T>(list: readonly T[]): T => {
            const item = list[int(list.length)];

            if (item === undefined) throw new Error('Nothing to pick from');

            return item;
        },
    };
}

type Random = ReturnType<typeof random>;

const MODES = ['normal', 'onlyTranslation', 'noRotationOrReflection', 'noScale', 'noScaleOrReflection'];
const SCALES = [1, 1, 1, 1.4, 0.6, -1, -0.7, 0];

/** Bones in a random tree. Bone 0 is the root, bone 1 a target below it that nothing constrains. */
function randomBones(r: Random, version: Version, count: number): Json[] {
    const bones: Json[] = [
        { name: 'b0', rotation: r.range(-30, 30) },
        { name: 'b1', parent: 'b0', x: 40, y: 25 },
    ];

    for (let i = 2; i < count; i++) {
        bones.push({
            name: `b${i}`,
            parent: `b${r.int(i)}`,
            x: r.range(-25, 25),
            y: r.range(-25, 25),
            rotation: r.range(-180, 180),
            scaleX: r.pick(SCALES),
            scaleY: r.pick(SCALES),
            shearX: r.chance(0.3) ? r.range(-40, 40) : 0,
            shearY: r.chance(0.3) ? r.range(-40, 40) : 0,
            length: r.chance(0.2) ? 0 : r.range(4, 30),
            [version === '4.1' ? 'transform' : 'inherit']: r.chance(0.6) ? 'normal' : r.pick(MODES),
        });
    }

    return bones;
}

/** A path attachment with random points, open or closed, at constant speed or not, sometimes with weights. */
function randomPath(r: Random, boneCount: number): Json {
    const points = 2 + r.int(3);
    const xy = Array.from({ length: points * 6 }, () => r.range(-50, 50));
    const weighted = Array.from({ length: points * 3 }, (_, i) => {
        const [first, second] = [r.int(boneCount), r.int(boneCount)];

        return [2, first, xy[i * 2] ?? 0, xy[i * 2 + 1] ?? 0, 0.6, second, r.range(-9, 9), r.range(-9, 9), 0.4];
    });

    return {
        type: 'path',
        closed: r.chance(0.4),
        constantSpeed: r.chance(0.6),
        lengths: Array.from({ length: points }, (_, i) => 20 * (i + 1) + r.range(0, 15)),
        vertexCount: points * 3,
        vertices: r.chance(0.3) ? weighted.flat() : xy,
    };
}

/** Bone names for a constraint: bones 2 and up, each with a parent that has a parent when `deep`. */
function someBones(r: Random, bones: Json[], count: number, deep: boolean): string[] {
    const usable = bones
        .filter(({ parent }, i) => i >= 2 && (!deep || parent !== 'b0'))
        .map(({ name }) => String(name));

    return Array.from({ length: count }, () => r.pick(usable.length > 0 ? usable : ['b2']));
}

const mix = (r: Random): number => r.pick([0, 0.25, 0.5, 1, 1, -0.3, 1.4]);

/** One constraint of a random type, with every option drawn. */
function randomConstraint(r: Random, bones: Json[], name: string): [string, Json] {
    const type = r.pick(['ik', 'ik', 'transform', 'transform', 'path']);
    const target = r.chance(0.7) ? 'b1' : `b${r.int(bones.length)}`;

    if (type === 'ik') {
        // two bone IK needs a parent bone that has a parent itself, and a child below it
        const deep = bones.slice(2).filter((bone) => bone.parent !== 'b0');
        const parent = deep.length > 0 && r.chance(0.5) ? r.pick(deep) : undefined;
        const child = bones.find((bone) => parent !== undefined && bone.parent === parent.name);
        const flags = {
            bendPositive: r.chance(0.5),
            compress: r.chance(0.4),
            stretch: r.chance(0.4),
            uniform: r.chance(0.4),
        };
        const names = parent && child ? [parent.name, child.name] : someBones(r, bones, 1, false);

        return [
            'ik',
            { name, bones: names, target, mix: mix(r), softness: r.chance(0.4) ? r.range(0, 20) : 0, ...flags },
        ];
    }
    if (type === 'transform') {
        const offsets = {
            rotation: r.range(-200, 200),
            x: r.range(-9, 9),
            y: r.range(-9, 9),
            scaleX: r.range(-1, 1),
            scaleY: r.range(-1, 1),
            shearY: r.range(-90, 90),
        };
        const mixes = {
            mixRotate: mix(r),
            mixX: mix(r),
            mixY: mix(r),
            mixScaleX: mix(r),
            mixScaleY: mix(r),
            mixShearY: mix(r),
        };
        const modes = { local: r.chance(0.4), relative: r.chance(0.4) };

        return [
            'transform',
            { name, bones: someBones(r, bones, 1 + r.int(2), false), target, ...modes, ...offsets, ...mixes },
        ];
    }
    const modes = {
        positionMode: r.pick(['fixed', 'percent']),
        spacingMode: r.pick(['length', 'fixed', 'percent', 'proportional']),
        rotateMode: r.pick(['tangent', 'chain', 'chainScale']),
    };
    const fixed = modes.positionMode === 'fixed';
    const values = {
        rotation: r.chance(0.5) ? r.range(-90, 90) : 0,
        position: r.range(-0.4, 1.4) * (fixed ? 60 : 1),
        spacing: r.pick([0, 0.2, 7, -3]),
    };

    return [
        'path',
        {
            name,
            bones: someBones(r, bones, 1 + r.int(3), false),
            target: 'rail',
            ...modes,
            ...values,
            mixRotate: mix(r),
            mixX: mix(r),
            mixY: mix(r),
        },
    ];
}

/** Two keys for the values of a constraint, by the names its timeline takes. */
function constraintKeys(r: Random, type: string): Json | Json[] {
    const keys = (make: () => Json): Json[] => [
        make(),
        { time: 0.5, ...make(), ...(r.chance(0.3) ? { curve: 'stepped' } : {}) },
        { time: 1, ...make() },
    ];

    if (type === 'ik') {
        return keys(() => ({
            mix: mix(r),
            softness: r.range(0, 15),
            bendPositive: r.chance(0.5),
            compress: r.chance(0.5),
            stretch: r.chance(0.5),
        }));
    }
    if (type === 'transform') {
        return keys(() => ({
            mixRotate: mix(r),
            mixX: mix(r),
            mixY: mix(r),
            mixScaleX: mix(r),
            mixScaleY: mix(r),
            mixShearY: mix(r),
        }));
    }

    return {
        position: keys(() => ({ value: r.range(-0.5, 1.5) })),
        spacing: keys(() => ({ value: r.range(-4, 9) })),
        mix: keys(() => ({ mixRotate: mix(r), mixX: mix(r), mixY: mix(r) })),
    };
}

/** A skeleton from a seed: bones, a path, constraints in a shuffled order and an animation that keys all of it. */
function randomRig(version: Version, seed: number): string {
    const r = random(seed);
    const bones = randomBones(r, version, 6 + r.int(8));
    const constraints = Array.from({ length: 2 + r.int(5) }, (_, i) => randomConstraint(r, bones, `c${i}`));
    const orders = constraints.map((_, i) => i).sort(() => r.range(-1, 1));
    const lists: Record<string, Json[]> = { ik: [], transform: [], path: [] };
    const timelines: Record<string, Json> = { ik: {}, transform: {}, path: {} };
    const moved: Json = {};

    constraints.forEach(([type, data], i) => {
        lists[type]?.push({ ...data, order: orders[i] });
        if (r.chance(0.7)) Object.assign(timelines[type] ?? {}, { [String(data.name)]: constraintKeys(r, type) });
    });
    for (const bone of bones.slice(1)) {
        if (r.chance(0.5)) continue;
        moved[String(bone.name)] = {
            rotate: [{ value: r.range(-90, 90) }, { time: 1, value: r.range(-400, 400) }],
            translate: [
                { x: r.range(-30, 30), y: r.range(-30, 30) },
                { time: 0.7, x: r.range(-30, 30) },
            ],
            ...(r.chance(0.3)
                ? {
                      scale: [
                          { x: r.pick(SCALES), y: r.pick(SCALES) },
                          { time: 0.9, x: 1.2 },
                      ],
                  }
                : {}),
        };
    }

    return JSON.stringify({
        skeleton: { spine: `${version}.24` },
        bones,
        slots: [{ name: 'rail', bone: `b${r.int(bones.length)}`, attachment: 'line' }],
        ...lists,
        skins: [{ name: 'default', attachments: { rail: { line: randomPath(r, bones.length) } } }],
        animations: { play: { bones: moved, ...timelines } },
    });
}

/** The official core playing the one animation of a rig, with the skeleton placed. Each step gives the world transforms. */
function official(version: Version, text: string, placing: Json): (dt: number) => number[] {
    const read = (bones: readonly { a: number; b: number; c: number; d: number; worldX: number; worldY: number }[]) =>
        bones.flatMap((bone) => [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY]);

    if (version === '4.1') {
        const data = new core41.SkeletonJson(
            new core41.AtlasAttachmentLoader(new core41.TextureAtlas('')),
        ).readSkeletonData(text);
        const skeleton = Object.assign(new core41.Skeleton(data), placing);
        const state = new core41.AnimationState(new core41.AnimationStateData(data));

        state.setAnimation(0, 'play', true);

        return (dt) => {
            state.update(dt);
            state.apply(skeleton);
            skeleton.updateWorldTransform();

            return read(skeleton.bones);
        };
    }
    const data = new core42.SkeletonJson(
        new core42.AtlasAttachmentLoader(new core42.TextureAtlas('')),
    ).readSkeletonData(text);
    const skeleton = Object.assign(new core42.Skeleton(data), placing);
    const state = new core42.AnimationState(new core42.AnimationStateData(data));

    state.setAnimation(0, 'play', true);

    return (dt) => {
        state.update(dt);
        state.apply(skeleton);
        skeleton.updateWorldTransform(core42.Physics.none);

        return read(skeleton.bones);
    };
}

const PLACINGS: Json[] = [
    { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    { x: 12, y: -7, scaleX: 1.5, scaleY: 0.5 },
    { x: -3, y: 4, scaleX: -1, scaleY: 1 },
    { x: 0, y: 0, scaleX: 2, scaleY: -0.75 },
];

describe.each(['4.1', '4.2'] as const)('random %s skeletons with constraints', (version) => {
    it('pose like the official core, bit for bit', { timeout: 60_000 }, async () => {
        let compared = 0;

        for (let seed = 1; seed <= 240; seed++) {
            const text = randomRig(version, seed);
            const placing = PLACINGS[seed % PLACINGS.length] ?? {};
            const engine = await createPoseEngine(await importSkeleton(text));
            const step = official(version, text, placing);

            Object.assign(engine.state, placing);
            engine.setAnimation(0, 0, true);
            for (let update = 0; update < 14; update++) {
                engine.update(0.093);
                expect(Array.from(engine.state.world), `seed ${seed}, update ${update + 1}`).toEqual(step(0.093));
                compared += engine.state.world.length;
            }
        }
        expect(compared).toBeGreaterThan(100_000);
    });
});
