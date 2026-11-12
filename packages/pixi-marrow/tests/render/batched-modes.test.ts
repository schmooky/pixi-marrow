import { Container } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { linkRenderer, MarrowPipe } from '../../src/render/batch-pipe';
import { inspectView } from '../../src/render/inspect';
import { loadMeshCode } from '../../src/render/mesh-code';
import { AUTO_BATCH_VERTICES, hasClip, modeFor, modeReason } from '../../src/render/mode';
import { expectBatch, loadFamily, populate } from './batch-check';
import { bodyOf, createStage, elementOf } from './batch-stage';
import { drawPose, expectKernel, meshes, play, type Rig, step, vertexData } from './rig';

/** The first rig of a list. */
function firstOf(rigs: readonly Rig[]): Rig {
    const [rig] = rigs;

    if (rig === undefined) throw new Error('no rig');

    return rig;
}

describe('the mode a view draws in', () => {
    // the code of the mesh mode is there, as after an asset that asked for it. `mesh-code.test.ts` is about the time before
    beforeAll(async () => {
        await loadMeshCode();
    });

    it('follows the option, the size of the skeleton and what a renderer can batch', () => {
        const cases: [Parameters<typeof modeReason>, string, string][] = [
            [['mesh', 10, false], 'option', 'mesh'],
            [['batched', 10, false], 'option', 'batched'],
            [['batched', 100_000, false], 'option', 'batched'],
            [['batched', 10, true], 'limit', 'mesh'],
            [['auto', AUTO_BATCH_VERTICES, false], 'small', 'batched'],
            [['auto', AUTO_BATCH_VERTICES + 1, false], 'large', 'mesh'],
            [['auto', 10, true], 'limit', 'mesh'],
            [['mesh', 10, true], 'option', 'mesh'],
        ];

        for (const [args, reason, mode] of cases) {
            expect(modeReason(...args), args.join(' ')).toBe(reason);
            expect(modeFor(args[0], modeReason(...args)), args.join(' ')).toBe(mode);
        }
    });

    it('is picked by auto from the vertices a skeleton has in a batch', async () => {
        const stage = createStage();
        const small = await loadFamily('4.2/speedy-ess.skel');
        const large = await loadFamily('4.2/raptor-pro.skel');
        const [speedy] = await populate(stage, small, 1, { renderMode: 'auto' });
        const [raptor] = await populate(stage, large, 1, { renderMode: 'auto' });

        if (speedy === undefined || raptor === undefined) throw new Error('no rig');
        stage.render();
        const reports = [inspectView(speedy.view).mode, inspectView(raptor.view).mode];

        expect(reports[0]).toMatchObject({ option: 'auto', vertices: 44, limit: AUTO_BATCH_VERTICES });
        expect(reports[1]).toMatchObject({ option: 'auto', vertices: 667, limit: AUTO_BATCH_VERTICES });
        for (const [rig, report] of [
            [speedy, reports[0]],
            [raptor, reports[1]],
        ] as const) {
            const batched = (report?.vertices ?? 0) <= AUTO_BATCH_VERTICES;

            expect(report).toMatchObject({
                mode: batched ? 'batched' : 'mesh',
                reason: batched ? 'small' : 'large',
                batches: batched ? 1 : 0,
            });
            expect(rig.view.stats.renderMode).toBe(report?.mode);
            // a view holds what its mode draws with, and nothing of the other mode
            expect(bodyOf(rig.view) === undefined).toBe(!batched);
            expect(rig.view.parts.paints.mesh === undefined).toBe(batched);
        }
    });

    it('batches a skeleton with a clipping attachment under auto while no clip is applied', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/spineboy-pro.skel');
        const plain = await loadFamily('4.2/speedy-ess.skel');
        const [rig] = await populate(stage, family, 1, { renderMode: 'auto' });

        if (rig === undefined) throw new Error('no rig');
        expect([hasClip(family.model), hasClip(plain.model), hasClip(family.model)]).toEqual([true, false, true]);
        play(rig, 'run');
        for (let frame = 0; frame < 10; frame++) {
            step(rig, 0.05);
            stage.render();
        }
        expect(rig.view.stats).toMatchObject({ renderMode: 'batched', clips: 0 });
        expect(inspectView(rig.view).mode).toMatchObject({ option: 'auto', mode: 'batched', reason: 'small' });
        expect(rig.view.parts.paints.mesh).toBeUndefined();
        expect(stage.counts.builds).toBe(1);
    });

    it('changes with the option at run time, and keeps what the other mode drew with', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, family, 2, { renderMode: 'mesh' });
        const rig = firstOf(rigs);

        play(rig, 'run');
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['mesh', 'mesh']);
        const [mesh] = meshes(rig.view);

        rig.view.renderMode = 'batched';
        // nothing changes before the next update
        expect(rig.view.stats.renderMode).toBe('mesh');
        step(rig, 0.05);
        expect(rig.view.stats).toMatchObject({ renderMode: 'batched', drawCalls: 1 });
        expect(meshes(rig.view)).toEqual([]);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch', 'mesh']);
        expectBatch(rig);
        rig.view.renderMode = 'mesh';
        step(rig, 0.05);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['mesh', 'mesh']);
        // the same mesh draws again, with the pose of this update
        expect(meshes(rig.view)).toEqual([mesh]);
        expect(bodyOf(rig.view)?.visible).toBe(false);
        expectKernel(rig);
        expect(stage.counts.builds).toBe(3);
    });
});

