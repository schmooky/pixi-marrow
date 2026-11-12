import type { Buffer } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { isNewer, nextVersion, type PoseState, touchPose } from '../../src/pose/state';
import { weightBones } from '../../src/render/drafts';
import { loadMeshCode } from '../../src/render/mesh-code';
import { bonesMoved } from '../../src/render/pose-pass';
import { expectBatch, loadFamily, populate } from './batch-check';
import { expectClippedBatch } from './batch-clip-check';
import { batcherOf, createStage, elementOf, watchUploads } from './batch-stage';
import { type CoverSlot, coverRig, moveSlot } from './cover-rig';
import { expectKernel, loadRig, meshes, play, type Rig, slotIndex, step, visibleSlots } from './rig';

/*
 * A view does the work the stamps of a pose ask for. An engine sets the stamps. Here a test
 * writes a pose and stamps what it wrote, as the contract of `PoseState` says, and looks at
 * what the view did for it.
 */

/** Raises the version of a pose and stamps bones and slots with it, as an engine does for what it changed. */
function stamp(state: PoseState, bones: readonly number[] = [], slots: readonly number[] = []): void {
    state.version = nextVersion(state.version);
    for (const bone of bones) state.boneStamps[bone] = state.version;
    for (const slot of slots) state.slotStamps[slot] = state.version;
}

/** Moves a bone of a pose in world space, without its children: enough to see who follows. */
function nudge(state: PoseState, bone: number, by = 7.5): void {
    state.world[bone * 6 + 4] = (state.world[bone * 6 + 4] ?? 0) + by;
    state.world[bone * 6 + 5] = (state.world[bone * 6 + 5] ?? 0) - by / 2;
}

/** How often each vertex buffer of a view in the mesh mode was told to upload, from now on. */
function watchBuffers(rig: Rig): { positions: number; colors: number; uvs: number } {
    const counts = { positions: 0, colors: 0, uvs: 0 };
    const geometry = meshes(rig.view)[0]?.geometry;
    const watch = (buffer: Buffer | undefined, count: () => void): void => {
        if (buffer === undefined) throw new Error('the view has no mesh');
        const update = buffer.update.bind(buffer);

        buffer.update = (size?: number, offset?: number): void => {
            count();
            update(size, offset);
        };
    };

    watch(geometry?.getBuffer('aPosition'), () => counts.positions++);
    watch(geometry?.getBuffer('aColor'), () => counts.colors++);
    watch(geometry?.getBuffer('aUV'), () => counts.uvs++);

    return counts;
}

/**
 * A clip that cuts the slot after it, which lies across an edge of the polygon, and a slot
 * behind the end of the clip. Each slot has a bone of its own.
 */
const CLIPPED: readonly CoverSlot[] = [
    { name: 'clip', shows: 'big', as: 'clip', end: 'inside' },
    { name: 'inside', shows: 'mid', at: [0, -300] },
    { name: 'outside', shows: 'small', at: [300, 0] },
];

beforeAll(async () => {
    await loadMeshCode();
});

