import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { meshSource } from '../../src/pose/shared/lookup';
import { nextVersion, touchPose } from '../../src/pose/state';
import { SkeletonView } from '../../src/render/skeleton-view';
import { listFixtures } from '../parity/fixtures';
import { type CoverSlot, coverRig, moveSlot } from './cover-rig';
import {
    createRig,
    drawPose,
    fixtureFiles,
    kernelPositions,
    meshes,
    play,
    type Rig,
    readDrawn,
    redraw,
    slotIndex,
    step,
} from './rig';
import { expectSkinned, loadSkinned, placedByCpu, skinData, watchUpdates } from './skin-check';

/*
 * `skinning: 'gpu'` in the mesh mode: the vertex shader places what hangs on bones alone, from
 * the bone matrices of the pose, and a palette holds the colors of the slots. The tests play the
 * vertex shader in JavaScript from what the view hands Pixi, see `skin-check.ts`, and hold it
 * against the geometry kernel. The render check draws it in a browser.
 */

/** The animations of a rig, up to a count. */
const animationsOf = (rig: Rig, count: number): string[] =>
    rig.model.animations.slice(0, count).map((animation) => animation.name);

/** Whether the vertex shader can place an attachment: anything but a region with a sequence. */
const placeable = (rig: Rig, slot: number): boolean => {
    const attachment = rig.engine.state.attachments[slot];

    return attachment?.type === 'mesh' || (attachment?.type === 'region' && attachment.sequence === null);
};

