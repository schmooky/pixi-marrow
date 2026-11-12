import { type Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { touchPose } from '../../src/pose/state';
import { loadAttachCode } from '../../src/render/attach-code';
import { ViewInserts } from '../../src/render/attach-work';
import { RUN_PAD } from '../../src/render/batch-layout';
import { loadMeshCode } from '../../src/render/mesh-code';
import type { DrawMode } from '../../src/render/stats';
import { batcherOf, bodyOf, createStage, elementOf, type Stage } from './batch-stage';
import { type CoverSlot, coverRig, slotOf } from './cover-rig';
import { meshes, type Rig, redraw, step } from './rig';

/*
 * Containers between the slots of a view, in both render modes. The rigs are made by hand:
 * every slot shows a small square on a bone of its own, so a batch of the skeleton has 6
 * indices per slot, and a test can say which slots a draw call holds.
 */

/** Four slots that lie apart, in this draw order. */
const SLOTS: readonly CoverSlot[] = [
    { name: 'a', shows: 'small', at: [0, 0] },
    { name: 'b', shows: 'small', at: [100, 0] },
    { name: 'c', shows: 'small', at: [200, 0] },
    { name: 'd', shows: 'small', at: [300, 0] },
];

/** The indices of one slot in a batch: a quad. */
const QUAD = 6;

/** The room of a run that holds some slots: their quads and the triangle without area that ends every run. */
const run = (slots: number): number => slots * QUAD + RUN_PAD;

/** A Pixi object that draws: a mesh of one triangle. The stage of these tests notes it as a mesh. */
function drawable(label: string): Mesh {
    const geometry = new MeshGeometry({
        positions: new Float32Array([0, 0, 10, 0, 10, 10]),
        uvs: new Float32Array(6),
        indices: new Uint32Array([0, 1, 2]),
    });

    return new Mesh({ geometry, texture: Texture.WHITE, label });
}

/** A rig on a stage, with the object that places containers in its view. */
interface Scene {
    stage: Stage;
    rig: Rig;
    inserts: ViewInserts;
    /** One more frame of the same pose, rendered. */
    frame(): void;
    /** What the children of the view draw, in order: `skeleton` for its own, else the label of a container. */
    order(): string[];
    /** The indices of every draw call of the skeleton in the batched mode, without its triangles that have no area. */
    sizes(): number[];
}

async function scene(renderMode: DrawMode, slots: readonly CoverSlot[] = SLOTS): Promise<Scene> {
    const stage = createStage();
    const rig = await coverRig(slots, { renderMode, occlusion: 'off' });
    const inserts = new ViewInserts(rig.view);
    const own = (child: Container): boolean => child.label.startsWith('marrow-');

    stage.root.addChild(rig.view.container);

    return {
        stage,
        rig,
        inserts,
        frame(): void {
            redraw(rig);
            stage.render();
        },
        order: () =>
            rig.view.container.children
                .filter((child) => child.visible && child.label !== 'marrow-probe')
                .map((child) => (own(child) ? 'skeleton' : child.label)),
        sizes: () =>
            stage.counts.draws
                .filter((draw) => draw.kind === 'batch')
                .map((draw) => {
                    const indices = batcherOf(rig.view).indexBuffer;
                    let drawn = 0;

                    for (let at = draw.start; at < draw.start + draw.size; at += 3) {
                        const [a = 0, b = 0, c = 0] = indices.subarray(at, at + 3);

                        if (a !== b || b !== c) drawn += 3;
                    }

                    return drawn;
                }),
    };
}

/** Lets go of the containers and destroys the view, as a display object does. */
function close({ rig, inserts }: Scene): void {
    inserts.clear();
    rig.view.destroy();
}

beforeAll(async () => {
    await Promise.all([loadAttachCode(), loadMeshCode()]);
});

describe('a view without a container', () => {
    it('has no list of cuts of its own, and its batch element no parts', async () => {
        const stage = createStage();
        const [first, second] = [
            await coverRig(SLOTS, { renderMode: 'batched' }),
            await coverRig(SLOTS, { renderMode: 'batched' }),
        ];

        for (const rig of [first, second]) {
            stage.root.addChild(rig.view.container);
            redraw(rig);
        }
        stage.render();
        const { seen } = first.view.parts;

        expect(first.view.inserts).toBeUndefined();
        expect(seen.cutCount).toBe(0);
        // the empty lists are shared by every view: a view pays no array for what it does not use
        expect(seen.cuts).toHaveLength(0);
        expect(seen.cuts).toBe(second.view.parts.seen.cuts);
        expect(seen.starts).toBe(second.view.parts.seen.starts);
        expect(elementOf(first.view).partRuns).toEqual([]);
        // both skeletons share one draw call
        expect(stage.counts.draws).toHaveLength(1);
        for (const rig of [first, second]) rig.view.destroy();
    });
});

describe.each(['batched', 'mesh'] as const)('containers between the slots of a view in the %s mode', (renderMode) => {
    const batched = renderMode === 'batched';

    it('draws a container after its slot and before the next one', async () => {
        const made = await scene(renderMode);
        const { stage, rig, inserts } = made;
        const label = drawable('label');

        made.frame();
        expect(stage.counts.draws).toHaveLength(1);
        inserts.add(slotOf(rig, 'b'), label);
        expect(label.parent).toBe(rig.view.container);
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'label', 'skeleton']);
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual([
            batched ? 'batch' : 'mesh',
            'mesh',
            batched ? 'batch' : 'mesh',
        ]);
        // a and b before the container, c and d behind it
        if (batched) expect(made.sizes()).toEqual([2 * QUAD, 2 * QUAD]);
        expect(rig.view.parts.seen.cutCount).toBe(1);
        expect(rig.view.parts.seen.cuts[0]).toBe(2);
        expect(rig.view.stats.drawCalls).toBe(2);
        close(made);
    });

    it('builds no instructions again while the slot stays where it is, and rests with the pose', async () => {
        const made = await scene(renderMode);
        const { stage, rig, inserts } = made;

        inserts.add(slotOf(rig, 'b'), drawable('label'));
        made.frame();
        const { builds } = stage.counts;

        for (let frame = 0; frame < 6; frame++) made.frame();
        expect(stage.counts.builds).toBe(builds);
        // a pose that did not change is no work, with a container as without
        step(rig, 0);
        const { skips } = rig.view.stats;

        step(rig, 0);
        stage.render();
        expect(rig.view.stats.skips).toBe(skips + 1);
        expect(stage.counts.builds).toBe(builds);
        close(made);
    });

    it('draws a container at the start and at the end without an empty draw call around it', async () => {
        const made = await scene(renderMode);
        const { stage, rig, inserts } = made;
        const { state } = rig.engine;
        const [first, last] = [drawable('first'), drawable('last')];

        // a slot that shows nothing still has its place in the draw order
        state.attachments[slotOf(rig, 'a')] = null;
        inserts.add(slotOf(rig, 'a'), first);
        inserts.add(slotOf(rig, 'd'), last);
        made.frame();
        expect(made.order().filter((name) => name !== 'skeleton')).toEqual(['first', 'last']);
        expect([...rig.view.parts.seen.cuts.subarray(0, 2)]).toEqual([0, 3]);
        // the first container, the slots b, c and d in one draw call, the last container
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['mesh', batched ? 'batch' : 'mesh', 'mesh']);
        if (batched) expect(made.sizes()).toEqual([3 * QUAD]);
        close(made);
    });

    it('keeps two containers in the draw order when their slots change places', async () => {
        const made = await scene(renderMode);
        const { stage, rig, inserts } = made;
        const { state } = rig.engine;
        const [b, c] = [slotOf(rig, 'b'), slotOf(rig, 'c')];

        inserts.add(b, drawable('on-b'));
        inserts.add(c, drawable('on-c'));
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'on-b', 'skeleton', 'on-c', 'skeleton']);
        expect(stage.counts.draws).toHaveLength(5);
        if (batched) expect(made.sizes()).toEqual([2 * QUAD, QUAD, QUAD]);
        const { builds } = stage.counts;

        // the draw order a, c, b, d
        state.drawOrder.set([slotOf(rig, 'a'), c, b, slotOf(rig, 'd')]);
        touchPose(state);
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'on-c', 'skeleton', 'on-b', 'skeleton']);
        expect(inserts.ordered.map((container) => container.label)).toEqual(['on-c', 'on-b']);
        expect(stage.counts.draws).toHaveLength(5);
        // the containers changed places among the children: Pixi builds once
        expect(stage.counts.builds).toBe(builds + 1);
        for (let frame = 0; frame < 4; frame++) made.frame();
        expect(stage.counts.builds).toBe(builds + 1);
        close(made);
    });

    it('moves no child when a slot moves in the draw order without crossing a container', async () => {
        const made = await scene(renderMode);
        const { stage, rig, inserts } = made;
        const { state } = rig.engine;

        inserts.add(slotOf(rig, 'b'), drawable('label'));
        made.frame();
        const { builds } = stage.counts;

        // d goes in front of c: both are behind the container, before and after
        state.drawOrder.set([slotOf(rig, 'a'), slotOf(rig, 'b'), slotOf(rig, 'd'), slotOf(rig, 'c')]);
        touchPose(state);
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'label', 'skeleton']);
        expect(stage.counts.builds).toBe(builds);
        // a goes behind the container: one slot before it, three behind, and still no child moved
        state.drawOrder.set([slotOf(rig, 'b'), slotOf(rig, 'a'), slotOf(rig, 'd'), slotOf(rig, 'c')]);
        touchPose(state);
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'label', 'skeleton']);
        if (batched) expect(made.sizes()).toEqual([QUAD, 3 * QUAD]);
        expect(stage.counts.builds).toBe(builds);
        close(made);
    });

    it('draws two containers one after the other when nothing shows between them', async () => {
        const made = await scene(renderMode);
        const { stage, rig, inserts } = made;
        const { state } = rig.engine;

        inserts.add(slotOf(rig, 'b'), drawable('on-b'));
        inserts.add(slotOf(rig, 'c'), drawable('on-c'));
        state.attachments[slotOf(rig, 'c')] = null;
        made.frame();
        expect(made.order().filter((name) => name !== 'skeleton')).toEqual(['on-b', 'on-c']);
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual([
            batched ? 'batch' : 'mesh',
            'mesh',
            'mesh',
            batched ? 'batch' : 'mesh',
        ]);
        if (batched) expect(made.sizes()).toEqual([2 * QUAD, QUAD]);
        close(made);
    });

    it('draws the skeleton in one piece again when the container is let go of', async () => {
        const made = await scene(renderMode);
        const { stage, rig, inserts } = made;
        const [label, other] = [drawable('label'), drawable('other')];

        inserts.add(slotOf(rig, 'b'), label);
        inserts.add(slotOf(rig, 'c'), other);
        made.frame();
        expect(stage.counts.draws).toHaveLength(5);
        inserts.remove(label);
        expect(label.parent).toBeNull();
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'other', 'skeleton']);
        if (batched) expect(made.sizes()).toEqual([3 * QUAD, QUAD]);
        inserts.remove(other);
        // a container that is not held is no error
        inserts.remove(other);
        made.frame();
        expect(made.order()).toEqual(['skeleton']);
        expect(stage.counts.draws).toHaveLength(1);
        expect(rig.view.parts.seen.cutCount).toBe(0);
        // and it can come back
        inserts.add(slotOf(rig, 'a'), label);
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'label', 'skeleton']);
        if (batched) expect(made.sizes()).toEqual([QUAD, 3 * QUAD]);
        close(made);
    });

    it('lets go of every container before the view is destroyed', async () => {
        const made = await scene(renderMode);
        const { rig, inserts } = made;
        const [label, other] = [drawable('label'), drawable('other')];

        inserts.add(slotOf(rig, 'a'), label);
        inserts.add(slotOf(rig, 'c'), other);
        made.frame();
        inserts.clear();
        expect([label.parent, other.parent]).toEqual([null, null]);
        expect(inserts.containers).toEqual([]);
        rig.view.destroy();
        expect([label.destroyed, other.destroyed]).toEqual([false, false]);
    });
});

