import { type Bounds, type Renderer, ViewContainer } from 'pixi.js';
import { BatchElement, type BatchElementOptions } from './batch-element';
import { GROUP_PAGES } from './batch-layout';
import { linkRenderer } from './batch-pipe';
import { PIPE_ID } from './batcher';
import type { DrawGate } from './gate';

/** What a {@link BatchBody} is created with: what its element needs, and its bounds. */
export interface BatchBodyOptions extends Omit<BatchElementOptions, 'place'> {
    /** The bounds of what is visible. Pixi asks for them when it culls or measures. */
    readonly measure: () => Bounds;
}

/** Puts the pipe of the batched mode into the renderer that is about to draw a body. */
function link(this: BatchBody, renderer: Renderer): void {
    if (renderer === this.linked) return;
    this.linked = renderer;
    linkRenderer(renderer);
    // a GPU that cannot sample the pages of one run in a batch: the view goes back to meshes before Pixi collects it
    if (renderer.limits.maxBatchableTextures < Math.min(this.element.pages.length, GROUP_PAGES)) {
        this.gate.refuseBatch();
    }
}

/**
 * The display object of a skeleton in the batched mode. It draws nothing itself: Pixi hands it to
 * the pipe of the batched mode, which puts its {@link element} into the batch of the render group.
 *
 * Before every render Pixi tells the body which renderer is about to draw. The body makes sure
 * that this renderer has the pipe, through `onRender`.
 *
 * @example
 * const body = new BatchBody({ gate: view, pages, texture, seen, cover, model, stats, template, layout, measure });
 * container.addChild(body);
 * body.touch();
 */
export class BatchBody extends ViewContainer {
    override readonly renderPipeId: string = PIPE_ID;
    /** Pixi reads it of every view. The body always draws in a batch. */
    batched = true;
    /** The skeleton as the batcher sees it. */
    readonly element: BatchElement;
    /** The view of the skeleton, which is asked before every draw. */
    readonly gate: DrawGate;
    /** The renderer that drew the body last, which has the pipe. */
    linked: Renderer | null = null;
    private readonly measure: () => Bounds;

    constructor(options: BatchBodyOptions) {
        super({ label: 'marrow-batch' });
        this.gate = options.gate;
        this.measure = options.measure;
        this.element = new BatchElement({ ...options, place: this });
        this.onRender = link;
    }

    /** The bounds of the visible slots, in the space of the skeleton. */
    override get bounds(): Bounds {
        return this.measure();
    }

    /** Tells Pixi that the skeleton changed, so that it asks the pipe to write the batch. */
    touch(): void {
        this.onViewUpdate();
    }

    /** The bounds come from the view, so there is nothing to compute here. */
    protected override updateBounds(): void {}
}
