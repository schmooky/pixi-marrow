import {
    BoneData as BoneData41,
    ClippingAttachment as ClippingAttachment41,
    Color as Color41,
    Skeleton as Skeleton41,
    SkeletonClipping as SkeletonClipping41,
    SkeletonData as SkeletonData41,
    SlotData as SlotData41,
} from 'spine-core-4.1';
import {
    BoneData as BoneData42,
    ClippingAttachment as ClippingAttachment42,
    Skeleton as Skeleton42,
    SkeletonClipping as SkeletonClipping42,
    SkeletonData as SkeletonData42,
    SlotData as SlotData42,
} from 'spine-core-4.2';
import {
    BoneData as BoneData43,
    ClippingAttachment as ClippingAttachment43,
    Skeleton as Skeleton43,
    SkeletonClipping as SkeletonClipping43,
    SkeletonData as SkeletonData43,
    SlotData as SlotData43,
} from 'spine-core-4.3';
import type { SpineVersion } from '../../src/base/version';
import { computeWorldVertices } from '../../src/geometry/vertices';
import type { ClippingAttachmentData } from '../../src/model/attachments';
import type { Rig } from './rig';

/*
 * The official `SkeletonClipping` of each version, driven the way the official renderers drive
 * it. The clipper is the real one. It gets a skeleton of one bone and as many slots as the model,
 * and clipping attachments that hand out a polygon of the pose kernel, which the geometry parity
 * suite compares with the official vertices.
 */

/** The official clipper of one version behind the calls its renderer makes. */
export interface OfficialClipper {
    /** `clipStart` for the clipping attachment of a slot. Returns false when a clip is active: it is ignored then. */
    start(slot: number, attachment: ClippingAttachmentData, polygon: ArrayLike<number>): boolean;
    /** `clipEndWithSlot(slot)`, which 4.3 calls `clipEnd(slot)`. */
    endAt(slot: number): void;
    /** `clipEnd()`. */
    end(): void;
    isClipping(): boolean;
    /**
     * Clips a triangle and returns the share of its area that is left: 1 when the clip keeps it
     * whole, 0 when it removes it.
     */
    kept(triangle: readonly number[]): number;
}

/** Twice the area of a triangle, never negative. */
const doubleArea = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));

/** The share of a triangle that the triangles of a clipper's output cover. `stride` is its numbers per vertex. */
function share(
    triangle: readonly number[],
    vertices: ArrayLike<number>,
    triangles: ArrayLike<number>,
    stride: number,
): number {
    const [ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0] = triangle;
    const at = (index: number, offset: number): number => vertices[(triangles[index] ?? 0) * stride + offset] ?? 0;
    let sum = 0;

    for (let t = 0; t < triangles.length; t += 3) {
        sum += doubleArea(at(t, 0), at(t, 1), at(t + 1, 0), at(t + 1, 1), at(t + 2, 0), at(t + 2, 1));
    }

    return sum / doubleArea(ax, ay, bx, by, cx, cy);
}

const TRIANGLE = [0, 1, 2];
const UVS = [0, 0, 1, 0, 0, 1];

/** What a clipping attachment of a test hands to `clipStart`. */
interface Started {
    polygon: ArrayLike<number>;
    count: number;
}

function clipper41(slots: number): OfficialClipper {
    const data = new SkeletonData41();
    const bone = new BoneData41(0, 'root', null);
    const started: Started = { polygon: [], count: 0 };

    data.bones.push(bone);
    for (let slot = 0; slot < slots; slot++) data.slots.push(new SlotData41(slot, `slot${slot}`, bone));
    const skeleton = new Skeleton41(data);
    const clipper = new SkeletonClipping41();
    const white = new Color41(1, 1, 1, 1);

    class Clip extends ClippingAttachment41 {
        override computeWorldVertices(_slot: unknown, _start: number, count: number, out: number[]): void {
            for (let i = 0; i < count; i++) out[i] = started.polygon[i] ?? Number.NaN;
            started.count++;
        }
    }
    const slotAt = (slot: number): Skeleton41['slots'][number] => {
        const found = skeleton.slots[slot];

        if (found === undefined) throw new Error(`no slot ${slot}`);

        return found;
    };

    return {
        start(slot, attachment, polygon) {
            const clip = new Clip(attachment.name);
            const before = started.count;

            clip.worldVerticesLength = attachment.worldVerticesLength;
            clip.endSlot = data.slots[attachment.endSlot] ?? null;
            started.polygon = polygon;
            clipper.clipStart(slotAt(slot), clip);

            return started.count !== before;
        },
        endAt: (slot) => clipper.clipEndWithSlot(slotAt(slot)),
        end: () => clipper.clipEnd(),
        isClipping: () => clipper.isClipping(),
        kept(triangle) {
            // 4.1 has the clipper of the renderer only: 8 numbers per vertex without a dark color
            clipper.clipTriangles([...triangle], 6, TRIANGLE, 3, UVS, white, white, false);

            return share(triangle, clipper.clippedVertices, clipper.clippedTriangles, 8);
        },
    };
}