describe('a container in a view that changes its render mode', () => {
    it('keeps its place in the draw order from one mode to the other and back', async () => {
        const made = await scene('batched');
        const { stage, rig, inserts } = made;

        inserts.add(slotOf(rig, 'b'), drawable('on-b'));
        inserts.add(slotOf(rig, 'c'), drawable('on-c'));
        made.frame();
        expect(made.order()).toEqual(['skeleton', 'on-b', 'skeleton', 'on-c', 'skeleton']);
        rig.view.renderMode = 'mesh';
        made.frame();
        expect(rig.view.stats.renderMode).toBe('mesh');
        expect(bodyOf(rig.view)?.visible).toBe(false);
        expect(made.order()).toEqual(['skeleton', 'on-b', 'skeleton', 'on-c', 'skeleton']);
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['mesh', 'mesh', 'mesh', 'mesh', 'mesh']);
        rig.view.renderMode = 'batched';
        made.frame();
        expect(rig.view.stats.renderMode).toBe('batched');
        expect(made.order()).toEqual(['skeleton', 'on-b', 'skeleton', 'on-c', 'skeleton']);
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch', 'mesh', 'batch', 'mesh', 'batch']);
        expect(made.sizes()).toEqual([2 * QUAD, QUAD, QUAD]);
        close(made);
    });
});