describe('a pose that did not change', () => {
    it('is no work for a view in the mesh mode: no vertex, no color, no upload', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        play(rig, 'walk');
        step(rig, 0.1);
        const { state } = rig.engine;
        const before = { ...rig.view.stats };
        const uploads = watchBuffers(rig);
        const positions = Float32Array.from(rig.view.parts.template.positions);

        for (let frame = 0; frame < 5; frame++) rig.view.update(state);
        expect(rig.view.stats).toEqual({ ...before, skips: before.skips + 5 });
        expect(uploads).toEqual({ positions: 0, colors: 0, uvs: 0 });
        expect(rig.view.parts.template.positions).toEqual(positions);
        expectKernel(rig);
        // a version that moved on is work again, also when no value changed
        stamp(state);
        rig.view.update(state);
        expect(rig.view.stats.skips).toBe(before.skips + 5);
        // no stamp is newer: nothing was placed, and nothing uploaded
        expect(rig.view.stats).toMatchObject({ placedSlots: 0, coloredSlots: 0 });
        expect(uploads).toEqual({ positions: 0, colors: 0, uvs: 0 });
    });

    it('is no work in a batch either, and Pixi is not told that the skeleton changed', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/spineboy-pro.skel');
        const rigs = await populate(stage, family, 3);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        for (const item of rigs) play(item, 'walk');
        for (const item of rigs) step(item, 0.1);
        stage.render();
        const uploads = watchUploads(batcherOf(rig.view));
        const { skips } = rig.view.stats;

        for (let frame = 0; frame < 4; frame++) {
            for (const item of rigs) item.view.update(item.engine.state);
            stage.render();
        }
        expect(rig.view.stats.skips).toBe(skips + 4);
        expect(uploads).toMatchObject({ positions: 0, statics: 0, indices: 0 });
        expect(elementOf(rig.view).dirty).toBe(false);
        expect(stage.counts.builds).toBe(1);
        expect(stage.counts.draws).toHaveLength(1);
        for (const item of rigs) expectBatch(item);
    });

    it('takes its vertices along when the display object moves, without placing them in the skeleton again', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/spineboy-pro.skel');
        const rigs = await populate(stage, family, 20);
        const [, rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        for (const item of rigs) step(item, 0.1);
        stage.render();
        const uploads = watchUploads(batcherOf(rig.view));
        const element = elementOf(rig.view);
        const { positionUploads, placedSlots } = rig.view.stats;
        const inSkeleton = Float32Array.from(rig.view.parts.template.positions);

        rig.view.container.position.set(120, -40);
        rig.view.container.scale.set(0.5);
        stage.render();
        // Pixi asked the pipe, which packed this skeleton alone: one stretch of the positions
        expect(uploads).toMatchObject({ positions: 1, statics: 0, indices: 0 });
        expect(uploads.positionBytes).toBe(element.attributeSize * 8);
        expect(rig.view.stats).toMatchObject({ positionUploads, placedSlots });
        expect(rig.view.parts.template.positions).toEqual(inSkeleton);
        for (const item of rigs) expectBatch(item);
        // and a tint of the display object is new colors in the batch, with no new position
        rig.view.container.tint = 0x8080ff;
        stage.render();
        expect(uploads).toMatchObject({ positions: 1, statics: 1 });
    });
});

