import * as core41 from 'spine-core-4.1';
import * as core42 from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, WORLD_STRIDE } from '../../src/core';
import { cacheOf } from '../../src/pose/legacy/cache';
import { rigOf } from '../../src/pose/legacy/rig';
import { listFixtures, readFixture } from '../parity/fixtures';
import type { RigFiles } from '../parity/official';

/*
 * The update order. The official `Skeleton.updateCache` decides in which order bones update and
 * constraints solve, and which of them are active with a skin. The engine must sort the same way,
 * for every skin, or poses differ in their last bits.
 */

type Version = '4.1' | '4.2';

/** What the comparison reads of an official skeleton, of either version. */
interface Sorted {
    _updateCache: object[];
    bones: { active: boolean }[];
    ikConstraints: { active: boolean }[];
    transformConstraints: { active: boolean }[];
    pathConstraints: { active: boolean }[];
    physicsConstraints?: { active: boolean }[];
}

/** An official skeleton that sorts its update cache for a skin. -1 is no skin. */
interface Official {
    skins: number;
    sort(skin: number): Sorted;
}

class FakeTexture41 extends core41.Texture {
    setFilters(): void {}
    setWraps(): void {}
    dispose(): void {}
}

class FakeTexture42 extends core42.Texture {
    setFilters(): void {}
    setWraps(): void {}
    dispose(): void {}
}

const image = (page: { width: number; height: number }): ImageBitmap => ({
    width: page.width,
    height: page.height,
    close() {},
});

function official41(files: RigFiles): Official {
    const atlas = new core41.TextureAtlas(files.atlas);

    for (const page of atlas.pages) page.setTexture(new FakeTexture41(image(page)));
    const loader = new core41.AtlasAttachmentLoader(atlas);
    const data =
        typeof files.skeleton === 'string'
            ? new core41.SkeletonJson(loader).readSkeletonData(files.skeleton)
            : new core41.SkeletonBinary(loader).readSkeletonData(files.skeleton);
    const skeleton = new core41.Skeleton(data);

    return {
        skins: data.skins.length,
        sort(skin) {
            skeleton.skin = data.skins[skin] ?? null;
            skeleton.updateCache();

            return skeleton;
        },
    };
}

function official42(files: RigFiles): Official {
    const atlas = new core42.TextureAtlas(files.atlas);

    for (const page of atlas.pages) page.setTexture(new FakeTexture42(image(page)));
    const loader = new core42.AtlasAttachmentLoader(atlas);
    const data =
        typeof files.skeleton === 'string'
            ? new core42.SkeletonJson(loader).readSkeletonData(files.skeleton)
            : new core42.SkeletonBinary(loader).readSkeletonData(files.skeleton);
    const skeleton = new core42.Skeleton(data);

    return {
        skins: data.skins.length,
        sort(skin) {
            skeleton.skin = data.skins[skin] ?? null;
            skeleton.updateCache();

            return skeleton;
        },
    };
}

/**
 * The official cache in the numbers of the engine: a bone index, or -1 minus the index of a
 * constraint in the list of the model, which holds IK first, then transform, then path. Physics
 * constraints have no entry in the engine, so they are left out here.
 */
function officialEntries(skeleton: Sorted): number[] {
    const lists: object[][] = [skeleton.ikConstraints, skeleton.transformConstraints, skeleton.pathConstraints];
    const constraints = lists.flat();
    const bones: object[] = skeleton.bones;
    const entries: number[] = [];

    for (const entry of skeleton._updateCache) {
        const bone = bones.indexOf(entry);
        const constraint = constraints.indexOf(entry);

        if (bone >= 0) entries.push(bone);
        else if (constraint >= 0) entries.push(-1 - constraint);
    }

    return entries;
}

const flags = (list: readonly { active: boolean }[]): number[] => list.map((each) => (each.active ? 1 : 0));