describe('the room of a skeleton in a batch', () => {
    it('keeps its vertices and its place with a container, and grows by the end of one run per container', async () => {
        const made = await scene('batched');
        const { stage, rig, inserts } = made;

        made.frame();
        const element = elementOf(rig.view);
        const room = { vertices: element.attributeSize, indices: element.indexSize, start: element._indexStart };

        inserts.add(slotOf(rig, 'b'), drawable('on-b'));
        inserts.add(slotOf(rig, 'c'), drawable('on-c'));
        made.frame();
        // every run ends with a triangle without area, and a container ends a run
        expect({ vertices: element.attributeSize, indices: element.indexSize, start: element._indexStart }).toEqual({
            ...room,
            indices: room.indices + 2 * RUN_PAD,
        });
        // three runs, of which the body adds the first and every tail one
        expect(element.runs).toBe(3);
        expect(element.partRuns).toEqual([1, 2]);
        expect(element.runSizes.slice(0, 3)).toEqual([run(2), run(1), run(1)]);
        // the room stays what it is from frame to frame, also when a slot crosses a container
        const { state } = rig.engine;
        const { builds } = stage.counts;

        state.drawOrder.set([slotOf(rig, 'b'), slotOf(rig, 'a'), slotOf(rig, 'c'), slotOf(rig, 'd')]);
        touchPose(state);
        made.frame();
        expect(element.indexSize).toBe(room.indices + 2 * RUN_PAD);
        expect(element.runSizes.slice(0, 3)).toEqual([run(1), run(2), run(1)]);
        expect(stage.counts.builds).toBe(builds);
        close(made);
    });
});