describe('skinning on the GPU', () => {
    // every official export: both formats of every version
    it.each(listFixtures().map((fixture) => fixture.id))('places what %s shows as the kernel does', async (id) => {
        const rig = await loadSkinned(id);
        let gpu = 0;

        // a rig of several skins shows little with the default skin alone
        if (rig.model.skins.length > 1) {
            rig.engine.setSkin(rig.model.skins.length - 1);
            rig.engine.setupPoseSlots();
        }
        for (const animation of animationsOf(rig, 3)) {
            play(rig, animation);
            for (let frame = 0; frame < 4; frame++) {
                step(rig, 0.1);
                for (const item of expectSkinned(rig)) {
                    const deformed = (rig.engine.state.deformLengths[item.slot] ?? 0) > 0;

                    expect(item.cpu, `who places slot ${rig.model.slots.names[item.slot]}`).toBe(
                        deformed || !placeable(rig, item.slot),
                    );
                    if (!item.cpu) gpu++;
                }
            }
        }
        expect(gpu).toBeGreaterThan(0);
    });

    it('takes a weighted mesh with more than 4 bones a vertex as it is', async () => {
        const rig = await loadSkinned('4.3/sack-pro.skel');

        step(rig, 0);
        const { skin } = skinData(rig);
        let most = 0;

        for (let v = 1; v < skin.length; v += 2) most = Math.max(most, (skin[v] ?? 0) & 0xffff);
        expect(most).toBeGreaterThan(4);
        expect(expectSkinned(rig).some((item) => !item.cpu)).toBe(true);
    });

    it('uploads the bones, and positions only for the regions with a sequence', async () => {
        const rig = await loadSkinned('4.2/dragon-ess.skel');
        const { stats } = rig.view;

        play(rig, 'flying');
        step(rig, 0);
        const data = skinData(rig);
        const geometry = meshes(rig.view)[0]?.geometry;
        const positions = watchUpdates(geometry?.getBuffer('aPosition') ?? data.sources.palette);
        const bones = watchUpdates(data.sources.bones);
        const sequences = readDrawn(rig).filter((item) => item.attachment.sequence !== null).length;
        const before = stats.positionUploads;

        expect(sequences).toBeGreaterThan(0);
        for (let frame = 0; frame < 10; frame++) {
            step(rig);
            expectSkinned(rig);
            expect(stats.placedSlots).toBeLessThanOrEqual(sequences);
        }
        // one upload of the bones per frame, of the stretch from the first bone that moved to the last
        expect(bones).toHaveLength(10);
        for (const [start = 0, end = 0] of bones) expect(end - start).toBeLessThanOrEqual(data.bones.length / 4);
        expect(positions).toHaveLength(stats.positionUploads - before);
        expect(geometry?.getAttribute('aColor')).toBeUndefined();
    });

    it('uploads the bones alone for a rig of regions without a sequence', async () => {
        const rig = await loadSkinned('4.2/speedy-ess.skel');
        const { stats } = rig.view;

        play(rig, animationsOf(rig, 1)[0] ?? '');
        step(rig, 0);
        const positions = watchUpdates(meshes(rig.view)[0]?.geometry.getBuffer('aPosition') ?? { update: () => {} });
        const bones = watchUpdates(skinData(rig).sources.bones);
        const before = { ...stats };

        for (let frame = 0; frame < 20; frame++) {
            step(rig);
            expect(stats.placedSlots).toBe(0);
        }
        expectSkinned(rig);
        expect(positions).toEqual([]);
        expect(bones.length).toBeGreaterThan(10);
        expect(stats.boneUploads - before.boneUploads).toBe(bones.length);
        expect(stats.positionUploads).toBe(before.positionUploads);
    });

    it('writes a color key to the palette of its slot, and nothing else', async () => {
        const rig = await loadSkinned('4.2/spineboy-pro.skel');
        const { state } = rig.engine;
        const head = slotIndex(rig, 'head');

        step(rig, 0);
        const data = skinData(rig);
        const palette = watchUpdates(data.sources.palette);
        const bones = watchUpdates(data.sources.bones);
        const positions = watchUpdates(meshes(rig.view)[0]?.geometry.getBuffer('aPosition') ?? data.sources.bones);

        state.colors.set([0.5, 0.25, 1, 0.75], head * 4);
        state.version = nextVersion(state.version);
        state.slotStamps[head] = state.version;
        rig.view.update(state);
        expect(palette).toEqual([[head * 2, head * 2 + 2]]);
        expect(bones).toEqual([]);
        expect(positions).toEqual([]);
        expect(rig.view.stats.coloredSlots).toBe(1);
        expect(Array.from(data.palette.subarray(head * 8, head * 8 + 4))).toEqual([127, 63, 255, 191]);
        expectSkinned(rig);
        // the same bytes again: nothing to write
        touchPose(state);
        rig.view.update(state);
        expect(palette).toHaveLength(1);
    });

    it('writes the palette of a slot that shows another attachment, with its own color', async () => {
        const rig = await createRig(
            fixtureFiles('4.2/spineboy-pro.skel'),
            (model) => {
                for (const { name, attachment } of model.skins.flatMap((skin) => skin.attachments)) {
                    if (name === 'eye-surprised' && 'color' in attachment) attachment.color.set([0.5, 0.5, 0.5, 1]);
                }
            },
            { options: () => ({ renderMode: 'mesh', skinning: 'gpu' }) },
        );
        const { state } = rig.engine;
        const eye = slotIndex(rig, 'eye');
        const other = rig.lookup.find(state.skin, eye, 'eye-surprised');

        if (other === undefined) throw new Error('spineboy has a second eye');
        step(rig, 0);
        expect(Array.from(skinData(rig).palette.subarray(eye * 8, eye * 8 + 4))).toEqual([255, 255, 255, 255]);
        state.attachments[eye] = other;
        drawPose(rig.view, state);
        expect(Array.from(skinData(rig).palette.subarray(eye * 8, eye * 8 + 4))).toEqual([127, 127, 127, 255]);
        expectSkinned(rig);
    });

    it('places a mesh with a deform on the CPU, and in the shader again once the deform is gone', async () => {
        const rig = await loadSkinned('4.2/spineboy-pro.skel');
        const { state } = rig.engine;

        step(rig, 0);
        const item = readDrawn(rig).find((drawn) => drawn.attachment.type === 'mesh');

        if (item === undefined || item.attachment.type !== 'mesh') throw new Error('spineboy shows a mesh');
        const source = meshSource(rig.lookup, item.attachment);
        const length = source.bones === null ? source.vertices.length : (source.vertices.length / 3) * 2;
        const deform = new Float64Array(length).map((_, i) =>
            source.bones === null ? (source.vertices[i] ?? 0) + 3 : 3,
        );

        state.deform[item.slot] = deform;
        state.deformLengths[item.slot] = length;
        drawPose(rig.view, state);
        expect(placedByCpu(skinData(rig), item.slot)).toBe(true);
        expect(expectSkinned(rig).find((drawn) => drawn.slot === item.slot)?.cpu).toBe(true);
        state.deformLengths[item.slot] = 0;
        drawPose(rig.view, state);
        expect(placedByCpu(skinData(rig), item.slot)).toBe(false);
        expect(expectSkinned(rig).find((drawn) => drawn.slot === item.slot)?.cpu).toBe(false);
    });

    it('counts a deform that stops as a move, so the bounds follow it although no bone moved', async () => {
        const gpu = await loadSkinned('4.2/spineboy-pro.skel');
        const cpu = await loadSkinned('4.2/spineboy-pro.skel', () => ({ skinning: 'cpu' }));
        const box = (rig: Rig): number[] => {
            const bounds = meshes(rig.view)[0]?.geometry.bounds;

            return [bounds?.minX ?? 0, bounds?.minY ?? 0, bounds?.maxX ?? 0, bounds?.maxY ?? 0];
        };
        // the engine stamps the slot alone when a deform ends: the setup pose of the slots does that
        const touch = (rig: Rig, slot: number): void => {
            const { state } = rig.engine;

            state.version = nextVersion(state.version);
            state.slotStamps[slot] = state.version;
            rig.view.update(state);
        };

        for (const rig of [gpu, cpu]) step(rig, 0);
        const item = readDrawn(gpu).find((drawn) => drawn.attachment.type === 'mesh');

        if (item === undefined || item.attachment.type !== 'mesh') throw new Error('no mesh');
        const source = meshSource(gpu.lookup, item.attachment);
        const length = source.bones === null ? source.vertices.length : (source.vertices.length / 3) * 2;

        for (const rig of [gpu, cpu]) {
            rig.engine.state.deform[item.slot] = new Float64Array(length).map((_, i) =>
                source.bones === null ? (source.vertices[i] ?? 0) + 5000 : 5000,
            );
            rig.engine.state.deformLengths[item.slot] = length;
            touch(rig, item.slot);
        }
        expect(box(gpu)).toEqual(box(cpu));
        for (const rig of [gpu, cpu]) {
            rig.engine.state.deformLengths[item.slot] = 0;
            touch(rig, item.slot);
        }
        expect(box(gpu)).toEqual(box(cpu));
    });

    it('reads no skin data of an old layout in a batch, after a skin change laid the view out again', async () => {
        const rig = await loadSkinned('4.2/goblins-pro.skel');

        step(rig, 0);
        step(rig, 0.1);
        rig.view.renderMode = 'batched';
        step(rig, 0.1);
        rig.engine.setSkin(rig.model.skins.findIndex((skin) => skin.name === 'goblin'));
        rig.engine.setupPoseSlots();
        step(rig, 0.1);
        expect(() => rig.view.container.getBounds()).not.toThrow();
        expect(() => rig.view.parts).not.toThrow();
    });

    it('shares the skin data of a layout between views and frees it with the last one', async () => {
        const rig = await loadSkinned('4.2/raptor-pro.skel');
        const textures = rig.atlas.pages.map(() => new Texture({ source: new TextureSource({ width: 1, height: 1 }) }));
        const other = new SkeletonView(rig.model, rig.atlas, textures, { renderMode: 'mesh', skinning: 'gpu' });

        step(rig, 0);
        other.update(rig.engine.state);
        const [mine, theirs] = [rig.view, other].map((view) => meshes(view)[0]?.shader?.resources);

        const influences = mine?.uInfluences;
        const bones = mine?.uBones;

        expect(influences).toBeDefined();
        expect(influences).toBe(theirs?.uInfluences);
        expect(bones).not.toBe(theirs?.uBones);
        other.destroy();
        expect(influences.destroyed).toBe(false);
        rig.view.destroy();
        expect(influences.destroyed).toBe(true);
        expect(bones.destroyed).toBe(true);
    });

    it('takes the skin data of the new layout when a skin change lays the view out again', async () => {
        const rig = await loadSkinned('4.2/goblins-pro.skel');

        step(rig, 0);
        const before = skinData(rig).sources.influences;
        const builds = rig.view.stats.templateBuilds;

        rig.engine.setSkin(rig.model.skins.findIndex((skin) => skin.name === 'goblingirl'));
        rig.engine.setupPoseSlots();
        play(rig, 'walk');
        step(rig, 0.2);
        expect(rig.view.stats.templateBuilds).toBe(builds + 1);
        const after = skinData(rig).sources.influences;

        expect(after).not.toBe(before);
        // no other view held the layout before, so its data is freed
        expect(before.destroyed).toBe(true);
        for (const mesh of meshes(rig.view)) expect(mesh.shader?.resources.uInfluences).toBe(after);
        expect(expectSkinned(rig).some((item) => !item.cpu)).toBe(true);
    });

    it('draws in a batch and with meshes again when the render mode changes at run time', async () => {
        const rig = await loadSkinned('4.2/tank-pro.skel');

        play(rig, 'drive');
        step(rig);
        expectSkinned(rig);
        for (const mode of ['batched', 'mesh', 'batched', 'mesh'] as const) {
            rig.view.renderMode = mode;
            step(rig);
            expect(rig.view.stats.renderMode).toBe(mode);
            // a palette holds the colors in the mesh mode, and a batch the colors of its entries
            expect(rig.view.parts.template.colors).toHaveLength(0);
        }
        expectSkinned(rig);
    });

    it('places on the CPU what code on the CPU reads: the bounds and the template of the debug overlays', async () => {
        const rig = await loadSkinned('4.2/raptor-pro.skel');
        const cpu = await loadSkinned('4.2/raptor-pro.skel', () => ({ skinning: 'cpu' }));

        for (const item of [rig, cpu]) {
            play(item, 'walk');
            step(item, 0.4);
        }
        const bounds = (of: Rig): number[] => {
            const box = meshes(of.view)[0]?.geometry.bounds;

            return [box?.minX ?? 0, box?.minY ?? 0, box?.maxX ?? 0, box?.maxY ?? 0];
        };

        expect(bounds(rig)).toEqual(bounds(cpu));
        const { template } = rig.view.parts;

        for (const item of readDrawn(rig)) {
            const expected = kernelPositions(rig, item.slot, item.attachment);

            expect(template.positions.subarray(item.first * 2, item.first * 2 + expected.length)).toEqual(expected);
        }
    });

    it('places every vertex on the CPU for the search of covered slots, and uploads none of them', async () => {
        const behind: readonly CoverSlot[] = [
            { name: 'small', shows: 'small' },
            { name: 'big', shows: 'big' },
        ];
        const rig = await coverRig(behind, { skinning: 'gpu' });
        const { state } = rig.engine;

        redraw(rig);
        expect(rig.view.stats.coveredSlots).toBe(1);
        const positions = watchUpdates(meshes(rig.view)[0]?.geometry.getBuffer('aPosition') ?? { update: () => {} });

        // the small slot moves out from behind the big one
        moveSlot(rig, 'small', 300, 0);
        for (let frame = 0; frame < 40 && rig.view.stats.coveredSlots > 0; frame++) drawPose(rig.view, state);
        expect(rig.view.stats.coveredSlots).toBe(0);
        expect(positions).toEqual([]);
        expect(expectSkinned(rig).map((item) => item.cpu)).toEqual([false, false]);
    });
});
