import { type Mesh, MeshPipe, type Renderer } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { loadMeshCode } from '../../src/render/mesh-code';
import { linkMeshPipe } from '../../src/render/mesh-pipe';
import { createBare, loadFamily } from './batch-check';
import { createStage } from './batch-stage';
import { meshes, play, step } from './rig';

/*
 * A renderer that was created before Pixi's `Mesh` was evaluated has no pipe for meshes. That
 * is the renderer of a game that uses no mesh of its own, after a bundler has shaken its tree:
 * the mesh mode arrives in a chunk, later. These tests give the code such a renderer.
 */

/** What stands in for the mesh adaptor of a renderer: it counts. */
interface AdaptorCounts {
    made: number;
    inits: number;
    draws: Mesh[];
}

/** A mesh adaptor class as a renderer of Pixi lists one, and what its objects did. */
function fakeAdaptor(): { counts: AdaptorCounts; Adaptor: new () => unknown } {
    const counts: AdaptorCounts = { made: 0, inits: 0, draws: [] };

    class Adaptor {
        constructor() {
            counts.made++;
        }

        init(): void {
            counts.inits++;
        }

        execute(_pipe: MeshPipe, mesh: Mesh): void {
            counts.draws.push(mesh);
        }

        destroy(): void {}
    }

    return { counts, Adaptor };
}

/** A renderer as far as the link reads one, with the pipes and the adaptors given. */
function fakeRenderer(
    pipes: Record<string, unknown>,
    adaptors: unknown[],
): { renderer: Renderer; destroyed: unknown[] } {
    const destroyed: unknown[] = [];
    const fake = {
        renderPipes: pipes,
        config: { renderPipeAdaptors: adaptors },
        runners: { destroy: { add: (item: unknown) => destroyed.push(item) }, prerender: { add: () => undefined } },
    };

    return { renderer: fake as unknown as Renderer, destroyed };
}

describe('the link of the mesh pipe', () => {
    it('gives a renderer without a mesh pipe one, made with the mesh adaptor of that renderer', () => {
        const { counts, Adaptor } = fakeAdaptor();
        const other = fakeAdaptor();
        const pipes: Record<string, unknown> = {};
        const { renderer, destroyed } = fakeRenderer(pipes, [
            { name: 'batch', value: other.Adaptor },
            { name: 'mesh', value: Adaptor },
        ]);

        linkMeshPipe(renderer);
        expect(pipes.mesh).toBeInstanceOf(MeshPipe);
        expect(counts).toMatchObject({ made: 1, inits: 1 });
        expect(other.counts.made).toBe(0);
        // the renderer destroys the pipe with its own
        expect(destroyed).toEqual([pipes.mesh]);
    });

    it('does it once: the next frames find the pipe', () => {
        const { counts, Adaptor } = fakeAdaptor();
        const pipes: Record<string, unknown> = {};
        const { renderer, destroyed } = fakeRenderer(pipes, [{ name: 'mesh', value: Adaptor }]);

        linkMeshPipe(renderer);
        const { mesh } = pipes;

        for (let frame = 0; frame < 3; frame++) linkMeshPipe(renderer);
        expect(pipes.mesh).toBe(mesh);
        expect(counts.made).toBe(1);
        expect(destroyed).toHaveLength(1);
    });

    it('leaves the pipe of a renderer that has one', () => {
        const { counts, Adaptor } = fakeAdaptor();
        const own = { validateRenderable: () => false };
        const pipes: Record<string, unknown> = { mesh: own };
        const { renderer, destroyed } = fakeRenderer(pipes, [{ name: 'mesh', value: Adaptor }]);

        linkMeshPipe(renderer);
        expect(pipes.mesh).toBe(own);
        expect(counts.made).toBe(0);
        expect(destroyed).toEqual([]);
    });

    it('gives every renderer a pipe of its own', () => {
        const { Adaptor } = fakeAdaptor();
        const first: Record<string, unknown> = {};
        const second: Record<string, unknown> = {};

        linkMeshPipe(fakeRenderer(first, [{ name: 'mesh', value: Adaptor }]).renderer);
        linkMeshPipe(fakeRenderer(second, [{ name: 'mesh', value: Adaptor }]).renderer);
        linkMeshPipe(fakeRenderer(first, [{ name: 'mesh', value: Adaptor }]).renderer);
        expect(first.mesh).toBeInstanceOf(MeshPipe);
        expect(second.mesh).toBeInstanceOf(MeshPipe);
        expect(second.mesh).not.toBe(first.mesh);
    });

    it('leaves a renderer that lists no mesh adaptor as it is', () => {
        const { Adaptor } = fakeAdaptor();

        for (const adaptors of [[], [{ name: 'batch', value: Adaptor }], [{ name: 'mesh' }], [null]]) {
            const pipes: Record<string, unknown> = {};
            const { renderer, destroyed } = fakeRenderer(pipes, adaptors);

            expect(() => linkMeshPipe(renderer)).not.toThrow();
            expect(pipes.mesh).toBeUndefined();
            expect(destroyed).toEqual([]);
        }
        const bare = {
            renderPipes: {},
            runners: { destroy: { add: () => undefined }, prerender: { add: () => undefined } },
        };

        expect(() => linkMeshPipe(bare as unknown as Renderer)).not.toThrow();
        expect(bare.renderPipes).toEqual({});
    });
});

describe('a view in the mesh mode below a renderer that has no mesh pipe', () => {
    it('draws its meshes from the first frame: the renderer gets the pipe before Pixi collects them', async () => {
        const stage = createStage();
        const { counts, Adaptor } = fakeAdaptor();
        const destroyed: unknown[] = [];

        // the renderer of a game: created before the code of the mesh mode, and `Mesh` with it, was there
        Reflect.deleteProperty(stage.renderer.renderPipes, 'mesh');
        Reflect.set(stage.renderer, 'config', { renderPipeAdaptors: [{ name: 'mesh', value: Adaptor }] });
        Reflect.set(stage.renderer, 'runners', {
            destroy: { add: (item: unknown) => destroyed.push(item) },
            prerender: { add: () => undefined },
        });
        await loadMeshCode();
        const family = await loadFamily('4.2/speedy-ess.skel');
        const rig = await createBare(family, { renderMode: 'mesh' });
        const second = await createBare(family, { renderMode: 'mesh' });

        stage.root.addChild(rig.view.container);
        play(rig, 'run');
        step(rig, 0.05);
        expect(rig.view.stats.renderMode).toBe('mesh');
        expect(Reflect.get(stage.renderer.renderPipes, 'mesh')).toBeUndefined();
        stage.render();
        const pipe: unknown = Reflect.get(stage.renderer.renderPipes, 'mesh');

        expect(pipe).toBeInstanceOf(MeshPipe);
        expect(destroyed).toEqual([pipe]);
        expect(counts.draws).toEqual(meshes(rig.view));
        expect(counts.draws.length).toBeGreaterThan(0);
        // a second view finds the pipe of the first
        stage.root.addChild(second.view.container);
        play(second, 'run');
        counts.draws.length = 0;
        for (const item of [rig, second]) step(item, 0.05);
        stage.render();
        expect(Reflect.get(stage.renderer.renderPipes, 'mesh')).toBe(pipe);
        expect(counts.made).toBe(1);
        expect(counts.draws).toEqual([...meshes(rig.view), ...meshes(second.view)]);
    });
});
