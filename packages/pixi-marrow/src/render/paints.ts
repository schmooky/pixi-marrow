import type { Bounds, Container, Texture, TextureSource } from 'pixi.js';
import type { SkeletonModel } from '../model/model';
import { BatchBody } from './batch-body';
import type { BatchElement } from './batch-element';
import type { SlotLayout } from './batch-layout';
import type { CoverTest } from './cover';
import type { DrawGate } from './gate';
import { loadMeshCode, meshCode, meshCodeState } from './mesh-code';
import type { MeshPaint } from './mesh-paint';
import { type ModeReason, modeFor, modeReason, type RenderMode } from './mode';
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
    /** Whether the vertex shader of the mesh mode places the vertices from the bones where it can. */
    readonly gpu: boolean;
}

/**
 * What a view draws with in each of its two modes: the buffers and meshes of the mesh mode, and
 * the display object of the batched mode. Each is created when the view first draws in its mode,
 * and is hidden and kept while the view draws in the other one. A view that only ever draws in
 * one mode holds nothing of the other. The code of the mesh mode loads on demand, see
 * `mesh-code.ts`.
 *
 * @example
 * const paints = new ViewPaints({ container, gate: view, pages, texture, dark, model, seen, cover, stats, measure, gpu });
 * const mode = paints.pick('auto', slots.plain, false);
 * if (mode !== undefined) paints.enter(mode, template, slots);
 * paints.body?.touch();
 */
export class ViewPaints {
    /** The buffers and meshes of the mesh mode. They exist once the view drew in it. */
    mesh: MeshPaint | undefined;
    /** The display object of the batched mode. It exists once the view drew in it. */
    body: BatchBody | undefined;
    /** The mode that draws at the moment. Before the view has drawn it is the batched mode. */
    mode: DrawMode;
    /** False until the view has drawn: nothing exists yet. */
    ready = false;
    /** Why the view should draw in the mode it should, which is not always {@link mode}. */
    reason: ModeReason = 'option';
    /**
     * True while the view should draw with meshes and the code of the mesh mode is not loaded.
     * It draws in a batch until then, and nothing where a renderer cannot batch it.
     */
    waits = false;
    private readonly options: ViewPaintsOptions;

    /** Nothing is created yet: the first update of the view picks a mode and enters it. */
    constructor(options: ViewPaintsOptions) {
        this.options = options;
        this.mode = 'batched';
    }

    /**
     * Picks the mode for the option of the view, the vertices its skeleton has in a batch and
     * whether a renderer refused to batch it. Returns the mode to enter, or undefined when the
     * view draws in it already.
     *
     * A view that should draw with meshes before their code is loaded gets the batched mode, and
     * the code is asked for when nobody did so before. After a load that failed, a command asks
     * again and an update does not.
     */
    pick(choice: RenderMode, vertices: number, refused: boolean): DrawMode | undefined {
        const reason = modeReason(choice, vertices, refused);
        const wanted = modeFor(choice, reason);

        this.reason = reason;
        this.waits = wanted === 'mesh' && meshCode() === undefined;
        if (this.waits && meshCodeState() === 'idle') void loadMeshCode();
        const mode = this.waits ? 'batched' : wanted;

        return mode !== this.mode || !this.ready ? mode : undefined;
    }

    /** Whether a layout needs a color per vertex: the mesh mode without a palette, which `gpu` has. */
    get vertexColors(): boolean {
        return this.mode === 'mesh' && !this.options.gpu;
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
        const { container, seen, cover, pages, dark, model, measure, gpu } = options;

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
        // the view enters the mesh mode only once its code is loaded
        else this.mesh = meshCode()?.createPaint({ container, template, pages, dark, model, measure, gpu });
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
