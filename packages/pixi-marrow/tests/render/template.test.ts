import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { SPINE_VERSIONS } from '../../src/base/version';
import type { MeshAttachmentData } from '../../src/model/attachments';
import { SkeletonView } from '../../src/render/skeleton-view';
import { syntheticRig } from '../geometry/synthetic';
import {
    createRig,
    drawPose,
    expectKernel,
    fixtureFiles,
    loadRig,
    meshes,
    play,
    type Rig,
    readDrawn,
    slotIndex,
    step,
    vertexData,
} from './rig';

const skinIndex = (rig: Rig, name: string): number => rig.model.skins.findIndex((skin) => skin.name === name);

/** The first mesh attachment of the default skin that is not linked, with its slot. */
function firstMesh(rig: Rig): { slot: number; mesh: MeshAttachmentData } {
    for (const { slot, attachment } of rig.model.skins[rig.lookup.defaultSkin]?.attachments ?? []) {
        if (attachment.type === 'mesh' && attachment.parent === null) return { slot, mesh: attachment };
    }
    throw new Error('the rig has no mesh');
}

/** A skeleton of two slots with one large mesh each: more vertices than a 16-bit index reaches. */
function largeRig(verticesPerMesh: number): { skeleton: string; atlas: string } {
    const vertices: number[] = [];
    const uvs: number[] = [];

    for (let i = 0; i < verticesPerMesh; i++) {
        vertices.push(i % 200, Math.floor(i / 200));
        uvs.push((i % 200) / 200, 0.5);
    }
    const last = verticesPerMesh - 1;
    const mesh = { type: 'mesh', path: 'img', uvs, vertices, triangles: [0, 1, 2, last - 2, last - 1, last], hull: 4 };

    return {
        skeleton: JSON.stringify({
            skeleton: { spine: '4.2.0' },
            bones: [{ name: 'root' }],
            slots: [
                { name: 'a', bone: 'root', attachment: 'big' },
                { name: 'b', bone: 'root', attachment: 'big' },
            ],
            skins: [{ name: 'default', attachments: { a: { big: mesh }, b: { big: mesh } } }],
            animations: {},
        }),
        atlas: ['page.png', 'size: 64, 64', 'filter: Linear, Linear', 'img', 'bounds: 0, 0, 32, 32', ''].join('\n'),
    };
}

describe('the vertex template', () => {
    it('is built again once when the skin changes', async () => {
        const rig = await loadRig('4.2/mix-and-match-pro.skel');
        const { stats } = rig.view;

        step(rig, 0);
        const bare = stats.vertices;

        expect(stats.templateBuilds).toBe(1);
        rig.engine.setSkin(skinIndex(rig, 'full-skins/girl'));
        rig.engine.setupPoseSlots();
        play(rig, 'dance');
        for (let frame = 0; frame < 10; frame++) step(rig);
        expect(stats.templateBuilds).toBe(2);
        expect(stats.vertices).toBeGreaterThan(bare);
        expect(expectKernel(rig).length).toBeGreaterThan(10);
        // the buffers of the meshes hold the new data
        expect(vertexData(rig.view).positions.length).toBe(stats.vertices * 2);
        expect(stats.bufferBytes).toBe(
            stats.vertices * 24 + (meshes(rig.view)[0]?.geometry.indexBuffer.data.byteLength ?? 0),
        );
    });

    it('keeps drawing what a slot still shows of the skin before', async () => {
        const rig = await loadRig('4.2/mix-and-match-pro.skel');
        const { state } = rig.engine;
        const boy = skinIndex(rig, 'full-skins/boy');

        rig.engine.setSkin(skinIndex(rig, 'full-skins/girl'));
        rig.engine.setupPoseSlots();
        step(rig, 0);
        // as in the official runtime, a slot keeps an attachment the new skin has no match for
        rig.engine.setSkin(boy);
        const stale = state.attachments.filter(
            (attachment, slot) => attachment !== null && rig.lookup.find(boy, slot, attachment.name) !== attachment,
        );

        expect(stale.length).toBeGreaterThan(0);
        for (let frame = 0; frame < 3; frame++) step(rig);
        expect(rig.view.stats.templateBuilds).toBe(3);
        expectKernel(rig);
    });

    it('makes room for an attachment of another skin that is set on a slot', async () => {
        const rig = await loadRig('4.2/goblins-pro.skel');
        const { state } = rig.engine;
        const { stats } = rig.view;
        const girl = rig.model.skins[skinIndex(rig, 'goblingirl')];
        const foreign = girl?.attachments.find((item) => item.name === 'head');

        if (foreign === undefined) throw new Error('goblingirl has a head');
        step(rig, 0);
        const before = stats.vertices;

        state.attachments[foreign.slot] = foreign.attachment;
        drawPose(rig.view, state);
        expect(stats.templateBuilds).toBe(2);
        expect(stats.vertices).toBeGreaterThan(before);
        expect(expectKernel(rig).some((item) => item.attachment === foreign.attachment)).toBe(true);
        drawPose(rig.view, state);
        expect(stats.templateBuilds).toBe(2);
    });

    it.each(SPINE_VERSIONS)('lays out rotated regions, linked meshes and weights of a %s rig', async (version) => {
        const rig = await createRig(syntheticRig(version));

        for (const skin of [-1, skinIndex(rig, 'other')]) {
            rig.engine.setSkin(skin);
            rig.engine.setupPoseSlots();
            play(rig, 'deform');
            for (let frame = 0; frame < 12; frame++) {
                step(rig, 0.1);
                expectKernel(rig);
            }
        }
        expect(rig.view.stats.templateBuilds).toBe(2);
        // the clip of the rig ends at its own slot, which never ends it, and no slot after it draws
        expect(rig.view.stats).toMatchObject({ clips: 1, maskDraws: 0 });
    });

    it('keeps an attachment that cannot be drawn out of the picture, without building again', async () => {
        const files = fixtureFiles('4.2/raptor-pro.skel');
        const whole = await createRig(files);
        const { slot, mesh } = firstMesh(whole);
        const rig = await createRig(files, (model) => {
            const damaged = model.skins.flatMap((skin) => skin.attachments).find((item) => item.name === mesh.name);

            if (damaged?.attachment.type === 'mesh') damaged.attachment.triangles = new Uint16Array(0);
        });

        step(whole, 0);
        for (let frame = 0; frame < 3; frame++) step(rig, 0);
        expect(whole.engine.state.attachments[slot]).toBe(mesh);
        expect(rig.view.stats.templateBuilds).toBe(1);
        expect(rig.view.stats.indices).toBe(whole.view.stats.indices - mesh.triangles.length);
        expect(rig.view.stats.vertices).toBe(whole.view.stats.vertices - mesh.worldVerticesLength / 2);
    });

    it('uses 32-bit indices for more than 65,535 vertices', async () => {
        const small = await createRig(largeRig(30000));
        const large = await createRig(largeRig(40000));

        step(small, 0);
        step(large, 0);
        expect(meshes(small.view)[0]?.geometry.indexBuffer.data).toBeInstanceOf(Uint16Array);
        expect(meshes(large.view)[0]?.geometry.indexBuffer.data).toBeInstanceOf(Uint32Array);
        expect(large.view.stats.vertices).toBe(80000);
        expect(readDrawn(large).map((item) => item.first)).toEqual([0, 40000]);
        expect(Array.from(meshes(large.view)[0]?.geometry.indexBuffer.data ?? []).slice(6, 12)).toEqual([
            40000, 40001, 40002, 79997, 79998, 79999,
        ]);
    });
});

