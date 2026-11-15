import type { Renderer } from 'pixi.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { linkRenderer } from '../../src/render/batch-pipe';
import { linkInstancePipe } from '../../src/render/instance-pipe';
import { loadMeshCode } from '../../src/render/mesh-code';
import { linkMeshPipe } from '../../src/render/mesh-pipe';
import { loadFamily, populate } from './batch-check';
import { createStage } from './batch-stage';

/*
 * Every program of pixi-marrow is GLSL 3.00, and Pixi falls back to WebGL1 where a browser has
 * no WebGL2. A renderer of WebGL1 draws no skeleton and warns once, in place of shaders that fail
 * to compile. It throws nothing: an error in a render would stop Pixi's ticker and the whole app.
 */

beforeAll(async () => {
    await loadMeshCode();
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

describe('a renderer of WebGL1', () => {
    it('links every pipe, warns once, and counts as lost, where WebGL2 and WebGPU do not', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        try {
            const old = fakeRenderer(1);

            for (const link of [linkRenderer, linkInstancePipe]) {
                expect(thrown(() => link(old))).toBeUndefined();
                expect(thrown(() => link(fakeRenderer(2)))).toBeUndefined();
                expect(thrown(() => link(fakeRenderer('gpu')))).toBeUndefined();
            }
            expect(thrown(() => linkMeshPipe(old))).toBeUndefined();
            expect(warn.mock.calls.filter(([text]) => /no skeleton draws/.test(String(text)))).toHaveLength(1);
            // the Canvas renderer of Pixi is neither WebGL nor WebGPU: the same warning, once per renderer
            const canvas = fakeRenderer('canvas');

            expect(thrown(() => linkRenderer(canvas))).toBeUndefined();
            expect(thrown(() => linkMeshPipe(canvas))).toBeUndefined();
            expect(warn.mock.calls.filter(([text]) => /no skeleton draws/.test(String(text)))).toHaveLength(2);
        } finally {
            warn.mockRestore();
        }
    });

    it('draws nothing in any render, and throws nothing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        try {
            const stage = createStage();
            const speedy = await loadFamily('4.2/speedy-ess.skel');

            Reflect.set(stage.renderer, 'context', { webGLVersion: 1 });
            await populate(stage, speedy, 1);
            expect(() => stage.render()).not.toThrow();
            expect(() => stage.render()).not.toThrow();
            expect(stage.counts.draws).toEqual([]);
        } finally {
            warn.mockRestore();
        }
    });
});