/** Compares the cache of the engine with the official one for every skin of a skeleton, and for none. */
async function expectSameOrder(version: Version, files: RigFiles, label: string): Promise<number> {
    const rig = rigOf(await importSkeleton(files.skeleton));
    const official = version === '4.1' ? official41(files) : official42(files);

    for (let skin = -1; skin < official.skins; skin++) {
        const skeleton = official.sort(skin);
        const cache = cacheOf(rig, skin);
        const where = `${label}, skin ${skin}`;
        const active = [
            ...flags(skeleton.ikConstraints),
            ...flags(skeleton.transformConstraints),
            ...flags(skeleton.pathConstraints),
            ...flags(skeleton.physicsConstraints ?? []),
        ];

        expect(Array.from(cache.entries), where).toEqual(officialEntries(skeleton));
        expect(Array.from(cache.boneActive), where).toEqual(flags(skeleton.bones));
        expect(Array.from(cache.constraintActive), where).toEqual(active);
    }

    return official.skins + 1;
}

const ATLAS = ['page.png', 'size: 4, 4', 'filter: Linear, Linear', ''].join('\n');
const PATH = { type: 'path', lengths: [10, 20], vertexCount: 6, vertices: [-5, 0, 0, 0, 5, 0, 15, 0, 20, 0, 25, 0] };
/** A path with weights: every vertex follows the bones 6 and 2. */
const WEIGHTED = {
    ...PATH,
    vertices: Array.from({ length: 6 }, (_, i) => [2, 6, i * 5, 0, 0.5, 2, i * 5, 1, 0.5]).flat(),
};

/**
 * A skeleton made to sort: constraints in every relation to each other, written out of order.
 * Two constraints share an order number and one has a number past the count, which the official
 * sort never reaches. Bones and constraints need skins, and a path has weights in one skin only.
 */
function sortRig(version: Version): string {
    const physics =
        version === '4.2'
            ? {
                  physics: [
                      { name: 'wobble', order: 3, bone: 'b', x: 1, rotate: 1 },
                      { name: 'sway', order: 6, bone: 'g', rotate: 1, skin: true },
                  ],
              }
            : {};

    return JSON.stringify({
        skeleton: { spine: `${version}.24` },
        bones: [
            { name: 'root' },
            { name: 'a', parent: 'root', x: 10, length: 10 },
            { name: 'b', parent: 'a', x: 10, length: 10 },
            { name: 'c', parent: 'b', x: 10, length: 10 },
            { name: 'd', parent: 'c', x: 10, length: 10 },
            { name: 't', parent: 'root', x: 30, y: 20 },
            { name: 'e', parent: 'root', y: -10, length: 8 },
            { name: 'f', parent: 'e', x: 8, length: 8, skin: true },
            { name: 'g', parent: 'f', x: 8, length: 8, skin: true },
            { name: 'h', parent: 'root', x: -10 },
        ],
        slots: [
            { name: 'rail', bone: 'h', attachment: 'line' },
            { name: 'spare', bone: 'e' },
        ],
        ik: [
            { name: 'three', order: 5, bones: ['a', 'b', 'c'], target: 't' },
            { name: 'two', order: 4, bones: ['b', 'c'], target: 't' },
            { name: 'one', order: 0, bones: ['d'], target: 't' },
            { name: 'twin', order: 0, bones: ['e'], target: 't' },
            { name: 'skinned', order: 7, bones: ['g'], target: 't', skin: true },
            { name: 'late', order: 40, bones: ['h'], target: 't' },
        ],
        transform: [
            { name: 'local', order: 2, bones: ['d', 'c'], target: 't', local: true },
            { name: 'world', order: 1, bones: ['b'], target: 'd' },
        ],
        path: [
            { name: 'follow', order: 8, bones: ['a', 'b'], target: 'rail' },
            { name: 'spare', order: 9, bones: ['c'], target: 'spare', skin: true },
        ],
        ...physics,
        skins: [
            { name: 'default', attachments: { rail: { line: PATH } } },
            { name: 'far', bones: ['g'], ik: ['skinned'], attachments: { rail: { line: WEIGHTED } } },
            { name: 'near', bones: ['f'], path: ['spare'], ...(version === '4.2' ? { physics: ['sway'] } : {}) },
        ],
        animations: { still: {} },
    });
}

