import { Container, extensions } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { TimelineKind } from '../../src/model/timelines';
import { linkRenderer } from '../../src/render/batch-pipe';
import { MarrowBatcher } from '../../src/render/batcher';
import { expectBatch, loadFamily, populate } from './batch-check';
import { batcherOf, bodyOf, createStage, elementOf, readVertex, watchUploads } from './batch-stage';
import { settle, WINDOW } from './heap';
import { drawPose, meshes, play, type Rig, step, visibleSlots } from './rig';

/** Plays one frame on every rig, each at its own place of the loop on the first call. */
function advance(rigs: readonly Rig[], seconds = 1 / 60): void {
    for (const rig of rigs) step(rig, seconds);
}

/** Starts an animation on every rig, each at another place of its loop. */
function playAll(rigs: readonly Rig[], animation: string, spread = 0.07): void {
    rigs.forEach((rig, index) => {
        play(rig, animation);
        step(rig, index * spread);
    });
}

const hasKinds = (rig: Rig, animation: string, kinds: readonly TimelineKind[]): boolean =>
    kinds.every((kind) =>
        rig.model.animations
            .find((candidate) => candidate.name === animation)
            ?.timelines.some((timeline) => timeline.kind === kind),
    );

describe('the batched mode', () => {
    it('draws the instances of a skeleton in one draw call, with a pipe that arrives on its own', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');

        // nothing of the batched mode is in the renderer before a skeleton is drawn
        expect(Reflect.get(stage.renderer.renderPipes, 'marrow')).toBeUndefined();
        const rigs = await populate(stage, family, 40);

        playAll(rigs, 'run');
        stage.render();
        expect(Reflect.get(stage.renderer.renderPipes, 'marrow')).toBeDefined();
        expect(stage.counts.draws).toHaveLength(1);
        expect(stage.counts.draws[0]).toMatchObject({ kind: 'batch', blendMode: 'normal', starts: true });
        expect(stage.counts.draws[0]?.textures).toEqual(family.textures.map((texture) => texture.source));
        // the draw covers the room of every skeleton, and no skeleton has a mesh or a buffer of its own
        expect(stage.counts.draws[0]?.size).toBe(rigs.reduce((sum, rig) => sum + elementOf(rig.view).indexSize, 0));
        for (const rig of rigs) {
            expect(rig.view.stats).toMatchObject({ renderMode: 'batched', drawCalls: 1, maskDraws: 0 });
            expect(meshes(rig.view)).toEqual([]);
            expect(rig.view.container.children).toEqual([bodyOf(rig.view)]);
            expect(expectBatch(rig)).toBeGreaterThan(5);
        }
        // both batchers are registered with Pixi by then, once
        expect(extensions.add(MarrowBatcher)).toBe(extensions);
        expect(batcherOf((rigs[0] as Rig).view)).toBe(batcherOf((rigs[39] as Rig).view));
    });

    it('never makes Pixi build the instructions again while draw order and attachment keys play', async () => {
        const stage = createStage();
        // a skeleton with dark colors and additive slots, whose death reorders and swaps its slots
        const family = await loadFamily('4.2/alien-pro.skel');
        const rigs = await populate(stage, family, 12);
        const [first] = rigs;

        if (first === undefined) throw new Error('no rig');
        for (const animation of ['death', 'jump']) {
            expect(hasKinds(first, animation, ['attachment'])).toBe(true);
            playAll(rigs, animation, 0.11);
            stage.render();
            const builds = stage.counts.builds;
            const rewrites = first.view.stats.indexRebuilds;
            const orders = new Set<string>();

            for (let frame = 0; frame < 150; frame++) {
                advance(rigs);
                stage.render();
                orders.add(first.engine.state.drawOrder.join(' '));
                if (frame % 10 === 0) for (const rig of rigs) expectBatch(rig);
            }
            // the keys of the death did change the draw order and the visible slots
            if (animation === 'death') {
                expect(orders.size).toBeGreaterThan(1);
                expect(first.view.stats.indexRebuilds).toBeGreaterThan(rewrites + 5);
            }
            expect(stage.counts.builds).toBe(builds);
            expect(stage.counts.draws).toHaveLength(1);
        }
        expect(stage.counts.builds).toBe(1);
        expect(first.view.stats.templateBuilds).toBe(1);
    });

    it('places the vertices with the transform of the display object, as the batcher of Pixi does', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const parent = new Container();
        const [rig] = await populate(stage, family, 1);

        if (rig === undefined) throw new Error('no rig');
        stage.root.addChild(parent);
        parent.addChild(rig.view.container);
        parent.position.set(120.5, -33.25);
        parent.scale.set(0.37, 0.41);
        rig.view.container.rotation = 0.3;
        rig.view.container.position.set(7, 9);
        play(rig, 'run');
        step(rig, 0.1);
        stage.render();
        expect(bodyOf(rig.view)?.groupTransform.a).not.toBe(1);
        expectBatch(rig);
        const builds = stage.counts.builds;
        const { positionUploads } = rig.view.stats;

        // a move alone, without an update of the pose: Pixi asks the pipe, which places again
        parent.x += 13;
        rig.view.container.rotation = -0.2;
        stage.render();
        expectBatch(rig);
        expect(stage.counts.builds).toBe(builds);
        expect(rig.view.stats.positionUploads).toBe(positionUploads);
    });

    it('writes the tint and the alpha of the parents into every vertex, where the mesh mode has a uniform', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const parent = new Container();
        const [rig, other] = await populate(stage, family, 2);

        if (rig === undefined || other === undefined) throw new Error('no rig');
        stage.root.addChild(parent);
        parent.addChild(rig.view.container);
        stage.render();
        expect(readVertex(rig.view, 0).tint).toBe(0xffffffff);
        parent.tint = 0x336699;
        rig.view.container.alpha = 0.5;
        const uploads = watchUploads(batcherOf(rig.view));

        stage.render();
        // Pixi keeps a tint as blue, green, red, and the alpha of 0.5 as 127
        const tint = bodyOf(rig.view)?.groupColorAlpha ?? 0;

        expect(tint >>> 0).toBe(0x7f996633);
        for (let vertex = 0; vertex < elementOf(rig.view).attributeSize; vertex++) {
            expect(readVertex(rig.view, vertex).tint).toBe(tint >>> 0);
        }
        expect(readVertex(other.view, 0).tint).toBe(0xffffffff);
        expect(uploads.statics).toBe(1);
        expect(stage.counts.builds).toBe(1);
        expectBatch(rig);
    });

    it('marks every vertex for rounding when the renderer rounds positions to pixels', async () => {
        const family = await loadFamily('4.2/speedy-ess.skel');

        for (const roundPixels of [false, true]) {
            const stage = createStage({ roundPixels });
            const [rig] = await populate(stage, family, 1);

            if (rig === undefined) throw new Error('no rig');
            stage.render();
            expect(readVertex(rig.view, 0)).toMatchObject({ round: roundPixels ? 255 : 0, additive: 0 });
        }
    });

    it('uploads positions in every frame, and the rest only when it changed', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/hero-pro.skel');
        const rigs = await populate(stage, family, 40);
        const [first] = rigs;

        if (first === undefined) throw new Error('no rig');
        // an animation that keys neither attachments nor colors nor the draw order
        expect(hasKinds(first, 'run', ['attachment'])).toBe(false);
        playAll(rigs, 'run');
        stage.render();
        stage.render();
        const batcher = batcherOf(first.view);
        const uploads = watchUploads(batcher);
        const { indexRebuilds, colorUploads } = first.view.stats;

        for (let frame = 0; frame < 30; frame++) {
            advance(rigs);
            expect(batcher.dirty).toBe(false);
            stage.render();
        }
        expect(uploads).toMatchObject({ positions: 30, statics: 0, indices: 0 });
        expect(first.view.stats).toMatchObject({ indexRebuilds, colorUploads });
        // a slot that is hidden rewrites the indices of its skeleton, and only those are uploaded
        first.engine.state.colors[(visibleSlots(first)[0]?.slot ?? 0) * 4 + 3] = 0;
        drawPose(first.view, first.engine.state);
        stage.render();
        expect(uploads.indices).toBe(1);
        expect(uploads.indexBytes).toBeLessThan(batcher.indexSize * 2);
        expect(uploads.statics).toBe(0);
    });

    it('allocates nothing per frame once it is warm, whatever changes', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/spineboy-pro.skel');
        const rigs = await populate(stage, family, 3);
        const [rig] = rigs;

        if (rig === undefined) throw new Error('no rig');
        stage.render(false);
        const { state } = rig.engine;
        const slots = visibleSlots(rig).map((item) => item.slot);
        const [a = 0, b = 0] = slots;
        // a visible slot that can show another region, and that region
        const other = rig.model.skins[rig.lookup.defaultSkin]?.attachments.find(
            (item) =>
                slots.includes(item.slot) &&
                item.slot !== a &&
                item.slot !== b &&
                item.attachment !== state.attachments[item.slot] &&
                item.attachment.type === 'region',
        );
        const c = other?.slot ?? 0;
        const shown = state.attachments[c] ?? null;
        const pipe = linkRenderer(stage.renderer);
        const bodies = rigs.flatMap((item) => bodyOf(item.view) ?? []);
        const batches = [...new Set(bodies.flatMap((body) => body.element.batches))];
        // every kind of work the batch knows: positions, colors, hiding, reordering, another attachment.
        // The render group system of Pixi allocates in every frame, so the pipe is called as Pixi calls it
        const run = (i: number): void => {
            const at = state.drawOrder.indexOf(a);
            const to = state.drawOrder.indexOf(b);

            state.world[4] = i % 50;
            state.colors[a * 4] = (i % 16) / 16;
            state.colors[b * 4 + 3] = i % 3 === 0 ? 0 : 1;
            state.drawOrder[at] = b;
            state.drawOrder[to] = a;
            if (other !== undefined) state.attachments[c] = i % 5 === 0 ? other.attachment : shown;
            drawPose(rig.view, state);
            for (const body of bodies) {
                if (pipe.validateRenderable(body)) throw new Error('the batch must be built again');
                pipe.updateRenderable(body);
            }
            for (const batch of batches) pipe.execute(batch);
        };

        run(0);
        const batcher = batcherOf(rig.view);
        const before = [batcher.attributeBuffer.float32View, batcher.statics, batcher.indexBuffer, ...batches];
        const { indexRebuilds, colorUploads } = rig.view.stats;
        const windows = settle(run);

        expect(other).toBeDefined();
        expect(rig.view.stats.renderMode).toBe('batched');
        expect(windows).toBeGreaterThan(0);
        // the work did run: an index rewrite and a color change in most updates
        expect(rig.view.stats.indexRebuilds - indexRebuilds).toBeGreaterThan(windows * WINDOW * 0.6);
        expect(rig.view.stats.colorUploads - colorUploads).toBeGreaterThan(windows * WINDOW * 0.6);
        expect(rig.view.stats.templateBuilds).toBe(1);
        // the same buffers and the same batches, and the batch still holds what the kernel says
        expect([batcher.attributeBuffer.float32View, batcher.statics, batcher.indexBuffer, ...batches]).toEqual(before);
        expect(batches).toHaveLength(1);
        for (const item of rigs) expectBatch(item);
    });
});