describe('the bounds of a view', () => {
    it('are those of the visible slots in both modes, for Pixi to cull and to measure with', async () => {
        const family = await loadFamily('4.2/spineboy-pro.skel');
        const batched = await family.create({ renderMode: 'batched' });
        const mesh = await family.create({ renderMode: 'mesh' });
        const boxes = [batched, mesh].map((rig) => {
            const parent = new Container();

            parent.addChild(rig.view.container);
            rig.view.container.position.set(30, -20);
            play(rig, 'run');
            step(rig, 0.2);

            return parent.getLocalBounds().rectangle;
        });
        const body = bodyOf(batched.view);

        expect(boxes[0]?.width).toBeGreaterThan(100);
        expect(boxes[0]).toEqual(boxes[1]);
        // the body is the one view Pixi asks: its box follows the pose, and a point inside it hits
        expect(body?.bounds.width).toBe(boxes[0]?.width);
        expect(body?.containsPoint({ x: body.bounds.minX + 1, y: body.bounds.minY + 1 })).toBe(true);
        expect(body?.containsPoint({ x: body.bounds.maxX + 1, y: 0 })).toBe(false);
        const before = body?.bounds.maxY;

        step(batched, 0.15);
        expect(body?.bounds.maxY).not.toBe(before);
    });
});

describe('the vertex colors of a view', () => {
    it('exist for the mesh mode alone, and are made from the colors of the slots when a view changes to it', async () => {
        const family = await loadFamily('4.2/alien-pro.skel');
        const batched = await family.create({ renderMode: 'batched' });
        const mesh = await family.create({ renderMode: 'mesh' });

        for (const rig of [batched, mesh]) {
            play(rig, 'death');
            step(rig, 0.3);
            step(rig, 0.3);
        }
        // dark colors: 8 bytes per vertex in the mesh mode, none in a batch
        expect(mesh.view.parts.template.colors).toHaveLength(mesh.view.stats.vertices * 8);
        expect(batched.view.parts.template.colors).toHaveLength(0);
        expect(batched.view.parts.template.light).toEqual(mesh.view.parts.template.light);
        batched.view.renderMode = 'mesh';
        for (const rig of [batched, mesh]) step(rig, 0.1);
        expect(batched.view.stats.renderMode).toBe('mesh');
        expect(vertexData(batched.view).colorBytes).toEqual(vertexData(mesh.view).colorBytes);
        expect(vertexData(batched.view).colorBytes.some((byte) => byte !== 0 && byte !== 255)).toBe(true);
        expectKernel(batched);
        // a layout that is made while the view draws meshes has them from the start
        batched.engine.setSkin(0);
        step(batched, 0);
        expect(batched.view.parts.template.colors.length).toBeGreaterThan(0);
    });
});

