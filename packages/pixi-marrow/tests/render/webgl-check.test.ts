import type { Renderer } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { linkRenderer } from '../../src/render/batch-pipe';
import { linkInstancePipe } from '../../src/render/instance-pipe';
import { loadMeshCode } from '../../src/render/mesh-code';
import { linkMeshPipe } from '../../src/render/mesh-pipe';
import { loadFamily, populate } from './batch-check';
import { createStage } from './batch-stage';

/*
 * Every program of pixi-marrow is GLSL 3.00, and Pixi falls back to WebGL1 where a browser has
 * no WebGL2. A renderer of WebGL1 throws a `MarrowError` when it first draws a skeleton, in
 * place of shaders that fail to compile.
 */

beforeAll(async () => {
    await loadMeshCode();
});

/** A renderer as far as the first draw of a skeleton reads one, with a WebGL context of a version, or WebGPU. */
function fakeRenderer(webGLVersion: 1 | 2 | 'gpu'): Renderer {
    const fake = {
        ...(webGLVersion === 'gpu' ? { gpu: {} } : { gl: { isContextLost: () => false }, context: { webGLVersion } }),
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
    it('throws a MarrowError in every pipe that draws a skeleton, and WebGL2 and WebGPU pass', () => {
        for (const link of [linkRenderer, linkInstancePipe]) {
            const error = thrown(() => link(fakeRenderer(1)));

            expect(error).toBeInstanceOf(MarrowError);
            expect((error as MarrowError).code).toBe('unsupported-feature');
            expect((error as MarrowError).message).toMatch(/WebGL1/);
            expect(thrown(() => link(fakeRenderer(2)))).toBeUndefined();
            expect(thrown(() => link(fakeRenderer('gpu')))).toBeUndefined();
        }
        expect(thrown(() => linkMeshPipe(fakeRenderer(1)))).toBeInstanceOf(MarrowError);
    });

    it('throws at the first render of a skeleton, in every render after it, and draws nothing', async () => {
        const stage = createStage();
        const speedy = await loadFamily('4.2/speedy-ess.skel');

        Reflect.set(stage.renderer, 'context', { webGLVersion: 1 });
        await populate(stage, speedy, 1);
        expect(() => stage.render()).toThrow(MarrowError);
        expect(() => stage.render()).toThrow(/WebGL1/);
        expect(stage.counts.draws).toEqual([]);
    });
});
