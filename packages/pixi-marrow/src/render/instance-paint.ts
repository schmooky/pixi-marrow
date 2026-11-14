import { type Bounds, type Renderer, type TextureSource, ViewContainer } from 'pixi.js';
import { i32 } from '../geometry/read';
import type { PoseState } from '../pose/state';
import type { DrawGate } from './gate';
import type { InstanceLayout, LayoutBlock, Union } from './instance-layout';
import { INSTANCE_PIPE, type InstanceRun, linkInstancePipe } from './instance-pipe';
import type { PoolSlot } from './instance-pool';
import type { Template } from './template';
import type { VisibleList } from './visible';

/*
 * What one view of the mesh mode holds to draw instanced: a slot in a pool of its layout, the
 * index buffer of its draw order, and the body that Pixi hands the pipe of instanced draws. The
 * view writes its pose into the slot, see `skin-store.ts`. The body draws nothing itself.
 */

/**
 * Why a view of the mesh mode draws alone, or null while it draws instanced.
 *
 * - `off`: the option `instancing` is `off`.
 * - `cpu`: the CPU places the vertices, without `skinning: 'gpu'`.
 * - `blend`, `pages`, `size`: the layout needs more than one draw range, or has too many entries.
 * - `clip`: a clipping attachment cuts a visible slot, which takes a stencil mask.
 * - `attached`: a container that is attached to a slot is drawn between the slots.
 * - `deform`: a mesh deforms that the layout keeps no texels for.
 */
export type InstanceWhy = 'off' | 'cpu' | LayoutBlock | 'clip' | 'attached' | 'deform' | null;

/** Puts the pipe of instanced draws into the renderer that is about to draw a body. */
function link(this: InstanceBody, renderer: Renderer): void {
    if (renderer === this.linked) return;
    this.linked = renderer;
    linkInstancePipe(renderer);
}

/**
 * The display object of a view that draws instanced. Pixi hands it to the pipe of instanced
 * draws, which draws it with the bodies around it.
 *
 * @example
 * const body = new InstanceBody(paint, view, measure);
 * container.addChild(body);
 */
export class InstanceBody extends ViewContainer {
    override readonly renderPipeId: string = INSTANCE_PIPE;
    /** Pixi reads it of every view. The body draws in a draw of its own pipe. */
    batched = false;
    /** The view, which is asked before every draw. */
    readonly gate: DrawGate;
    readonly paint: InstancePaint;
    /** The run the body was put into by the last build of the instructions. */
    run: InstanceRun | undefined;
    /** The instances in the draw of this body in the last frame, 0 when it drew nothing. */
    drawnWith = 0;
    /** The renderer that drew the body last, which has the pipe. */
    linked: Renderer | null = null;
    private readonly measure: () => Bounds;

    constructor(paint: InstancePaint, gate: DrawGate, measure: () => Bounds) {
        super({ label: 'marrow-instances' });
        this.paint = paint;
        this.gate = gate;
        this.measure = measure;
        this.visible = false;
        this.onRender = link;
    }

    /** The bounds of the visible slots, in the space of the skeleton. */
    override get bounds(): Bounds {
        return this.measure();
    }

    /** The bounds come from the view, so there is nothing to compute here. */
    protected override updateBounds(): void {}
}

/**
 * The instanced draw of one view: its slot, its index buffer and its body.
 *
 * @example
 * const paint = new InstancePaint(view, measure, pages, dark);
 * container.addChild(paint.body);
 * skin.use(paint.enter(shared, state.drawOrder));
 */
export class InstancePaint {
    readonly body: InstanceBody;
    readonly dark: boolean;
    /** The shared draw of the layout while the view draws instanced. */
    layout: InstanceLayout | undefined;
    slot: PoolSlot | undefined;
    union: Union | undefined;
    /** The pages of the view, as the array that the views of the layout with the same pages share. */
    pages: readonly TextureSource[];
    private readonly own: readonly TextureSource[];

    constructor(gate: DrawGate, measure: () => Bounds, pages: readonly TextureSource[], dark: boolean) {
        this.own = pages;
        this.pages = pages;
        this.dark = dark;
        this.body = new InstanceBody(this, gate, measure);
    }

    /** The bytes of the slot of the view in its pool, while it draws instanced. */
    get bytes(): number {
        return this.slot?.pool.slotBytes ?? 0;
    }

    /** Starts to draw instanced: takes a slot in a pool of the layout and the index buffer of a draw order. */
    enter(layout: InstanceLayout, order: Int16Array): PoolSlot {
        const slot = layout.take();

        this.layout = layout;
        this.pages = layout.intern(this.own);
        this.slot = slot;
        this.union = layout.union(order);
        this.body.visible = true;

        return slot;
    }

    /** Takes the index buffer of another draw order, when the pose has one. */
    follow(state: PoseState): void {
        const { layout, union } = this;

        if (layout === undefined || union === undefined || layout.holds(union, state.drawOrder)) return;
        layout.drop(union);
        this.union = layout.union(state.drawOrder);
    }

    /** Writes the entry each slot shows, after the visible list changed. */
    show(template: Template, seen: VisibleList, skipped: Uint8Array): void {
        this.slot?.show(template, seen.list, seen.count, skipped);
    }

    /** Writes the page each visible entry shows, after a sequence showed other regions. */
    reframe(template: Template, seen: VisibleList): void {
        const { slot } = this;

        if (slot === undefined) return;
        for (let i = 0; i < seen.count; i++) slot.page(template, i32(seen.list, i));
    }

    /** Stops to draw instanced: gives the slot and the index buffer back and hides the body. */
    leave(): void {
        const { layout, union } = this;

        this.slot?.release();
        if (layout !== undefined && union !== undefined) layout.drop(union);
        this.slot = undefined;
        this.union = undefined;
        this.layout = undefined;
        this.body.visible = false;
    }

    /** Stops to draw instanced and takes the body out of its run. The view destroys the body with its container. */
    destroy(): void {
        this.leave();
        this.body.run?.drop(this.body);
        this.body.run = undefined;
    }
}
