import type { Renderer } from 'pixi.js';

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
 * Makes a renderer say before each of its renders whether its WebGL context is lost. The first
 * call for a renderer adds one listener to it, later calls do nothing. Call it before the
 * renderer first draws a skeleton: the answer for the render that is under way is set at once.
 *
 * A renderer without a WebGL context, as the one of WebGPU, never counts as lost.
 *
 * @example
 * watchContext(renderer);
 * console.log(contextLost()); // false, unless the browser took the context
 */
export function watchContext(renderer: Renderer): void {
    if (watched.has(renderer)) return;
    watched.add(renderer);
    // every renderer that draws skeletons answers, so the answer of another one never stays
    const watch = {
        prerender(): void {
            lost = 'gl' in renderer && renderer.gl.isContextLost();
        },
    };

    renderer.runners.prerender.add(watch);
    watch.prerender();
}
