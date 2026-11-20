import type { Renderer, Shader } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { linkRenderer } from '../../src/render/batch-pipe';
import { createBatchShader } from '../../src/render/batch-shader';
import { contextLost, watchContext, webGL1 } from '../../src/render/context-watch';
import { drawsHere, toGlsl100 } from '../../src/render/glsl100';
import { linkInstancePipe } from '../../src/render/instance-pipe';
import { loadMeshCode } from '../../src/render/mesh-code';
import { linkMeshPipe } from '../../src/render/mesh-pipe';
import { createMaskShader, createViewShader, releaseShader } from '../../src/render/shader';
import { loadFamily, populate } from './batch-check';
import { createStage, type Stage } from './batch-stage';
import { meshes, play, step } from './rig';

/*
 * Pixi falls back to WebGL1 where a browser has no WebGL2. The shaders of the batched mode, of
 * the mesh mode with `skinning: 'cpu'` and of clip masks then hand Pixi a program of GLSL 1.00,
 * made from their GLSL 3.00 sources, see `src/render/glsl100.ts`. WebGL2 keeps the program it had.
 * `skinning: 'gpu'` and instancing need WebGL2: on WebGL1 they draw nothing and warn once.
 *
 * These tests run without a GPU, so no program compiles here. That the programs of GLSL 1.00
 * compile and draw the picture of WebGL2 is the business of the pixel check.
 */

beforeAll(async () => {
    await loadMeshCode();
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** A renderer as far as the first draw of a skeleton reads one, with a WebGL context of a version, or WebGPU. */
function fakeRenderer(webGLVersion: 1 | 2 | 'gpu' | 'canvas'): Renderer {
    const context = { gl: { isContextLost: () => false }, context: { webGLVersion }, type: 1 };
    const other = webGLVersion === 'gpu' ? { gpu: {}, type: 2 } : { type: 4 };
    const fake = {
        ...(typeof webGLVersion === 'number' ? context : other),
        renderPipes: {},
        runners: { destroy: { add: () => undefined }, prerender: { add: () => undefined } },
    };

    return fake as unknown as Renderer;
}

/** The error a call throws, or undefined. */
function thrown(call: () => void): unknown {
    try {
        call();
    } catch (error) {
        return error;
    }

    return undefined;
}

/** A stage whose renderer is one of WebGL1, with a context that stays. */
function stageOfWebGL1(): Stage {
    const stage = createStage({ context: { lost: false } });

    Reflect.set(stage.renderer, 'context', { webGLVersion: 1 });

    return stage;
}

/** The sources of the program a shader hands Pixi in a render of the renderer that was watched last. */
function sources(shader: Shader): string {
    return `${shader.glProgram.vertex}\n${shader.glProgram.fragment}`;
}

/** Warnings about a text. */
function warnings(warn: { mock: { calls: unknown[][] } }, text: RegExp): number {
    return warn.mock.calls.filter(([first]) => text.test(String(first))).length;
}

describe('the GLSL of WebGL1', () => {
    it('drops the version and the flat qualifier, and nothing else', () => {
        const source = '#version 300 es\nflat out float vPage;\nout vec2 vUV;\nfloat inflate;';

        expect(toGlsl100(source)).toBe('\nout float vPage;\nout vec2 vUV;\nfloat inflate;');
    });

    it('is the program of the shared shaders in a render of WebGL1, and WebGL2 keeps its own', () => {
        const batch = createBatchShader(4, true);
        const mask = createMaskShader();

        watchContext(fakeRenderer(2));
        expect(webGL1()).toBe(false);
        const modern = batch.glProgram;

        expect(sources(batch)).toContain('#version 300 es');
        expect(sources(mask)).toContain('#version 300 es');
        watchContext(fakeRenderer(1));
        expect(webGL1()).toBe(true);
        expect(contextLost()).toBe(false);
        for (const shader of [batch, mask]) {
            expect(sources(shader)).not.toContain('#version 300 es');
            expect(sources(shader)).not.toMatch(/\bflat\b/);
            // Pixi turns `in`, `out`, `texture` and `finalColor` into GLSL 1.00 for a source without a version
            expect(shader.glProgram.fragment).toContain('#define finalColor gl_FragColor');
            expect(drawsHere(shader)).toBe(true);
        }
        // the program of WebGL1 is made once
        expect(batch.glProgram).toBe(batch.glProgram);
        watchContext(fakeRenderer('gpu'));
        expect(webGL1()).toBe(false);
        expect(batch.glProgram).toBe(modern);
        releaseShader(mask);
    });

    it('leaves a destroyed shader without a program on both versions', () => {
        const shader = createViewShader([], false);

        watchContext(fakeRenderer(1));
        releaseShader(shader);
        expect(shader.glProgram).toBeNull();
        watchContext(fakeRenderer(2));
        expect(shader.glProgram).toBeNull();
    });
});

describe('a renderer of WebGL1', () => {
    it('links every pipe without a warning. The Canvas renderer still warns once and draws nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const old = fakeRenderer(1);

        for (const link of [linkRenderer, linkInstancePipe]) {
            expect(thrown(() => link(old))).toBeUndefined();
            expect(thrown(() => link(fakeRenderer(2)))).toBeUndefined();
            expect(thrown(() => link(fakeRenderer('gpu')))).toBeUndefined();
        }
        expect(thrown(() => linkMeshPipe(old))).toBeUndefined();
        expect(warnings(warn, /draws no skeleton/)).toBe(0);
        // the Canvas renderer of Pixi is neither WebGL nor WebGPU
        const canvas = fakeRenderer('canvas');

        expect(thrown(() => linkRenderer(canvas))).toBeUndefined();
        expect(thrown(() => linkMeshPipe(canvas))).toBeUndefined();
        expect(warnings(warn, /draws no skeleton/)).toBe(1);
        expect(contextLost()).toBe(true);
    });

    it('draws the batches of WebGL2 in the batched mode', async () => {
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const modern = createStage({ context: { lost: false } });

        await populate(modern, speedy, 3);
        modern.render();
        const old = stageOfWebGL1();

        await populate(old, speedy, 3);
        old.render();
        expect(old.counts.draws.length).toBeGreaterThan(0);
        expect(old.counts.draws.map(({ start, size }) => [start, size])).toEqual(
            modern.counts.draws.map(({ start, size }) => [start, size]),
        );
        const shader = old.counts.draws[0]?.batcher?.shader;

        if (shader === undefined) throw new Error('no batcher');
        expect(sources(shader)).not.toContain('#version 300 es');
    });

    it('draws every mesh of the mesh mode with skinning cpu', async () => {
        const stage = stageOfWebGL1();
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const rig = await speedy.create({ renderMode: 'mesh' });

        stage.root.addChild(rig.view.container);
        play(rig, 'run');
        step(rig, 0.05);
        stage.render();
        expect(stage.counts.draws.length).toBe(meshes(rig.view).length);
        expect(stage.counts.draws.length).toBeGreaterThan(0);
        for (const mesh of meshes(rig.view)) expect(sources(mesh.shader as Shader)).not.toContain('#version 300 es');
    });

    it('draws nothing with skinning gpu or instancing, warns once, and throws nothing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const stage = stageOfWebGL1();
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const rigs = await populate(stage, speedy, 3, { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' });

        for (let frame = 0; frame < 3; frame++) {
            for (const rig of rigs) step(rig, 0.05);
            expect(() => stage.render()).not.toThrow();
            expect(stage.counts.draws).toEqual([]);
        }
        expect(warnings(warn, /skinning: 'gpu'/)).toBe(1);
    });
});
