import {
    type Batch,
    type BatchableElement,
    type Batcher,
    type BLEND_MODES,
    type Bounds,
    type Container,
    type Texture,
    type Topology,
    ViewContainer,
} from 'pixi.js';
import { i16, i32 } from '../geometry/read';
import type { PoseState } from '../pose/state';
import type { AttachCode } from './attach-code';
import type { BatchBody } from './batch-body';
import type { BatchElement, BatchPart } from './batch-element';
import type { BatchTail } from './batch-pipe';
import { PIPE_ID } from './batcher';
import type { ViewPaints } from './paints';
import type { DrawRanges } from './ranges';
import type { SkeletonView } from './skeleton-view';
import type { Template } from './template';
import type { VisibleList } from './visible';

/*
 * Containers of the user between the slots of a skeleton. A container that is attached to a slot
 * is a child of the container of the view, and it is drawn after the attachment of its slot and
 * before the next slot in the draw order.
 *
 * - In the mesh mode a draw range ends at the slot, and the container sits between two meshes.
 *   It moves among the children when another number of ranges is drawn before it.
 * - In the batched mode a run ends at the slot. The skeleton is collected first and adds the runs
 *   up to the first container. Behind every container sits a tail, which adds the runs up to the
 *   next one. All runs stay in the room of the skeleton, so its vertices are written as before.
 *   The children never move while the containers keep their order.
 *
 * No clip cuts a container, in both modes, and no slot is left out as covered for a slot on the
 * other side of a container, see `cover-search.ts`.
 */

/** One container of the user and what it is tied to: a bone it follows, or a slot it is attached to. */
export interface Link {
    readonly container: Container;
    readonly bone: number;
    /** The slot the container is attached to, or -1 for one that only follows its bone. */
    readonly slot: number;
    /** Whether the container shows only while its slot shows an attachment. */
    readonly followAttachment: boolean;
    /** Whether the tint of the container follows the color of its slot. */
    readonly followColor: boolean;
    /** True until the container was moved once. */
    fresh: boolean;
}

/** The runs of a skeleton behind an attached container, as the batcher takes them. It has no room of its own. */
class TailPart implements BatchableElement, BatchPart {
    readonly owner: BatchElement;
    readonly index: number;
    readonly indexSize = 0;
    readonly attributeSize = 0;
    readonly topology: Topology = 'triangle-list';
    readonly packAsQuad = false;
    _textureId = 0;
    _attributeStart = 0;
    _indexStart = 0;
    declare _batcher: Batcher;
    declare _batch: Batch;

    constructor(owner: BatchElement, index: number) {
        this.owner = owner;
        this.index = index;
    }

    /** The batcher of the skeleton: its runs are in the buffers of that one. */
    get batcherName(): string {
        return this.owner.batcherName;
    }

    get texture(): Texture {
        return this.owner.texture;
    }

    get blendMode(): BLEND_MODES {
        return this.owner.blendMode;
    }
}

/** What Pixi collects behind an attached container in the batched mode: it adds the runs that follow the container. */
class Tail extends ViewContainer implements BatchTail {
    override readonly renderPipeId: string = PIPE_ID;
    /** Pixi asks the pipe to update a batched object in place. A tail has nothing to update. */
    batched = true;
    readonly part: TailPart;
    private readonly body: BatchBody;

    constructor(body: BatchBody, index: number) {
        super({ label: 'marrow-tail' });
        this.body = body;
        this.part = new TailPart(body.element, index);
    }

    /** The bounds of the skeleton: the runs of a tail can be anywhere in them. */
    override get bounds(): Bounds {
        return this.body.bounds;
    }

    protected override updateBounds(): void {}
}

/**
 * The attached containers of one view: where each is drawn, and the children that keep it there.
 * A view has one from its first attached container on.
 *
 * @example
 * const inserts = new ViewInserts(view);
 * inserts.add(slot, label);
 * view.update(engine.state);
 */
export class ViewInserts {
    /** The containers and their slots, in the order they were attached. */
    readonly containers: Container[] = [];
    readonly slots: number[] = [];
    /** The containers in draw order, as the last list of visible slots has them. */
    readonly ordered: Container[] = [];
    /** Per slot: the place of its container in {@link containers}, or -1. */
    private readonly bySlot: Int16Array;
    private readonly tails: Tail[] = [];
    private readonly view: SkeletonView;

    constructor(view: SkeletonView) {
        const { seen } = view.parts;

        this.view = view;
        this.bySlot = new Int16Array(seen.shown.length).fill(-1);
        seen.starts = new Uint8Array(seen.shown.length);
        view.inserts = this;
    }

    /** Attaches a container to a slot that has none. It becomes a child of the container of the view. */
    add(slot: number, container: Container): void {
        const { seen } = this.view.parts;

        this.bySlot[slot] = this.containers.length;
        this.containers.push(container);
        this.slots.push(slot);
        if (seen.cuts.length < this.containers.length) seen.cuts = new Int32Array(this.containers.length * 2);
        this.view.container.addChild(container);
        this.touch();
    }

    /** Lets go of a container: it leaves the display list, and the slots around it draw together again. */
    remove(container: Container): void {
        const index = this.containers.indexOf(container);

        if (index < 0) return;
        this.containers.splice(index, 1);
        this.slots.splice(index, 1);
        this.bySlot.fill(-1);
        this.slots.forEach((slot, at) => {
            this.bySlot[slot] = at;
        });
        container.removeFromParent();
        this.touch();
    }