describe('what the view refuses', () => {
    it('names the region the atlas misses', async () => {
        const broken = loadRig('4.2/spineboy-pro.skel', (_model, atlas) => {
            atlas.regionNames[atlas.regionNames.indexOf('gun')] = 'gone';
        });

        await expect(broken).rejects.toThrow(MarrowError);
        await expect(broken).rejects.toThrow(/no region "gun" for the attachment "gun"/);
    });

    it('throws when a slot is set to an attachment whose region the atlas misses', async () => {
        const rig = await loadRig('4.2/goblins-pro.skel');
        const head = rig.model.skins[skinIndex(rig, 'goblingirl')]?.attachments.find((item) => item.name === 'head');

        step(rig, 0);
        if (head === undefined) throw new Error('goblingirl has a head');
        rig.atlas.regionNames[rig.atlas.regionNames.indexOf('goblingirl/head')] = 'gone';
        rig.engine.state.attachments[head.slot] = head.attachment;
        expect(() => drawPose(rig.view, rig.engine.state)).toThrow(/no region "goblingirl\/head"/);
        // the slot is not dropped without a word afterwards
        expect(() => drawPose(rig.view, rig.engine.state)).toThrow(/no region "goblingirl\/head"/);
        expect(rig.view.stats.templateBuilds).toBe(1);
        rig.engine.setupPoseSlots();
        drawPose(rig.view, rig.engine.state);
        expectKernel(rig);
    });

    it('wants one premultiplied texture per atlas page', async () => {
        const { model, atlas } = await loadRig('4.2/dragon-ess.skel');
        const straight = new Texture({
            source: new TextureSource({ width: 2, height: 2, alphaMode: 'no-premultiply-alpha' }),
        });
        const pages = atlas.pages.map(() => Texture.WHITE);

        expect(atlas.pages.length).toBeGreaterThan(1);
        expect(() => new SkeletonView(model, atlas, pages.slice(1))).toThrow(/pages and the view got/);
        expect(() => new SkeletonView(model, atlas, [straight, ...pages.slice(1)])).toThrow(/is not premultiplied/);
        expect(() => new SkeletonView(model, atlas, pages)).not.toThrow();
    });

    it('rejects a mesh whose triangles or texture coordinates do not fit its vertices', async () => {
        const files = fixtureFiles('4.2/raptor-pro.skel');
        const name = firstMesh(await createRig(files)).mesh.name;
        const damage = (change: (mesh: MeshAttachmentData) => void): Promise<Rig> =>
            createRig(files, (model) => {
                for (const { attachment } of model.skins.flatMap((skin) => skin.attachments)) {
                    if (attachment.type === 'mesh' && attachment.name === name) change(attachment);
                }
            });

        await expect(
            damage((mesh) => {
                mesh.triangles[0] = mesh.worldVerticesLength;
            }),
        ).rejects.toThrow(/points past its/);
        await expect(
            damage((mesh) => {
                mesh.regionUVs = mesh.regionUVs.subarray(2);
            }),
        ).rejects.toThrow(/texture coordinates/);
    });

    it('rejects a sequence index the attachment has no region for', async () => {
        const rig = await createRig(syntheticRig('4.2'));
        const flame = slotIndex(rig, 'flame');

        step(rig, 0);
        rig.engine.state.sequenceIndices[flame] = -7;
        expect(() => drawPose(rig.view, rig.engine.state)).toThrow(/has 3 sequence regions and no region -7/);
    });
});