describe('a pose of which a part changed', () => {
    it('places the slots of a bone that moved, and the meshes whose vertices hang on it', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        play(rig, 'walk');
        step(rig, 0.1);
        const { state } = rig.engine;
        const { bones } = rig.model.slots;
        const visible = visibleSlots(rig);
        const head = rig.model.bones.names.indexOf('head');
        const uploads = watchBuffers(rig);
        // who follows the head: slots on it, and weighted meshes with a vertex on it
        const followers = visible.filter(({ slot, attachment }) => {
            const source = rig.view.parts.template.sources[rig.view.parts.template.attachments.indexOf(attachment)];

            return source?.bones ? weightBones(source).includes(head) : bones[slot] === head;
        });

        nudge(state, head);
        stamp(state, [head]);
        rig.view.update(state);
        expect(followers.length).toBeGreaterThan(0);
        expect(followers.length).toBeLessThan(visible.length);
        expect(rig.view.stats).toMatchObject({ placedSlots: followers.length, coloredSlots: 0, skips: 0 });
        // the positions are those of the kernel for every slot, moved or not
        expectKernel(rig);
        expect(uploads).toEqual({ positions: 1, colors: 0, uvs: 0 });
        // a bone that no visible slot hangs on moves nothing
        const root = rig.model.bones.names.indexOf('root');

        stamp(state, [root]);
        rig.view.update(state);
        expect(rig.view.stats.placedSlots).toBe(0);
        expect(uploads.positions).toBe(1);
    });

    it('knows the bones of a weighted mesh once, and asks only them', async () => {
        const rig = await loadRig('4.2/raptor-pro.skel');
        const { template } = rig.view.parts;
        const entry = template.sources.findIndex((source) => source?.bones != null);
        const source = template.sources[entry];
        const { state } = rig.engine;

        if (source == null || source.bones === null) throw new Error('no weighted mesh');
        const list = weightBones(source);
        const others = [...Array(rig.model.bones.count).keys()].filter((bone) => !list.includes(bone));

        expect(weightBones(source)).toBe(list);
        // the layout holds the list of the entry, so that a pass looks nothing up
        expect(template.weights[entry]).toBe(list);
        expect(template.weights[template.sources.indexOf(null)]).toBeNull();
        expect(new Set(list).size).toBe(list.length);
        expect(list.length).toBeGreaterThan(1);
        const seen = state.version;

        stamp(state, others);
        expect(bonesMoved(state, list, template.slots[entry] ?? 0, seen)).toBe(false);
        stamp(state, [list[list.length - 1] ?? -1]);
        expect(bonesMoved(state, list, template.slots[entry] ?? 0, seen)).toBe(true);
        expect(isNewer(state.version, seen)).toBe(true);
    });

    it('writes colors for a slot whose color changed, and for no other', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        step(rig, 0.1);
        const { state } = rig.engine;
        const torso = slotIndex(rig, 'torso');
        const uploads = watchBuffers(rig);

        state.colors[torso * 4] = 0.25;
        stamp(state, [], [torso]);
        rig.view.update(state);
        // the slot is newer, so its vertices are placed too: an engine has one stamp per slot
        expect(rig.view.stats).toMatchObject({ placedSlots: 1, coloredSlots: 1 });
        expect(uploads).toEqual({ positions: 1, colors: 1, uvs: 0 });
        // a stamp without another color writes none
        stamp(state, [], [torso]);
        rig.view.update(state);
        expect(rig.view.stats).toMatchObject({ placedSlots: 1, coloredSlots: 0 });
        expect(uploads).toEqual({ positions: 2, colors: 1, uvs: 0 });
        expectKernel(rig);
    });

    it('makes the list of visible slots again for an attachment, an alpha that reaches 0 and the draw order', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        step(rig, 0.1);
        const { state } = rig.engine;
        const { indexRebuilds } = rig.view.stats;
        const head = rig.model.bones.names.indexOf('head');
        // two visible slots that follow each other in the draw order
        const [first, second] = visibleSlots(rig).map(({ slot }) => state.drawOrder.indexOf(slot));

        if (first === undefined || second === undefined) throw new Error('no two visible slots');
        nudge(state, head);
        stamp(state, [head]);
        rig.view.update(state);
        expect(rig.view.stats.indexRebuilds).toBe(indexRebuilds);
        [state.drawOrder[first], state.drawOrder[second]] = [state.drawOrder[second] ?? 0, state.drawOrder[first] ?? 0];
        state.version = nextVersion(state.version);
        state.drawOrderStamp = state.version;
        rig.view.update(state);
        expect(rig.view.stats).toMatchObject({ indexRebuilds: indexRebuilds + 1, placedSlots: 0 });
        expectKernel(rig);
        // a slot that hides: its stamp says so
        const torso = slotIndex(rig, 'torso');

        state.attachments[torso] = null;
        stamp(state, [], [torso]);
        rig.view.update(state);
        expect(rig.view.stats.indexRebuilds).toBe(indexRebuilds + 2);
        expect(visibleSlots(rig).some(({ slot }) => slot === torso)).toBe(false);
        expectKernel(rig);
    });

    it('leaves the list alone for a color that stays visible and for a deform, and makes it for an alpha of 0', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');

        step(rig, 0.1);
        const { state } = rig.engine;
        const { seen, pass } = rig.view.parts;
        const { indexRebuilds } = rig.view.stats;
        const head = slotIndex(rig, 'head');
        const count = visibleSlots(rig).length;
        // what the view asks before it lists: is the list of the pose another one than the one it holds
        const relists = (): boolean => seen.relists(rig.view.parts.template, state, pass.seen);

        // a color that changes and stays visible, and a deform: the slot is newer, the list is the same
        state.colors[head * 4] = 0.5;
        state.colors[head * 4 + 3] = 0.5;
        stamp(state, [], [head]);
        expect(relists()).toBe(false);
        rig.view.update(state);
        expect(rig.view.stats).toMatchObject({ indexRebuilds, coloredSlots: 1, placedSlots: 1 });
        expectKernel(rig);
        // an alpha of 0 hides the slot, and one above 0 shows it again
        state.colors[head * 4 + 3] = 0;
        stamp(state, [], [head]);
        expect(relists()).toBe(true);
        rig.view.update(state);
        expect(visibleSlots(rig)).toHaveLength(count - 1);
        expect(relists()).toBe(false);
        state.colors[head * 4 + 3] = 0.25;
        stamp(state, [], [head]);
        expect(relists()).toBe(true);
        rig.view.update(state);
        expect(visibleSlots(rig)).toHaveLength(count);
        expect(rig.view.stats.indexRebuilds).toBe(indexRebuilds + 2);
        expectKernel(rig);
        // the draw order alone
        state.version = nextVersion(state.version);
        state.drawOrderStamp = state.version;
        expect(relists()).toBe(true);
    });

    it('keeps what it knows about the alpha of its slots when a draw lays the vertex ranges out again', async () => {
        const rig = await coverRig([
            { name: 'small', shows: 'small' },
            { name: 'big', shows: 'big' },
        ]);
        const { state } = rig.engine;
        const { seen, pass } = rig.view.parts;
        const { stats } = rig.view;

        step(rig, 0);
        const { templateBuilds, indexRebuilds } = stats;

        // a draw to a target that moves edges: the cuts are taken back for the pose of the last update
        rig.view.beforeDraw(true);
        expect(stats.templateBuilds).toBe(templateBuilds + 1);
        // a slot that is newer and shows as before does not ask for the list again
        stamp(state, [], [0, 1]);
        expect(seen.relists(rig.view.parts.template, state, pass.seen)).toBe(false);
        rig.view.update(state);
        expect(stats.indexRebuilds).toBe(indexRebuilds + 1);
        expectKernel(rig);
    });

    it('shapes the mask of a clip again when the polygon moved, and not when a slot inside it did', async () => {
        const rig = await coverRig(CLIPPED);
        const { state } = rig.engine;
        const { stats } = rig.view;
        const bone = (name: string): number => rig.model.slots.bones[slotIndex(rig, name)] ?? -1;

        step(rig, 0);
        expect(stats).toMatchObject({ clips: 1, maskDraws: 2 });
        const { maskUploads } = stats;

        // a slot that no clip cuts, and one inside the clip: the mask is the polygon, which stays
        for (const name of ['outside', 'inside']) {
            nudge(state, bone(name));
            stamp(state, [bone(name)]);
            rig.view.update(state);
            expect(stats).toMatchObject({ maskUploads, placedSlots: 1 });
        }
        // the bone of the clip: the polygon moves, and no slot with it
        nudge(state, bone('clip'));
        stamp(state, [bone('clip')]);
        rig.view.update(state);
        expect(stats).toMatchObject({ maskUploads: maskUploads + 1, placedSlots: 0 });
        expectKernel(rig);
    });

    it('cuts the slots of a batch again when one inside a clip moved or the polygon did, and not for a slot outside', async () => {
        const stage = createStage();
        const rig = await coverRig(CLIPPED, { renderMode: 'batched' });
        const { state } = rig.engine;
        const bone = (name: string): number => rig.model.slots.bones[slotIndex(rig, name)] ?? -1;

        stage.root.addChild(rig.view.container);
        step(rig, 0);
        stage.render();
        expect(expectClippedBatch(rig).cut).toBeGreaterThan(0);
        const uploads = watchUploads(batcherOf(rig.view));
        const move = (name: string): void => {
            nudge(state, bone(name), 3);
            stamp(state, [bone(name)]);
            rig.view.update(state);
            stage.render();
        };

        // a slot that no clip cuts: its vertices are packed, and the cut triangles stay as they are
        move('outside');
        expect(uploads).toMatchObject({ positions: 1, indices: 0 });
        expectClippedBatch(rig);
        // a slot inside the clip, then the polygon: the triangles are cut again, with their indices
        move('inside');
        expect(uploads.indices).toBe(1);
        expectClippedBatch(rig);
        move('clip');
        expect(uploads.indices).toBe(2);
        expectClippedBatch(rig);
        expect(stage.counts.builds).toBe(1);
    });

    it('packs and uploads the one skeleton of a batch that moved', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/spineboy-pro.skel');
        const rigs = await populate(stage, family, 20);
        const rig = rigs[7];

        if (rig === undefined) throw new Error('no rig');
        for (const item of rigs) step(item, 0.1);
        stage.render();
        const uploads = watchUploads(batcherOf(rig.view));
        const element = elementOf(rig.view);
        const head = rig.model.bones.names.indexOf('head');
        const { state } = rig.engine;

        nudge(state, head);
        stamp(state, [head]);
        for (const item of rigs) item.view.update(item.engine.state);
        stage.render();
        // one upload, of the vertices between the first and the last slot that moved
        expect(uploads).toMatchObject({ positions: 1, statics: 0, indices: 0 });
        expect(uploads.positionBytes).toBeLessThan(element.attributeSize * 8);
        expect(uploads.positionBytes).toBeGreaterThan(0);
        expect(rig.view.stats.placedSlots).toBeLessThan(visibleSlots(rig).length);
        expect(stage.counts.builds).toBe(1);
        for (const item of rigs) expectBatch(item);
        // the whole pose again, as code that tracks nothing must say it
        touchPose(state);
        rig.view.update(state);
        stage.render();
        expect(rig.view.stats.placedSlots).toBe(visibleSlots(rig).length);
        expect(uploads.positions).toBe(2);
        expectBatch(rig);
    });
});