/**
 * A 4.2 skeleton where a physics constraint that is switched off still changes numbers. The
 * transform constraint writes the world transform of `b`. The physics constraint on `a` then has
 * the bones below `a` sorted again, so `b` updates once more, from its applied pose.
 */
function physicsRig(withPhysics: boolean): string {
    return JSON.stringify({
        skeleton: { spine: '4.2.24' },
        bones: [
            { name: 'root', rotation: 7 },
            { name: 't', parent: 'root', x: 31, y: 17, rotation: 23, scaleX: 1.3, shearY: 11 },
            { name: 'a', parent: 'root', x: 9, y: 4, rotation: 31, scaleY: 0.9 },
            { name: 'b', parent: 'a', x: 13, y: 2, rotation: -19, shearX: 5 },
            { name: 'c', parent: 'b', x: 11, y: -3, rotation: 41 },
        ],
        transform: [
            { name: 'copy', order: 0, bones: ['b'], target: 't', mixRotate: 0.37, mixX: 0.41, mixScaleX: 0.29 },
        ],
        physics: withPhysics ? [{ name: 'wobble', order: 1, bone: 'a', x: 1, rotate: 1 }] : [],
        animations: { still: {} },
    });
}

/** The world transforms the official 4.2 core gives a setup pose, with physics switched off. */
function officialWorld(text: string): number[] {
    const loader = new core42.AtlasAttachmentLoader(new core42.TextureAtlas(''));
    const skeleton = new core42.Skeleton(new core42.SkeletonJson(loader).readSkeletonData(text));

    skeleton.updateWorldTransform(core42.Physics.none);

    return skeleton.bones.flatMap((bone) => [bone.a, bone.b, bone.c, bone.d, bone.worldX, bone.worldY]);
}

describe('the update order of the legacy engine', () => {
    const fixtures = listFixtures().filter(({ id, version }) => version !== '4.3' && !id.startsWith('local/'));

    it('is the official one for every skin of every official fixture', async () => {
        let sorts = 0;

        for (const fixture of fixtures) {
            const version = fixture.version === '4.1' ? '4.1' : '4.2';

            sorts += await expectSameOrder(version, readFixture(fixture), fixture.id);
        }
        expect(sorts).toBeGreaterThan(fixtures.length);
    });

    it.each(['4.1', '4.2'] as const)('is the official one for a %s skeleton made to sort', async (version) => {
        const files = { skeleton: sortRig(version), atlas: ATLAS };
        const { constraints } = rigOf(await importSkeleton(files.skeleton)).plan;

        expect(await expectSameOrder(version, files, version)).toBe(4);
        const pathBones = constraints.find(({ name }) => name === 'follow')?.pathBones ?? [];

        // per skin: the bone of the slot for the path without weights, the two bones of the weighted one
        expect(pathBones.map((bones) => Array.from(bones))).toEqual([[9], [6, 2], []]);
    });

    it('keeps the place of a physics constraint that is switched off, as the official core does', async () => {
        const text = physicsRig(true);
        const model = await importSkeleton(text);
        const engine = await createPoseEngine(model, { constraints: 'ignore' });
        const b = model.bones.names.indexOf('b');

        engine.update(0);
        // b comes twice: before the transform constraint, and again because physics sits on its parent
        expect(Array.from(cacheOf(rigOf(model), -1).entries)).toEqual([0, 1, 2, b, -1, b, 4]);
        expect(Array.from(engine.state.world)).toEqual(officialWorld(text));
        // taken out of the file, the constraint leaves b as the transform constraint wrote it
        const without = officialWorld(physicsRig(false));
        const world = Array.from(engine.state.world);

        expect(world.slice(0, b * WORLD_STRIDE)).toEqual(without.slice(0, b * WORLD_STRIDE));
        expect(world.slice(b * WORLD_STRIDE)).not.toEqual(without.slice(b * WORLD_STRIDE));
    });
});
