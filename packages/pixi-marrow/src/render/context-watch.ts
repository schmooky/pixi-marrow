import type { Renderer } from 'pixi.js';
import { DOCS_SITE } from '../base/errors';

/*
 * Whether the renderer that draws at the moment has lost its WebGL context.
 *
 * A browser can take the WebGL context of a page away and give it back later. Pixi keeps its
 * renderer alive through that. When the context is back, Pixi makes every buffer, texture and
 * program again, and a new buffer uploads its whole array at its first draw. So the buffers of a
 * skeleton come back as they were, also for a skeleton at rest that uploads nothing by itself.
 * The notes of this library about what changed are then notes about buffers that hold all.
 *
 * One thing Pixi does not survive: a program that is used for the first time while the context
 * is lost. It cannot be compiled then. pixi.js 8.16 throws inside the render. pixi.js 8.23 logs
 * the error and keeps the function that sets the uniforms of that program, made from a program
 * without uniforms, also after the restore. What draws with the program stays invisible for good.
 * This library makes its shaders on demand, so a skeleton that appears while the context is away
 * would be the first to use one.
 *
 * So a skeleton draws nothing while the context is lost: the pipe of the batched mode runs no
 * batch and the meshes of the mesh mode say that they are not renderable. Nobody sees a frame
 * that is drawn without a context. The programs are compiled at the first draw with the context
 * that came back.
 *
 * The context is asked once per render of a renderer, not per skeleton. A WebGPU device that is
 * lost is another event, and nothing here watches it.
 *
 * A renderer of WebGL1 counts as lost for good, and says so once with `console.warn`. Every
 * program of this library is GLSL 3.00, which WebGL1 cannot compile, and Pixi falls back to
 * WebGL1 where a browser has no WebGL2. The same holds for a renderer that is neither WebGL nor
 * WebGPU, as the Canvas renderer of Pixi. The skeletons draw nothing there, and the rest of the
 * app goes on. An error thrown in a render would stop the ticker of Pixi, and with it the whole
 * app. The words of the warning are short: this is in the root import, which is near its limit.
 */

/** The renderers that tell this module before each of their renders. */
const watched = new WeakSet<Renderer>();

/** True while the renderer that renders at the moment has lost its context. */
let lost = false;

/**
 * Whether the renderer that draws at the moment has lost its WebGL context. What draws a
 * skeleton asks this right before it draws, and draws nothing when it is true.
 *
 * @example
 * if (!contextLost()) renderer.renderPipes.batch.execute(batch);
 */
export function contextLost(): boolean {
    return lost;
}

/**
 * Whether a renderer can draw no skeleton at all: one of WebGL1, or one that is neither WebGL
 * nor WebGPU, as the Canvas renderer of Pixi.
 *
 * @example
 * if (drawsNothing(renderer)) stats.drawCalls = 0;
 */
export function drawsNothing(renderer: Renderer): boolean {
    // the types of Pixi are bits: 1 is WebGL and 2 is WebGPU. A renderer of a test has none
    return ('gl' in renderer && renderer.context?.webGLVersion === 1) || renderer.type > 2;
}

/**
 * Makes a renderer say before each of its renders whether its WebGL context is lost. The first
 * call for a renderer adds one listener to it, later calls do nothing. Call it before the
 * renderer first draws a skeleton: the answer for the render that is under way is set at once.
 *
 * A renderer without a WebGL context, as the one of WebGPU, never counts as lost. A renderer of
 * WebGL1 always counts as lost, and warns once. So does a renderer whose `type` names neither
 * WebGL nor WebGPU.
 *
 * @example
 * watchContext(renderer);
 * console.log(contextLost()); // false, unless the browser took the context
 */
export function watchContext(renderer: Renderer): void {
    if (watched.has(renderer)) return;
    watched.add(renderer);
    const old = drawsNothing(renderer);

    if (old)
        console.warn(
            `pixi-marrow: this renderer draws no skeleton. Use WebGL2 or WebGPU. ${DOCS_SITE}good-to-know/#limits`,
        );
    // every renderer that draws skeletons answers, so the answer of another one never stays
    const watch = {
        prerender(): void {
            lost = old || ('gl' in renderer && renderer.gl.isContextLost());
        },
    };

    renderer.runners.prerender.add(watch);
    watch.prerender();
}
