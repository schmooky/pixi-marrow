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
import type { SpineVersion } from '../../src/core';

/*
 * The official `SkeletonClipping` of each version as the reference of the CPU clip kernel. The
 * clipper is the real one. It gets a skeleton of one bone and one slot, and a clipping attachment
 * that hands out the polygon of the test. The triangles go through the call the official
 * renderer of the version makes:
 *
 * - 4.1: `clipTriangles` of spine-webgl, which packs 8 numbers per vertex with a color.
 * - 4.2: `clipTrianglesUnpacked` of spine-pixi-v8.
 * - 4.3: `clipTrianglesUnpacked` of spine-pixi-v8, which stores 32-bit floats itself.
 */

/** What an official clipper leaves for one slot, as its renderer stores it: in 32-bit floats. */
interface OfficialClipped {
    /** x, y per vertex. */
    positions: Float32Array;
    /** u, v per vertex. */
    uvs: Float32Array;
    /** Three vertex numbers per triangle. */
    indices: Uint16Array;
}

/** The official clipper of one version behind the calls a renderer makes. */
export interface OfficialClip {
    /** `clipStart` with the world vertices of a clipping attachment and its 4.3 flags. */
    start(polygon: ArrayLike<number>, inverse: boolean, convex: boolean): void;
    /** The polygon after `clipStart` has shaped it, without a closing vertex: clockwise, or the hull. */
    shaped(): Float64Array;
    /** The convex parts `clipStart` left, each with its first vertex again at the end. */
    parts(): Float64Array[];
    /**
     * The clip call of the renderer for the triangles of one slot. Nothing else, so it can be
     * timed. The triangles are a plain array, as the official renderers hand them over.
     */
    run(positions: Float32Array, uvs: Float32Array, triangles: number[]): void;
    /** A copy of what the last {@link run} left. */
    read(): OfficialClipped;
    /** `clipEnd`. */
    end(): void;
}

/** Reads a field the official typings mark private. */
function numbersOf(owner: object, field: string): number[] {
    const value: unknown = Reflect.get(owner, field);

    if (!Array.isArray(value)) throw new Error(`the official clipper has no array "${field}"`);

    return value;
}

/** The private `clippingPolygons` of an official clipper. */
function polygonsOf(clipper: object): number[][] {
    const value: unknown = Reflect.get(clipper, 'clippingPolygons');

    if (!Array.isArray(value)) throw new Error('the official clipper has no polygons');

    return value;
}

/** What a clipping attachment of a test hands to `clipStart`. */
interface Started {
    polygon: ArrayLike<number>;
}

function handOut(started: Started, count: number, out: number[]): void {
    for (let i = 0; i < count; i++) out[i] = started.polygon[i] ?? Number.NaN;
}

function clip41(): OfficialClip {
    const data = new SkeletonData41();
    const bone = new BoneData41(0, 'root', null);
    const started: Started = { polygon: [] };

    data.bones.push(bone);
    data.slots.push(new SlotData41(0, 'slot', bone));
    const [slot] = new Skeleton41(data).slots;
    const clipper = new SkeletonClipping41();
    const white = new Color41(1, 1, 1, 1);

    class Clip extends ClippingAttachment41 {
        override computeWorldVertices(_slot: unknown, _start: number, count: number, out: number[]): void {
            handOut(started, count, out);
        }
    }
    if (slot === undefined) throw new Error('the official skeleton has no slot');

    return {
        start(polygon) {
            const clip = new Clip('clip');

            clip.worldVerticesLength = polygon.length;
            started.polygon = polygon;
            clipper.clipStart(slot, clip);
        },
        shaped: () => Float64Array.from(numbersOf(clipper, 'clippingPolygon')),
        parts: () => polygonsOf(clipper).map((part) => Float64Array.from(part)),
        run(positions, uvs, triangles) {
            clipper.clipTriangles(positions, positions.length, triangles, triangles.length, uvs, white, white, false);
        },
        read() {
            const packed = clipper.clippedVertices;
            const count = packed.length / 8;
            const positions = new Float32Array(count * 2);
            const uvs = new Float32Array(count * 2);

            for (let i = 0; i < count; i++) {
                positions.set(packed.slice(i * 8, i * 8 + 2), i * 2);
                uvs.set(packed.slice(i * 8 + 6, i * 8 + 8), i * 2);
            }

            return { positions, uvs, indices: Uint16Array.from(clipper.clippedTriangles) };
        },
        end: () => clipper.clipEnd(),
    };
}

