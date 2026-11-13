import { attachmentRegions, readRegion, resolveSequenceIndex } from '../geometry/atlas-regions';
import type { FloatArray } from '../geometry/read';
import { computeRegionOffsets, computeRegionWorldVertices } from '../geometry/region';
import { computeWorldVertices } from '../geometry/vertices';
import type { AtlasModel } from '../model/atlas';
import type { AttachmentData, RegionAttachmentData, VertexData } from '../model/attachments';
import { type AttachmentLookup, meshSource } from '../pose/shared/lookup';
import { type PoseState, WORLD_STRIDE } from '../pose/state';

/*
 * What the debug overlays draw, as plain numbers in the space of the display object: the
 * skeleton as the official runtime computes it, from the pose of the last update. No Pixi here,
 * so the shapes can be checked in Node against the geometry functions of the core.
 */

/** A path attachment: its world vertices and whether it closes. */
export interface PathShape {
    readonly points: Float64Array;
    readonly closed: boolean;
}

/** Everything the overlays draw of one pose. Each list holds x, y pairs unless it says otherwise. */
export interface DebugShapes {
    /** Per bone that is posed: x, y of its start, then x, y of its tip. 4 numbers each. */
    readonly bones: number[];
    /** The 4 corners of every region attachment shown. */
    readonly regions: Float64Array[];
    /** The hull of every mesh shown. */
    readonly hulls: Float64Array[];
    /** The triangles of every mesh shown: 6 numbers per triangle. */
    readonly triangles: number[];
    /** The polygon of every bounding box attachment shown. */
    readonly boxes: Float64Array[];
    /** The polygon of every clipping attachment shown. */
    readonly clips: Float64Array[];
    readonly paths: PathShape[];
    /** Per point attachment shown: x, y, then the direction of its rotation as a unit vector. 4 numbers each. */
    readonly points: number[];
}

/**
 * The region offsets of a region attachment, per frame of its sequence. Built once per attachment.
 * 32-bit before 4.3, as the official runtime keeps them.
 */
export type RegionOffsets = Map<RegionAttachmentData, FloatArray[]>;

function offsetsOf(
    cache: RegionOffsets,
    state: PoseState,
    atlas: AtlasModel,
    region: RegionAttachmentData,
): FloatArray[] {
    let frames = cache.get(region);

    if (frames === undefined) {
        const wide = state.model.version === '4.3';

        frames = [...attachmentRegions(atlas, region)].map((index) => {
            const out = wide ? new Float64Array(8) : new Float32Array(8);

            computeRegionOffsets(state.model.version, region, readRegion(atlas, index), out);

            return out;
        });
        cache.set(region, frames);
    }

    return frames;
}

/** The world vertices of a vertex attachment of a slot, with the deform of the slot. */
function worldOf(state: PoseState, slot: number, bone: number, data: VertexData): Float64Array {
    const out = new Float64Array(data.worldVerticesLength);
    const deform = state.deform[slot] ?? new Float64Array(0);

    computeWorldVertices(data, state.world, bone, deform, state.deformLengths[slot] ?? 0, out);

    return out;
}

/** Adds the shapes of the attachment one slot shows. */
function addAttachment(
    shapes: DebugShapes,
    state: PoseState,
    lookup: AttachmentLookup,
    atlas: AtlasModel,
    cache: RegionOffsets,
    slot: number,
    attachment: AttachmentData,
): void {
    const bone = state.model.slots.bones[slot] ?? 0;

    switch (attachment.type) {
        case 'region': {
            const frames = offsetsOf(cache, state, atlas, attachment);
            const frame = resolveSequenceIndex(attachment.sequence, state.sequenceIndices[slot] ?? -1);
            const offsets = frames[Math.max(0, frame)];

            if (offsets === undefined) return;
            const corners = new Float64Array(8);

            computeRegionWorldVertices(offsets, 0, state.world, bone, corners);
            shapes.regions.push(corners);

            return;
        }
        case 'mesh': {
            // a linked mesh has the geometry of its source
            const source = meshSource(lookup, attachment);
            const world = worldOf(state, slot, bone, source);
            const { triangles } = source;

            for (let i = 0; i + 2 < triangles.length; i += 3) {
                for (let k = 0; k < 3; k++) {
                    const vertex = (triangles[i + k] ?? 0) * 2;

                    shapes.triangles.push(world[vertex] ?? 0, world[vertex + 1] ?? 0);
                }
            }
            if (source.hullLength > 0) shapes.hulls.push(world.slice(0, (source.hullLength >> 1) * 2));

            return;
        }
        case 'boundingbox':
            shapes.boxes.push(worldOf(state, slot, bone, attachment));

            return;
        case 'clipping':
            shapes.clips.push(worldOf(state, slot, bone, attachment));

            return;
        case 'path':
            shapes.paths.push({ points: worldOf(state, slot, bone, attachment), closed: attachment.closed });

            return;
        case 'point': {
            // the official `computeWorldPosition` and `computeWorldRotation`
            const m = bone * WORLD_STRIDE;
            const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = state.world.subarray(m, m + 6);
            const radians = (attachment.rotation * Math.PI) / 180;
            const dx = Math.cos(radians) * a + Math.sin(radians) * b;
            const dy = Math.cos(radians) * c + Math.sin(radians) * d;
            const length = Math.hypot(dx, dy) || 1;

            shapes.points.push(attachment.x * a + attachment.y * b + x, attachment.x * c + attachment.y * d + y);
            shapes.points.push(dx / length, dy / length);

            return;
        }
    }
}

/**
 * The shapes of one pose: every posed bone, and the attachment of every slot whose bone is
 * active, in draw order. The official debug renderer reads the same slots.
 *
 * @param cache Region offsets kept from one call to the next. Pass the same map every time.
 *
 * @example
 * const shapes = collectShapes(engine.state, createAttachmentLookup(model), atlas, new Map());
 * console.log(shapes.bones.length / 4, shapes.regions.length);
 */
export function collectShapes(
    state: PoseState,
    lookup: AttachmentLookup,
    atlas: AtlasModel,
    cache: RegionOffsets,
): DebugShapes {
    const { model, world, active, drawOrder, attachments } = state;
    const shapes: DebugShapes = {
        bones: [],
        regions: [],
        hulls: [],
        triangles: [],
        boxes: [],
        clips: [],
        paths: [],
        points: [],
    };

    for (let bone = 0; bone < model.bones.count; bone++) {
        if (active[bone] !== 1) continue;
        const m = bone * WORLD_STRIDE;
        const length = model.bones.lengths[bone] ?? 0;
        const x = world[m + 4] ?? 0;
        const y = world[m + 5] ?? 0;

        // the x axis of the bone points along its length
        shapes.bones.push(x, y, x + length * (world[m] ?? 0), y + length * (world[m + 2] ?? 0));
    }
    for (let i = 0; i < drawOrder.length; i++) {
        const slot = drawOrder[i] ?? 0;
        const attachment = attachments[slot] ?? null;

        if (attachment === null || active[model.slots.bones[slot] ?? 0] !== 1) continue;
        addAttachment(shapes, state, lookup, atlas, cache, slot, attachment);
    }

    return shapes;
}

/** The box around all bounding box polygons, as x, y, width, height, or null without any. */
export function boxBounds(boxes: readonly Float64Array[]): [number, number, number, number] | null {
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];

    for (const box of boxes) {
        for (let i = 0; i + 1 < box.length; i += 2) {
            const x = box[i] ?? 0;
            const y = box[i + 1] ?? 0;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }

    return minX === Infinity ? null : [minX, minY, maxX - minX, maxY - minY];
}
