import type { Bounds, Container, Texture, TextureSource } from 'pixi.js';
import type { SkeletonModel } from '../model/model';
import { BatchBody } from './batch-body';
import type { BatchElement } from './batch-element';
import type { SlotLayout } from './batch-layout';
import type { CoverTest } from './cover';
import type { DrawGate } from './gate';
import { MeshPaint } from './mesh-paint';
import type { DrawMode, ViewStats } from './stats';
import type { Template } from './template';
import type { VisibleList } from './visible';

/** What the paints of a view are created with. */
export interface ViewPaintsOptions {
    /** Where the meshes and the body go. It must hold nothing else. */
    readonly container: Container;
    /** The view, which is asked before every draw. */
    readonly gate: DrawGate;
    /** The texture source of every atlas page, in page order. */
    readonly pages: readonly TextureSource[];
    /** A texture of the skeleton, which Pixi asks every batch element for. */
    readonly texture: Texture;
    /** Whether a slot of the skeleton has a dark color. */
    readonly dark: boolean;
    /** The skeleton: its version, the blend modes and the bones of its slots. */
    readonly model: SkeletonModel;
    readonly seen: VisibleList;
    readonly cover: CoverTest;
    /** The counters of the view. */
    readonly stats: ViewStats;
    /** The bounds of what is visible. Pixi asks for them when it culls or measures. */
    readonly measure: () => Bounds;
}

/**
 * What a view draws with in each of its two modes: the buffers and meshes of the mesh mode, and
 * the display object of the batched mode. Each is created when the view first draws in its mode,
 * and is hidden and kept while the view draws in the other one. A view that only ever draws in
 * one mode holds nothing of the other.
 *
 * @example
 * const paints = new ViewPaints({ container, gate: view, pages, texture, dark, model, seen, cover, stats, measure }, 'batched');
 * paints.enter('batched', template, layoutSlots(template, model.slots.count));
 * paints.body?.touch();
 */
export class ViewPaints {
    /** The buffers and meshes of the mesh mode. They exist once the view drew in it. */
    mesh: MeshPaint | undefined;
    /** The display object of the batched mode. It exists once the view drew in it. */
    body: BatchBody | undefined;
    /** The mode that draws at the moment, or the one the view expects before it has drawn. */
    mode: DrawMode;
    /** False until the view has drawn: nothing exists yet. */
    ready = false;
    private readonly options: ViewPaintsOptions;

    /** @param mode The mode the view expects to draw in. Nothing is created for it yet. */
    constructor(options: ViewPaintsOptions, mode: DrawMode) {
        this.options = options;
        this.mode = mode;
    }

    /** The batch element of the view while it draws in the batched mode. */
    get element(): BatchElement | undefined {
        return this.mode === 'batched' ? this.body?.element : undefined;
    }

    /**
     * Starts to draw in a mode. What draws in the other mode is hidden. Pixi builds the
     * instructions of the render group again for it.
     *
     * @param slots Where the slots of the template keep their vertices in a batch.
     */
    enter(mode: DrawMode, template: Template, slots: SlotLayout): void {
        const { options } = this;
        const { container, seen, cover, pages, dark, model, measure } = options;

        this.mode = mode;
        this.ready = true;
        if (mode === 'batched') {
            this.mesh?.rest(template, seen, cover.skipped);
            if (this.body === undefined) {
                this.body = new BatchBody({
                    gate: options.gate,
                    pages,
                    texture: options.texture,
                    seen,
                    cover,
                    model,
                    stats: options.stats,
                    template,
                    layout: slots,
                    measure,
                });
                container.addChild(this.body);
            }

            // the view shows the body with the next list of visible slots, unless that list is empty
            return;
        }
        if (this.body !== undefined) this.body.visible = false;
        if (this.mesh !== undefined) this.mesh.wake(template);
        else
            this.mesh = new MeshPaint({
                container,
                template,
                pages,
                dark,
                blendModes: model.slots.blendModes,
                measure,
            });
    }

    /** Takes the vertex ranges of a new layout: the buffers of the mesh mode and the element of the batched mode. */
    relayout(template: Template, slots: SlotLayout): void {
        if (this.mode === 'mesh') this.mesh?.resize(template);
        this.body?.element.relayout(template, slots);
    }

    /** Frees the buffers, the meshes and the shaders of the mesh mode. The container frees the body. */
    destroy(): void {
        this.mesh?.destroy();
    }
}