function clip42(): OfficialClip {
    const data = new SkeletonData42();
    const bone = new BoneData42(0, 'root', null);
    const started: Started = { polygon: [] };

    data.bones.push(bone);
    data.slots.push(new SlotData42(0, 'slot', bone));
    const [slot] = new Skeleton42(data).slots;
    const clipper = new SkeletonClipping42();

    class Clip extends ClippingAttachment42 {
        override computeWorldVertices(_slot: unknown, _start: number, count: number, out: number[]): void {
            handOut(started, count, out);
        }
    }
    if (slot === undefined) throw new Error('the official skeleton has no slot');

    return {
        start(polygon) {
            const clip = new Clip('clip');

            clip.worldVerticesLength = polygon.length;
            started.polygon = polygon;
            clipper.clipStart(slot, clip);
        },
        shaped: () => Float64Array.from(numbersOf(clipper, 'clippingPolygon')),
        parts: () => polygonsOf(clipper).map((part) => Float64Array.from(part)),
        run(positions, uvs, triangles) {
            clipper.clipTrianglesUnpacked(positions, triangles, triangles.length, uvs);
        },
        read: () => ({
            positions: Float32Array.from(clipper.clippedVertices),
            uvs: Float32Array.from(clipper.clippedUVs),
            indices: Uint16Array.from(clipper.clippedTriangles),
        }),
        end: () => clipper.clipEnd(),
    };
}

function clip43(): OfficialClip {
    const data = new SkeletonData43();
    const bone = new BoneData43(0, 'root', null);
    const started: Started = { polygon: [] };

    data.bones.push(bone);
    data.slots.push(new SlotData43(0, 'slot', bone));
    const skeleton = new Skeleton43(data);
    const [slot] = skeleton.slots;
    const clipper = new SkeletonClipping43();

    class Clip extends ClippingAttachment43 {
        override computeWorldVertices(
            _skeleton: unknown,
            _slot: unknown,
            _start: number,
            count: number,
            out: number[],
        ): void {
            handOut(started, count, out);
        }
    }
    if (slot === undefined) throw new Error('the official skeleton has no slot');

    return {
        start(polygon, inverse, convex) {
            const clip = new Clip('clip');

            clip.worldVerticesLength = polygon.length;
            clip.inverse = inverse;
            clip.convex = convex;
            started.polygon = polygon;
            clipper.clipStart(skeleton, slot, clip);
        },
        shaped() {
            const polygon = numbersOf(clipper, 'clippingPolygon');
            // a polygon that is used whole is its own part, and closed
            const whole = polygonsOf(clipper)[0] === polygon;

            return Float64Array.from(whole ? polygon.slice(0, -2) : polygon);
        },
        parts: () => polygonsOf(clipper).map((part) => Float64Array.from(part)),
        run(positions, uvs, triangles) {
            clipper.clipTrianglesUnpacked(positions, 0, triangles, triangles.length, uvs);
        },
        read: () => ({
            positions: clipper.clippedVerticesTyped.slice(),
            uvs: clipper.clippedUVsTyped.slice(),
            indices: clipper.clippedTrianglesTyped.slice(),
        }),
        end: () => clipper.clipEnd(),
    };
}

/** A fresh official `SkeletonClipping` of a version. */
export function officialClip(version: SpineVersion): OfficialClip {
    if (version === '4.1') return clip41();

    return version === '4.2' ? clip42() : clip43();
}