describe('what a view at rest still does', () => {
    it('keeps looking for covered slots until one search has run on the pose, and then stops', async () => {
        const rig = await coverRig([
            { name: 'small', shows: 'small' },
            { name: 'big', shows: 'big' },
        ]);
        const { state } = rig.engine;
        let updates = 0;

        // the first update searches, and the pose it searched owes nothing
        step(rig, 0);
        expect(rig.view.stats.coveredSlots).toBe(1);
        rig.view.update(state);
        expect(rig.view.stats.skips).toBe(1);
        // the small slot leaves and comes back: the next search is some updates away
        moveSlot(rig, 'small', 600, 0);
        step(rig, 0);
        expect(rig.view.stats.coveredSlots).toBe(0);
        moveSlot(rig, 'small', 0, 0);
        step(rig, 0);
        expect(rig.view.stats).toMatchObject({ coveredSlots: 0, skips: 1 });
        // the same pose again and again: the view keeps asking until that search has run
        while (rig.view.stats.coveredSlots === 0 && updates < 100) {
            rig.view.update(state);
            updates++;
        }
        expect(rig.view.stats).toMatchObject({ coveredSlots: 1, skips: 1 });
        expect(updates).toBeGreaterThan(0);
        expect(updates).toBeLessThan(70);
        for (let frame = 0; frame < 5; frame++) rig.view.update(state);
        expect(rig.view.stats).toMatchObject({ coveredSlots: 1, skips: 6 });
    });

    it('cuts nothing again for a clip in a batch whose skeleton rests', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/coin-pro.skel');
        const rigs = await populate(stage, family, 2);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        for (const item of rigs) play(item, 'animation');
        for (let frame = 0; frame < 30; frame++) {
            for (const item of rigs) step(item, 0.05);
            stage.render();
        }
        const uploads = watchUploads(batcherOf(rig.view));
        const element = elementOf(rig.view);
        const held = expectClippedBatch(rig);

        expect(held.cut).toBeGreaterThan(0);
        for (let frame = 0; frame < 3; frame++) {
            for (const item of rigs) item.view.update(item.engine.state);
            stage.render();
        }
        expect(uploads).toMatchObject({ positions: 0, statics: 0, indices: 0 });
        expect(element.clipPlaced).toBe(true);
        expect(expectClippedBatch(rig)).toEqual(held);
        // a move of the display object cuts again: the batch holds the cut triangles where it was
        rig.view.container.x += 64;
        stage.render();
        expect(uploads.positions).toBeGreaterThan(0);
        expect(expectClippedBatch(rig)).toEqual(held);
    });
});