function clipper42(slots: number): OfficialClipper {
    const data = new SkeletonData42();
    const bone = new BoneData42(0, 'root', null);
    const started: Started = { polygon: [], count: 0 };

    data.bones.push(bone);
    for (let slot = 0; slot < slots; slot++) data.slots.push(new SlotData42(slot, `slot${slot}`, bone));
    const skeleton = new Skeleton42(data);
    const clipper = new SkeletonClipping42();

    class Clip extends ClippingAttachment42 {
        override computeWorldVertices(_slot: unknown, _start: number, count: number, out: number[]): void {
            for (let i = 0; i < count; i++) out[i] = started.polygon[i] ?? Number.NaN;
            started.count++;
        }
    }
    const slotAt = (slot: number): Skeleton42['slots'][number] => {
        const found = skeleton.slots[slot];

        if (found === undefined) throw new Error(`no slot ${slot}`);

        return found;
    };

    return {
        start(slot, attachment, polygon) {
            const clip = new Clip(attachment.name);
            const before = started.count;

            clip.worldVerticesLength = attachment.worldVerticesLength;
            clip.endSlot = data.slots[attachment.endSlot] ?? null;
            started.polygon = polygon;
            clipper.clipStart(slotAt(slot), clip);

            return started.count !== before;
        },
        endAt: (slot) => clipper.clipEndWithSlot(slotAt(slot)),
        end: () => clipper.clipEnd(),
        isClipping: () => clipper.isClipping(),
        kept(triangle) {
            clipper.clipTriangles([...triangle], TRIANGLE, 3);

            return share(triangle, clipper.clippedVertices, clipper.clippedTriangles, 2);
        },
    };
}

function clipper43(slots: number): OfficialClipper {
    const data = new SkeletonData43();
    const bone = new BoneData43(0, 'root', null);
    const started: Started = { polygon: [], count: 0 };

    data.bones.push(bone);
    for (let slot = 0; slot < slots; slot++) data.slots.push(new SlotData43(slot, `slot${slot}`, bone));
    const skeleton = new Skeleton43(data);
    const clipper = new SkeletonClipping43();

    class Clip extends ClippingAttachment43 {
        override computeWorldVertices(
            _skeleton: unknown,
            _slot: unknown,
            _start: number,
            count: number,
            out: number[],
        ): void {
            for (let i = 0; i < count; i++) out[i] = started.polygon[i] ?? Number.NaN;
            started.count++;
        }
    }
    const slotAt = (slot: number): Skeleton43['slots'][number] => {
        const found = skeleton.slots[slot];

        if (found === undefined) throw new Error(`no slot ${slot}`);

        return found;
    };

    return {
        start(slot, attachment, polygon) {
            const clip = new Clip(attachment.name);
            const before = started.count;

            clip.worldVerticesLength = attachment.worldVerticesLength;
            clip.endSlot = data.slots[attachment.endSlot] ?? null;
            clip.convex = attachment.convex;
            clip.inverse = attachment.inverse;
            started.polygon = polygon;
            clipper.clipStart(skeleton, slotAt(slot), clip);

            return started.count !== before;
        },
        endAt: (slot) => clipper.clipEnd(slotAt(slot)),
        end: () => clipper.clipEnd(),
        isClipping: () => clipper.isClipping(),
        kept(triangle) {
            clipper.clipTriangles([...triangle], TRIANGLE, 3);

            return share(triangle, clipper.clippedVertices, clipper.clippedTriangles, 2);
        },
    };
}

