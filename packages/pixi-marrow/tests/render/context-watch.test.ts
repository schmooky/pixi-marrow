import { Bounds, type Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { linkRenderer, MarrowPipe } from '../../src/render/batch-pipe';
import { ClipMask } from '../../src/render/clip-mask';
import { contextLost, watchContext } from '../../src/render/context-watch';
import { loadMeshCode } from '../../src/render/mesh-code';
import { linkMeshPipe } from '../../src/render/mesh-pipe';
import { createMaskShader, releaseShader } from '../../src/render/shader';
import { expectBatch, loadFamily, populate } from './batch-check';
import { createStage } from './batch-stage';
import { meshes, play, step } from './rig';

/*
 * A browser can take the WebGL context of a renderer away and give it back. Pixi makes its
 * buffers again then, and they upload whole. What Pixi does not survive is a program that it
 * uses for the first time without a context. So a skeleton draws nothing while the context is
 * lost. These tests give the code a renderer whose context can be lost. What a real context
 * does to the picture is the business of scripts/render/restore-check.mjs.
 */

/** A WebGL context that can be lost, and how often it was asked. */
interface FakeContext {
    lost: boolean;
    asked: number;
}

/**
 * A renderer as far as the watch reads one: the listeners of `prerender`, and a WebGL context
 * when one is given. `render` tells the listeners, as the start of a render does.
 */
function fakeRenderer(context?: FakeContext): { renderer: Renderer; listeners: unknown[]; render(): void } {
    const listeners: { prerender(): void }[] = [];
    const gl = {
        isContextLost(): boolean {
            if (context !== undefined) context.asked++;

            return context?.lost ?? false;
        },
    };
    const fake = {
        ...(context === undefined ? {} : { gl }),
        renderPipes: { mesh: {} },
        runners: {
            destroy: { add: () => undefined },
            prerender: { add: (item: { prerender(): void }) => listeners.push(item) },
        },
    };

    return {
        renderer: fake as unknown as Renderer,
        listeners,
        render(): void {
            for (const listener of listeners) listener.prerender();
        },
    };
}

describe('the watch of a WebGL context', () => {
    it('asks the context once per render, through one listener per renderer', () => {
        const context = { lost: false, asked: 0 };
        const { renderer, listeners, render } = fakeRenderer(context);

        watchContext(renderer);
        watchContext(renderer);
        expect(listeners).toHaveLength(1);
        expect(contextLost()).toBe(false);
        // the answer is that of the last render: nothing asks the context in between
        context.lost = true;
        expect(contextLost()).toBe(false);
        render();
        expect(contextLost()).toBe(true);
        expect(contextLost()).toBe(true);
        context.lost = false;
        render();
        expect(contextLost()).toBe(false);
        // once when the watch began, and once per render
        expect(context.asked).toBe(3);
    });

    it('answers at once for the render that is under way', () => {
        const { renderer, render } = fakeRenderer({ lost: true, asked: 0 });

        expect(contextLost()).toBe(false);
        watchContext(renderer);
        expect(contextLost()).toBe(true);
        // a later call changes nothing
        watchContext(renderer);
        expect(contextLost()).toBe(true);
        Reflect.set(Reflect.get(renderer, 'gl'), 'isContextLost', () => false);
        render();
        expect(contextLost()).toBe(false);
    });

    it('never counts a renderer without a WebGL context as lost, and the answer of another renderer does not stay', () => {
        const context = { lost: true, asked: 0 };
        const gl = fakeRenderer(context);
        const gpu = fakeRenderer();

        watchContext(gl.renderer);
        expect(contextLost()).toBe(true);
        watchContext(gpu.renderer);
        expect(contextLost()).toBe(false);
        gl.render();
        expect(contextLost()).toBe(true);
        gpu.render();
        expect(contextLost()).toBe(false);
        expect(gpu.listeners).toHaveLength(1);
    });

    it('begins with the pipe of each mode: both links make their renderer answer', () => {
        const batched = fakeRenderer({ lost: false, asked: 0 });
        const mesh = fakeRenderer({ lost: false, asked: 0 });

        expect(linkRenderer(batched.renderer)).toBeInstanceOf(MarrowPipe);
        linkRenderer(batched.renderer);
        expect(batched.listeners).toHaveLength(1);
        linkMeshPipe(mesh.renderer);
        linkMeshPipe(mesh.renderer);
        expect(mesh.listeners).toHaveLength(1);
    });
});

describe('a skeleton while the WebGL context is lost', () => {
    it('runs no batch in the batched mode, and draws the pose of the moment when the context is back', async () => {
        const context = { lost: false };
        const stage = createStage({ context });
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, family, 3);

        stage.render();
        const drawn = stage.counts.draws.length;

        expect(drawn).toBeGreaterThan(0);
        context.lost = true;
        // the game goes on: the skeletons move while nothing is drawn
        for (let frame = 0; frame < 3; frame++) {
            for (const rig of rigs) {
                if (frame === 0) play(rig, 'run');
                step(rig, 0.05);
            }
            stage.render();
            expect(stage.counts.draws).toEqual([]);
        }
        context.lost = false;
        stage.render();
        expect(stage.counts.draws).toHaveLength(drawn);
        for (const rig of rigs) expect(expectBatch(rig)).toBeGreaterThan(0);
    });

    it('keeps a skeleton that appears without a context away from the batch pipe of Pixi until the context is back', async () => {
        const context = { lost: true };
        const stage = createStage({ context });
        const family = await loadFamily('4.2/speedy-ess.skel');
        const [rig] = await populate(stage, family, 1);

        if (rig === undefined) throw new Error('no rig');
        stage.render();
        // the pipe is there and the skeleton is in a batch. Nothing bound a shader or drew
        expect(Reflect.get(stage.renderer.renderPipes, 'marrow')).toBeInstanceOf(MarrowPipe);
        expect(stage.counts.draws).toEqual([]);
        expect(stage.counts.builds).toBe(1);
        play(rig, 'run');
        step(rig, 0.05);
        stage.render();
        expect(stage.counts.draws).toEqual([]);
        context.lost = false;
        stage.render();
        expect(stage.counts.draws).toHaveLength(1);
        expect(stage.counts.draws[0]?.starts).toBe(true);
        // the restore built no instructions again
        expect(stage.counts.builds).toBe(1);
        expect(expectBatch(rig)).toBeGreaterThan(0);
    });

    it('draws no mesh in the mesh mode, and all of them when the context is back', async () => {
        const context = { lost: false };
        const stage = createStage({ context });
        const family = await loadFamily('4.2/speedy-ess.skel');

        await loadMeshCode();
        const rig = await family.create({ renderMode: 'mesh' });
        const late = await family.create({ renderMode: 'mesh' });

        stage.root.addChild(rig.view.container);
        play(rig, 'run');
        step(rig, 0.05);
        stage.render();
        const drawn = stage.counts.draws.length;

        expect(drawn).toBe(meshes(rig.view).length);
        expect(drawn).toBeGreaterThan(0);
        context.lost = true;
        // one more skeleton appears while the context is away
        stage.root.addChild(late.view.container);
        play(late, 'run');
        for (const item of [rig, late]) step(item, 0.05);
        stage.render();
        expect(stage.counts.draws).toEqual([]);
        for (const mesh of [...meshes(rig.view), ...meshes(late.view)]) expect(mesh.isRenderable).toBe(false);
        context.lost = false;
        stage.render();
        expect(stage.counts.draws).toHaveLength(meshes(rig.view).length + meshes(late.view).length);
        for (const mesh of [...meshes(rig.view), ...meshes(late.view)]) expect(mesh.isRenderable).toBe(true);
        // the loss and the restore built the instructions for the new skeleton alone
        expect(stage.counts.builds).toBe(2);
    });

    it('draws no clip mask, and a mesh that is hidden stays hidden with a context', () => {
        const context = { lost: false, asked: 0 };
        const { renderer, render } = fakeRenderer(context);
        const shader = createMaskShader();
        const mask = new ClipMask(shader, () => new Bounds(0, 0, 8, 8));

        watchContext(renderer);
        expect(mask.mesh.isRenderable).toBe(true);
        context.lost = true;
        render();
        expect(mask.mesh.isRenderable).toBe(false);
        context.lost = false;
        render();
        expect(mask.mesh.isRenderable).toBe(true);
        mask.mesh.visible = false;
        expect(mask.mesh.isRenderable).toBe(false);
        mask.destroy();
        releaseShader(shader);
    });
});
