import {
    type Batch,
    type BatchableElement,
    Buffer,
    extensions,
    type InstructionSet,
    type Renderer,
    VERSION,
} from 'pixi.js';
import type { BatchBody } from './batch-body';
import { BatchElement } from './batch-element';
import { uploadsStretch } from './batch-upload';
import { MarrowBatcher, MarrowDarkBatcher, PIPE_ID } from './batcher';
import { contextLost, watchContext } from './context-watch';
import { bendsEdges } from './gate';

/*
 * The render pipe of the batched mode: what Pixi calls for a skeleton that draws in a batch.
 *
 * Pixi collects its pipes when a renderer is created, from the extensions that are registered by
 * then. This library registers nothing when it is imported, so the pipe is put into a renderer
 * the first time that renderer is about to draw a skeleton, see {@link linkRenderer}.
 */

/**
 * What Pixi collects behind a container that is attached between two slots of a skeleton: the
 * runs of the skeleton that draw after that container. See `attach-work.ts`.
 */
export interface BatchTail {
    /** What the batcher gets: it names the skeleton and the container. */
    readonly part: BatchableElement;
}

/** Whether the buffers of this Pixi upload at once when a batcher tells them what changed. */
const AT_ONCE = uploadsStretch(Buffer.prototype.update, VERSION);

/** True once the batchers are among the extensions of Pixi. */
let registered = false;

/**
 * The pipe of one renderer. Pixi calls it by the pipe protocol:
 *
 * - `addRenderable` when it builds the instructions of a render group,
 * - `validateRenderable` and `updateRenderable` for a skeleton that asked for it, and
 *   `updateRenderable` alone for one that moved or changed its tint,
 * - `execute` for every batch of skeletons, right before it draws.
 *
 * @example
 * const pipe = linkRenderer(renderer);
 * pipe.addRenderable(body, instructionSet);
 */
export class MarrowPipe {
    private renderer: Renderer | null;
    /** The batcher the last skeleton was added to. */
    private last: MarrowBatcher | null = null;

    constructor(renderer: Renderer) {
        this.renderer = renderer;
    }

    /**
     * Puts the skeleton into the batch that is being built. The tail behind an attached container
     * adds the runs that follow that container.
     */
    addRenderable(body: BatchBody | BatchTail, instructionSet: InstructionSet): void {
        const { renderer } = this;

        if (renderer === null) return;
        if ('part' in body) {
            renderer.renderPipes.batch.addToBatch(body.part, instructionSet);

            return;
        }
        const round = renderer.roundPixels || body.roundPixels;

        // the picture is drawn to this target unless a filter or a cache comes between
        body.gate.beforeDraw(bendsEdges(renderer));
        const { element } = body;
        // a skeleton without dark colors joins the batch of one with them, when that batch is still open
        const joins = this.last?.filling === true && this.last.dark;
        const dark = element.template.hasDark || joins;

        // Pixi before 8.17 creates a batcher without telling it how many textures a batch has
        MarrowBatcher.textures = renderer.limits.maxBatchableTextures;
        element.prepare(round, dark);
        renderer.renderPipes.batch.addToBatch(element, instructionSet);
        this.last = element._batcher instanceof MarrowBatcher ? element._batcher : null;
    }

    /** Writes what changed of a skeleton into its batch. */
    updateRenderable(body: BatchBody | BatchTail): void {
        // a tail has nothing of its own: the skeleton writes its runs
        if (!('part' in body)) body.element.sync();
    }

    /** Whether the instructions must be built again for a skeleton: its batch has no room for it as it is. */
    validateRenderable(body: BatchBody | BatchTail): boolean {
        if ('part' in body) return false;
        const { element } = body;

        return element.resized && element.placed;
    }

    /** A skeleton keeps nothing in the pipe. */
    destroyRenderable(): void {}

    /**
     * Runs one batch of skeletons. Every skeleton first learns how Pixi is about to draw it, as
     * in the mesh mode, and writes what that changes. Then the buffers upload what was written
     * since Pixi uploaded them, and the batch pipe of Pixi draws.
     *
     * A batch does not run while the WebGL context is lost, see `context-watch.ts`. What its
     * skeletons have to write waits for the first batch that runs again.
     */
    execute(batch: Batch): void {
        const { renderer } = this;
        const { batcher } = batch;

        if (renderer === null || contextLost()) return;
        if (batcher instanceof MarrowBatcher) {
            const bends = bendsEdges(renderer);

            for (const element of batch.elements) {
                if (!(element instanceof BatchElement)) continue;
                element.gate.beforeDraw(bends);
                // only what the look at the draw changed: Pixi has asked for the rest before
                if (element.dirty) element.sync();
            }
            batcher.flush();
            // a later batch of a batcher finds its geometry bound, and an older Pixi uploaded when it bound it
            if (!AT_ONCE && batch.action === 'renderBatch') batcher.push(renderer);
        }
        renderer.renderPipes.batch.execute(batch);
    }

    /** Pixi calls this when the renderer is destroyed. */
    destroy(): void {
        this.renderer = null;
        this.last = null;
    }
}

/**
 * The pipe of the batched mode in a renderer. The first call for a renderer creates the pipe
 * and puts it where Pixi looks its pipes up. The first call of all also adds the two batchers
 * to the extensions of Pixi.
 *
 * @example
 * body.onRender = (renderer) => linkRenderer(renderer);
 */
export function linkRenderer(renderer: Renderer): MarrowPipe {
    const found: unknown = Reflect.get(renderer.renderPipes, PIPE_ID);

    if (found instanceof MarrowPipe) return found;
    if (!registered) {
        registered = true;
        extensions.add(MarrowBatcher, MarrowDarkBatcher);
    }
    const pipe = new MarrowPipe(renderer);

    // what a renderer does with the pipes it finds at its creation
    Reflect.set(renderer.renderPipes, PIPE_ID, pipe);
    renderer.runners.destroy.add(pipe);
    watchContext(renderer);

    return pipe;
}