/** The official `SkeletonClipping` of a version, with a skeleton of that many slots. */
export function officialClipper(version: SpineVersion, slots: number): OfficialClipper {
    if (version === '4.1') return clipper41(slots);

    return version === '4.2' ? clipper42(slots) : clipper43(slots);
}

/** What the official draw loop does with the clips of a pose. */
export interface OfficialClips {
    /** Per visible slot, in draw order: the slot whose clipping attachment cuts it, or -1. */
    cuts: number[];
    /** The slots whose clipping attachment started a clip, in draw order. */
    started: number[];
}

/** The polygon of the clipping attachment a slot shows, placed by the pose kernel in 64 bits. */
export function clipPolygon(rig: Rig, slot: number, attachment: ClippingAttachmentData): Float64Array {
    const { state } = rig.engine;
    const polygon = new Float64Array(attachment.worldVerticesLength);
    const deform = state.deform[slot] ?? new Float64Array(0);

    computeWorldVertices(
        attachment,
        state.world,
        rig.model.slots.bones[slot] ?? -1,
        deform,
        state.deformLengths[slot] ?? 0,
        polygon,
    );

    return polygon;
}

/** What {@link walkOfficial} is told while the clip of a slot is active. */
type OnClip = (slot: number, attachment: ClippingAttachmentData, clipper: OfficialClipper) => void;

/** The state of one run of the official draw loop. */
interface Walk {
    rig: Rig;
    clipper: OfficialClipper;
    clips: OfficialClips;
    /** The slot whose clipping attachment started the clip that is active, if one is. */
    current: number;
    onClip: OnClip | undefined;
}

/** The pass of the official draw loop for one slot. */
function visit(walk: Walk, slot: number): void {
    const { rig, clipper, clips } = walk;
    const { state } = rig.engine;
    const attachment = state.attachments[slot];

    if (state.active[rig.model.slots.bones[slot] ?? -1] !== 1) {
        clipper.endAt(slot);

        return;
    }
    if (attachment?.type === 'clipping') {
        // new in 4.3: the clip that ends at this slot ends before the next one starts
        if (rig.model.version === '4.3') clipper.endAt(slot);
        if (clipper.start(slot, attachment, clipPolygon(rig, slot, attachment))) {
            walk.current = slot;
            clips.started.push(slot);
            walk.onClip?.(slot, attachment, clipper);
        }

        // `continue` in the official loop: the clipper is not asked to end at this slot
        return;
    }
    if (attachment?.type === 'region' || attachment?.type === 'mesh') {
        // skipRender in the official runtime: a slot without alpha is not drawn and not clipped
        if ((state.colors[slot * 4 + 3] ?? 0) * (attachment.color[3] ?? 0) !== 0) {
            clips.cuts.push(clipper.isClipping() ? walk.current : -1);
        }
    }
    clipper.endAt(slot);
}

/**
 * Runs the draw loop of the official renderer of the rig's version over the current pose, with
 * the official clipper. `onClip` is called while the clip of a slot is active.
 *
 * The loop is the one of the official Pixi runtime: `Spine.transformAttachments` of
 * spine-pixi-v8 4.2 and 4.3. Spine 4.1 has no Pixi v8 runtime and takes the 4.2 loop with its own
 * clipper. One line is not from spine-pixi-v8 4.2: the test for an inactive bone. That runtime
 * has none and draws such slots. The line is the one of `SkeletonRenderer.draw` in spine-webgl
 * 4.2, which spine-pixi-v8 4.3 has too.
 */
export function walkOfficial(rig: Rig, onClip?: OnClip): OfficialClips {
    const clipper = officialClipper(rig.model.version, rig.model.slots.count);
    const walk: Walk = { rig, clipper, clips: { cuts: [], started: [] }, current: -1, onClip };

    for (const slot of rig.engine.state.drawOrder) visit(walk, slot);
    clipper.end();

    return walk.clips;
}