describe('a container between the slots of a clip', () => {
    /** The clip covers b, c and d, of which d lies outside of its triangle. The container sits behind b, in the middle of the clip. */
    const CLIPPED: readonly CoverSlot[] = [
        { name: 'a', shows: 'small', at: [0, 0] },
        { name: 'clip', shows: 'small', as: 'clip', end: 'd' },
        { name: 'b', shows: 'small', at: [100, 0] },
        { name: 'c', shows: 'small', at: [200, 0] },
        { name: 'd', shows: 'small', at: [300, 0] },
    ];

    it('is not clipped in the mesh mode: the clip ends in front of it and starts again behind it', async () => {
        const made = await scene('mesh', CLIPPED);
        const { rig, inserts } = made;
        const label = drawable('label');
        /** What the view draws, child by child: a mesh of its own, a container with a mask, or the label. */
        const kinds = (): string[] =>
            rig.view.container.children
                .filter((child) => child.visible && child.label !== 'marrow-probe')
                .map((child) => (child === label ? 'label' : child.mask instanceof Mesh ? 'clipped' : 'plain'));

        made.frame();
        expect(kinds()).toEqual(['plain', 'clipped']);
        inserts.add(slotOf(rig, 'b'), label);
        made.frame();
        expect(rig.view.stats.clips).toBe(1);
        // the container is a child of the view, between two containers that each have a mask of the clip
        expect(label.parent).toBe(rig.view.container);
        expect(label.mask ?? null).toBeNull();
        expect(kinds()).toEqual(['plain', 'clipped', 'label', 'clipped']);
        // a mesh for a, one for b in front of the container, one for c and d behind it
        expect(meshes(rig.view).filter((mesh) => mesh !== label)).toHaveLength(3);
        // without the container the clip is one stretch again
        inserts.remove(label);
        made.frame();
        expect(kinds()).toEqual(['plain', 'clipped']);
        close(made);
    });

    it('is not clipped in the batched mode, and the slots around it are clipped as before', async () => {
        const made = await scene('batched', CLIPPED);
        const { stage, rig, inserts } = made;

        made.frame();
        expect(rig.view.stats.clips).toBe(1);
        const [whole = 0] = made.sizes();

        inserts.add(slotOf(rig, 'b'), drawable('label'));
        made.frame();
        expect(rig.view.stats.clips).toBe(1);
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch', 'mesh', 'batch']);
        // the triangles the clip leaves of the skeleton are the same, in two draw calls
        expect(made.sizes().reduce((sum, size) => sum + size, 0)).toBe(whole);
        // a and what the clip leaves of b in front of the container, what it leaves of c behind it
        expect(made.sizes()[1]).toBeGreaterThan(0);
        expect(made.sizes()[0]).toBeGreaterThan(QUAD);
        close(made);
    });
});