    /**
     * Finds where every container is drawn in a pose: the visible entries before it. A view calls
     * it when it has listed the visible slots again. The list is marked as other than the one the
     * index buffers hold when a container is drawn at another place than before.
     */
    cut(seen: VisibleList, template: Template, state: PoseState): void {
        const { drawOrder } = state;
        const { list, count, cuts, starts } = seen;
        const { ordered, containers, bySlot } = this;
        let visible = 0;
        let found = 0;
        let changed = seen.cutCount !== containers.length;

        starts.fill(0);
        for (let i = 0; i < drawOrder.length && found < containers.length; i++) {
            const slot = i16(drawOrder, i);
            const container = containers[i16(bySlot, slot)];

            // the entry of the slot itself is drawn before its container
            if (visible < count && i32(template.slots, i32(list, visible)) === slot) visible++;
            if (container === undefined) continue;
            if (ordered[found] !== container || i32(cuts, found) !== visible) changed = true;
            ordered[found] = container;
            cuts[found++] = visible;
            if (visible < count) starts[visible] = 1;
        }
        ordered.length = found;
        seen.cutCount = found;
        if (changed) seen.dirty = true;
    }

    /**
     * Puts the containers where they are drawn among the children of the view, after the index
     * buffers were rewritten. A child that is in its place is left alone, so Pixi builds its
     * instructions again only when a container moved.
     */
    place(paints: ViewPaints, parent: Container): void {
        const { body, mesh } = paints;
        const batched = paints.mode === 'batched' ? body : undefined;

        this.showTails(batched);
        if (batched !== undefined) {
            let at = parent.getChildIndex(batched) + 1;

            // behind the body: a container, its tail, the next container, its tail
            for (let k = 0; k < this.ordered.length; k++) {
                at = put(parent, this.ordered[k], at);
                at = put(parent, this.tails[k], at);
            }
        } else if (mesh !== undefined) this.placeBetween(mesh.ranges, parent);
    }

    /** Creates the tails the batched mode needs, and shows the ones that draw: as many as containers, while the body draws. */
    private showTails(body: BatchBody | undefined): void {
        const { ordered, tails } = this;

        for (let k = tails.length; body !== undefined && k < ordered.length; k++) tails.push(new Tail(body, k));
        tails.forEach((tail, k) => {
            tail.visible = body?.visible === true && k < ordered.length;
        });
    }

    /** Puts every container in front of the first draw range that is drawn after it, in the mesh mode. */
    private placeBetween(ranges: DrawRanges, parent: Container): void {
        const { ordered } = this;
        const { cutPositions } = ranges;

        // from the last one on: a container that shares its place with the next one sits in front of that
        for (let k = ordered.length - 1; k >= 0; k--) {
            const shares = k + 1 < ordered.length && cutPositions[k] === cutPositions[k + 1];
            const behind = shares ? ordered[k + 1] : ranges.anchor(cutPositions[k] ?? 0, false);
            const child = ordered[k];
            const index = behind === undefined ? parent.children.length : parent.getChildIndex(behind);

            if (child === undefined || parent.children[index - 1] === child) continue;
            // a child that sits further in front leaves a gap when it is taken out
            parent.addChildAt(
                child,
                child.parent === parent && parent.getChildIndex(child) < index ? index - 1 : index,
            );
        }
    }

    /**
     * The visibility, the alpha and the tint of an attached container, from its slot. As in the
     * official runtime, it shows while its bone is active and its slot has an alpha above 0.
     */
    show(item: Link, state: PoseState): void {
        const { container, slot } = item;
        const { colors } = state;
        const at = slot * 4;
        const alpha = Number(colors[at + 3]);
        const empty = item.followAttachment && (state.attachments[slot] ?? null) === null;
        const shown = this.containers.includes(container) && state.active[item.bone] === 1 && alpha > 0 && !empty;

        // Pixi builds its instructions again when a child shows or hides, so it is told only of a change
        if (container.visible !== shown) container.visible = shown;
        if (!shown) return;
        container.alpha = alpha;
        if (item.followColor) {
            container.tint =
                ((255 * Number(colors[at])) << 16) |
                ((255 * Number(colors[at + 1])) << 8) |
                (255 * Number(colors[at + 2]));
        }
    }

    /** Lets go of every container, before the view destroys its children. */
    clear(): void {
        for (const container of this.containers.splice(0)) container.removeFromParent();
        this.slots.length = 0;
        this.ordered.length = 0;
        this.bySlot.fill(-1);
        this.touch();
    }

    /** Makes the next update of the view list its slots again, also when its pose rests. */
    private touch(): void {
        const { pass, seen } = this.view.parts;

        pass.all = true;
        seen.dirty = true;
    }
}

/** Puts a child at a place among the children, when it is not there. Returns the place behind it. */
function put(parent: Container, child: Container | undefined, at: number): number {
    if (child === undefined || parent.children[at] === child) return at + 1;
    // a child that sits further in front leaves a gap when it is taken out
    const front = child.parent === parent && parent.getChildIndex(child) < at;

    parent.addChildAt(child, front ? at - 1 : at);

    return front ? at : at + 1;
}

/**
 * The code for attached containers. `attach-code.ts` hands it out once this module is loaded.
 *
 * @example
 * const { attachWork } = await import('./attach-work');
 * const inserts = attachWork.createInserts(view);
 */
export const attachWork: AttachCode = {
    createInserts: (view: SkeletonView): ViewInserts => new ViewInserts(view),
};
