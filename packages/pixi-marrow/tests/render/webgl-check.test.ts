import { type Container, Mesh, type Renderer, type Shader, TextureSource } from 'pixi.js';
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
function fakeRenderer(webGLVersion: 1 | 2 | 'gpu' | 'canvas', uint32Indices = true): Renderer {
    const context = {
        gl: { isContextLost: () => false },
        context: { webGLVersion, supports: { uint32Indices } },
        type: 1,
    };
    const other = webGLVersion === 'gpu' ? { gpu: {}, type: 2 } : { type: 4 };
    const fake = {
        ...(typeof webGLVersion === 'number' ? context : other),
        renderPipes: {},
        runners: {
            destroy: { add: () => undefined },
            prerender: { add: () => undefined },
            postrender: { add: () => undefined },
        },
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

/** A renderer that tells its listeners of the start and the end of a render, as Pixi does. */
function listenedRenderer(webGLVersion: 1 | 2): { renderer: Renderer; render(inner?: () => void): void } {
    const before: { prerender(): void }[] = [];
    const after: { postrender(): void }[] = [];
    const fake = {
        gl: { isContextLost: () => false },
        context: { webGLVersion, supports: { uint32Indices: true } },
        type: 1,
        renderPipes: {},
        runners: {
            destroy: { add: () => undefined },
            prerender: { add: (item: { prerender(): void }) => before.push(item) },
            postrender: { add: (item: { postrender(): void }) => after.push(item) },
        },
    };

    return {
        renderer: fake as unknown as Renderer,
        render(inner?: () => void): void {
            for (const item of before) item.prerender();
            inner?.();
            for (const item of after) item.postrender();
        },
    };
}

/** Words of GLSL 3.00 that GLSL 1.00 does not have, and that the defines of Pixi do not turn into GLSL 1.00. */
const GLSL300_ONLY =
    /#version|\b(flat|smooth|centroid|layout|uint|uvec[234]|texelFetch|textureSize|textureLod|textureGrad|inverse|transpose|round|trunc|isnan|isinf|switch)\b|<<|>>|[^&]&[^&]|[^|]\|[^|]|%/;

/** A stage whose renderer is one of WebGL1, with a context that stays. */
function stageOfWebGL1(): Stage {
    const stage = createStage({ context: { lost: false } });

    Reflect.set(stage.renderer, 'context', { webGLVersion: 1, supports: { uint32Indices: true } });

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

    it('holds no word of GLSL 3.00 in any program of WebGL1, and no output but finalColor', () => {
        const old = fakeRenderer(1);
        const shaders: Shader[] = [createMaskShader()];
        const batched = new Set<Shader>();

        for (const dark of [false, true]) {
            for (const textures of [1, 2, 8, 16]) batched.add(createBatchShader(textures, dark));
            for (const pages of [1, 2, 8])
                shaders.push(
                    createViewShader(
                        Array.from({ length: pages }, () => new TextureSource()),
                        dark,
                    ),
                );
        }
        shaders.push(...batched);
        watchContext(old);
        for (const shader of shaders) {
            const { vertex, fragment } = shader.glProgram;

            expect(`${vertex}\n${fragment}`).not.toMatch(GLSL300_ONLY);
            // Pixi took out the one output of the fragment stage and defined it as gl_FragColor
            expect(fragment).not.toMatch(/\bout\b/);
            expect(fragment).toContain('#define finalColor gl_FragColor');
        }
        // the shaders of the batched mode stay for the batchers, the others go back
        for (const shader of shaders) if (!batched.has(shader)) releaseShader(shader);
    });

    it('gives the outer render its answer back when a render of another renderer ends inside it', () => {
        const old = listenedRenderer(1);
        const modern = listenedRenderer(2);

        watchContext(old.renderer);
        watchContext(modern.renderer);
        let inside: boolean[] = [];

        old.render(() => {
            inside.push(webGL1());
            modern.render(() => inside.push(webGL1()));
            inside.push(webGL1());
        });
        expect(inside).toEqual([true, false, true]);
        expect(webGL1()).toBe(false);
        inside = [];
        modern.render(() => {
            inside.push(webGL1());
            old.render(() => inside.push(webGL1()));
            inside.push(webGL1());
        });
        expect(inside).toEqual([false, true, false]);
        // two renderers one after the other in a frame: each render has its own answer
        old.render(() => inside.push(webGL1()));
        modern.render(() => inside.push(webGL1()));
        expect(inside.slice(3)).toEqual([true, false]);
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

    it('warns once when it has no 32-bit indices', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        linkRenderer(fakeRenderer(1));
        linkRenderer(fakeRenderer(2, false));
        expect(warnings(warn, /32-bit indices/)).toBe(0);
        const old = fakeRenderer(1, false);

        linkRenderer(old);
        linkMeshPipe(old);
        expect(warnings(warn, /32-bit indices/)).toBe(1);
    });

    it('draws the batches of WebGL2 in the batched mode', async () => {
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const modern = createStage({ context: { lost: false } });

        await populate(modern, speedy, 3);
        modern.render();
        const old = stageOfWebGL1();

        await populate(old, speedy, 3);
        watchContext(fakeRenderer(2));
        let during = '';

        old.render(true, () => {
            const shader = old.counts.draws[0]?.batcher?.shader;

            during = shader === undefined ? '' : sources(shader);
        });
        expect(old.counts.draws.length).toBeGreaterThan(0);
        expect(old.counts.draws.map(({ start, size }) => [start, size])).toEqual(
            modern.counts.draws.map(({ start, size }) => [start, size]),
        );
        const shader = old.counts.draws[0]?.batcher?.shader;

        if (shader === undefined) throw new Error('no batcher');
        expect(during).toContain('#define finalColor gl_FragColor');
        expect(during).not.toContain('#version 300 es');
        // the render is over: the answer is again the one from before it, and the program that of WebGL2
        expect(webGL1()).toBe(false);
        expect(sources(shader)).toContain('#version 300 es');
    });

    it('draws every mesh of the mesh mode with skinning cpu', async () => {
        const stage = stageOfWebGL1();
        const speedy = await loadFamily('4.2/speedy-ess.skel');
        const rig = await speedy.create({ renderMode: 'mesh' });

        stage.root.addChild(rig.view.container);
        play(rig, 'run');
        step(rig, 0.05);
        let during: string[] = [];

        stage.render(true, () => {
            during = meshes(rig.view).map((mesh) => (mesh.shader === null ? '' : sources(mesh.shader)));
        });
        expect(stage.counts.draws.length).toBe(meshes(rig.view).length);
        expect(stage.counts.draws.length).toBeGreaterThan(0);
        expect(during).toHaveLength(meshes(rig.view).length);
        for (const text of during) expect(text).toContain('#define finalColor gl_FragColor');
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
        for (const rig of rigs) expect(rig.view.stats).toMatchObject({ drawCalls: 0, maskDraws: 0, indices: 0 });
    });

    it('draws no clip mask of a view with skinning gpu, and the masks of skinning cpu', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const stage = stageOfWebGL1();
        const coin = await loadFamily('4.2/coin-pro.skel');
        const gpu = await coin.create({ renderMode: 'mesh', skinning: 'gpu' });
        const cpu = await coin.create({ renderMode: 'mesh', skinning: 'cpu' });
        let drawn: boolean[][] = [];

        for (const rig of [gpu, cpu]) {
            stage.root.addChild(rig.view.container);
            play(rig, 'animation');
            step(rig, 0.05);
        }
        for (let frame = 0; frame < 2; frame++) {
            for (const rig of [gpu, cpu]) step(rig, 0.05);
            stage.render(true, () => {
                drawn = [gpu, cpu].map((rig) => masksOf(rig.view.container).map((mask) => mask.isRenderable));
            });
        }
        const [ofGpu = [], ofCpu = []] = drawn;

        expect(ofGpu.length).toBeGreaterThan(0);
        expect(ofGpu.every((one) => !one)).toBe(true);
        expect(ofCpu.length).toBeGreaterThan(0);
        expect(ofCpu.every((one) => one)).toBe(true);
        expect(gpu.view.stats).toMatchObject({ drawCalls: 0, maskDraws: 0 });
        expect(cpu.view.stats.maskDraws).toBeGreaterThan(0);
    });
});

/** The clip masks below a container. */
function masksOf(container: Container): Mesh[] {
    const found: Mesh[] = [];

    for (const child of container.children) {
        if (child instanceof Mesh && child.label === 'marrow-clip-mask') found.push(child);
        else found.push(...masksOf(child));
    }

    return found;
}