describe('a batched skeleton that Pixi does not draw', () => {
    it('leaves the batch when it is hidden, and writes nothing until it is back', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, family, 3);
        const [first, second, third] = rigs;

        if (first === undefined || second === undefined || third === undefined) throw new Error('no rig');
        for (const rig of rigs) play(rig, 'run');
        stage.render();
        const place = elementOf(first.view)._attributeStart;

        for (const hide of [
            (rig: Rig, hidden: boolean): void => {
                rig.view.container.visible = !hidden;
            },
            (rig: Rig, hidden: boolean): void => {
                rig.view.container.renderable = !hidden;
            },
        ]) {
            const builds = stage.counts.builds;

            hide(first, true);
            stage.render();
            expect(stage.counts.builds).toBe(builds + 1);
            // the next skeleton has its place now
            expect(elementOf(second.view)._attributeStart).toBe(place);
            expect(elementOf(first.view).placed).toBe(false);
            for (let frame = 0; frame < 20; frame++) {
                for (const rig of rigs) step(rig, 1 / 30);
                stage.render();
            }
            expect(stage.counts.builds).toBe(builds + 1);
            expect(stage.counts.draws[0]?.size).toBe(elementOf(second.view).indexSize * 2);
            expectBatch(second);
            expectBatch(third);
            hide(first, false);
            stage.render();
            expect(stage.counts.builds).toBe(builds + 2);
            for (const rig of rigs) expectBatch(rig);
        }
    });

    it('leaves the batch while it shows nothing, so that it breaks no batch of others', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, family, 3, { renderMode: 'mesh' });
        const [first, between, last] = rigs;

        if (first === undefined || between === undefined || last === undefined) throw new Error('no rig');
        first.view.renderMode = 'batched';
        last.view.renderMode = 'batched';
        for (const rig of rigs) step(rig, 0);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.kind)).toEqual(['batch', 'mesh', 'batch']);
        // the skeleton in the middle batches too, and every slot of it fades out
        between.view.renderMode = 'batched';
        between.engine.state.colors.fill(0);
        drawPose(between.view, between.engine.state);
        expect(between.view.stats).toMatchObject({ renderMode: 'batched', drawCalls: 0, indices: 0 });
        expect(bodyOf(between.view)?.visible).toBe(false);
        stage.render();
        expect(stage.counts.draws).toHaveLength(1);
        expect(stage.counts.draws[0]?.size).toBe(elementOf(first.view).indexSize * 2);
        const builds = stage.counts.builds;

        // nothing changes while it stays invisible
        for (let frame = 0; frame < 5; frame++) {
            drawPose(between.view, between.engine.state);
            stage.render();
        }
        expect(stage.counts.builds).toBe(builds);
        between.engine.state.colors.fill(1);
        drawPose(between.view, between.engine.state);
        stage.render();
        expect(stage.counts.builds).toBe(builds + 1);
        expect(stage.counts.draws).toHaveLength(1);
        expect(between.view.stats.drawCalls).toBe(1);
        for (const rig of rigs) expectBatch(rig);
    });

    it('is gone from the batch once it is destroyed', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, family, 3);
        const [first, second, third] = rigs;

        if (first === undefined || second === undefined || third === undefined) throw new Error('no rig');
        stage.render();
        const body = bodyOf(second.view);

        second.view.destroy();
        expect(body?.destroyed).toBe(true);
        expect(second.view.stats).toMatchObject({ drawCalls: 0, indices: 0, bufferBytes: 0 });
        stage.render();
        expect(stage.counts.draws[0]?.size).toBe(elementOf(first.view).indexSize * 2);
        for (const rig of [first, third]) {
            step(rig, 0.1);
            stage.render();
            expectBatch(rig);
        }
        expect(stage.counts.builds).toBe(2);
    });

    it('draws in the batch of the render group it is moved to', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, family, 3);
        const rig = firstOf(rigs);
        const group = new Container({ isRenderGroup: true });

        stage.render();
        const home = elementOf(rig.view).home;

        stage.root.addChild(group);
        group.addChild(rig.view.container);
        group.position.set(40, 50);
        stage.render();
        expect(elementOf(rig.view).home).not.toBe(home);
        expect(elementOf(rig.view).placed).toBe(true);
        for (const item of rigs) {
            step(item, 0.1);
            stage.render();
            expectBatch(item);
        }
    });
});

describe('the pipe of the batched mode', () => {
    it('is put into a renderer once, by the first skeleton it is about to draw', async () => {
        const stage = createStage();
        const other = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');

        expect(Reflect.get(stage.renderer.renderPipes, 'marrow')).toBeUndefined();
        const rigs = await populate(stage, family, 2);

        // a view that is not drawn yet has put nothing anywhere
        expect(Reflect.get(stage.renderer.renderPipes, 'marrow')).toBeUndefined();
        stage.render();
        const pipe = Reflect.get(stage.renderer.renderPipes, 'marrow');

        expect(pipe).toBeInstanceOf(MarrowPipe);
        expect(linkRenderer(stage.renderer)).toBe(pipe);
        expect(bodyOf(firstOf(rigs).view)?.linked).toBe(stage.renderer);
        // every renderer gets a pipe of its own
        expect(Reflect.get(other.renderer.renderPipes, 'marrow')).toBeUndefined();
        expect(linkRenderer(other.renderer)).not.toBe(pipe);
        stage.render();
        expect(Reflect.get(stage.renderer.renderPipes, 'marrow')).toBe(pipe);
    });

    it('asks for no build for a skeleton that is in no batch, and draws nothing after its renderer is gone', async () => {
        const stage = createStage();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rig = await family.create();
        const pipe = linkRenderer(stage.renderer);

        drawPose(rig.view, rig.engine.state);
        const body = bodyOf(rig.view);

        if (body === undefined) throw new Error('no body');
        expect(body.element.resized).toBe(true);
        expect(pipe.validateRenderable(body)).toBe(false);
        expect(() => pipe.updateRenderable(body)).not.toThrow();
        stage.root.addChild(rig.view.container);
        stage.render();
        expect(pipe.validateRenderable(body)).toBe(false);
        const [batch] = body.element.batches;

        if (batch === undefined) throw new Error('no batch');
        pipe.destroyRenderable();
        pipe.destroy();
        stage.counts.draws.length = 0;
        pipe.execute(batch);
        pipe.addRenderable(body, stage.root.renderGroup.instructionSet);
        expect(stage.counts.draws).toEqual([]);
    });
});
