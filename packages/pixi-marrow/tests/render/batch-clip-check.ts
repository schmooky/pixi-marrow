import { expect } from 'vitest';
import { colorByte } from '../../src/render/colors';
import { type OfficialClip, officialClip } from '../parity/clip-official';
import { bodyOf, elementOf, readRuns, readVertex } from './batch-stage';
import { clipPolygon, walkOfficial } from './clip-official';
import { type Drawable, kernelPositions, kernelUVs, type Rig, trianglesOf, visibleSlots } from './rig';

/*
 * What a batch must draw for a skeleton with clips: the triangles the official clipper leaves
 * for every visible slot, in draw order. The reference is the official `SkeletonClipping` of
 * the model's version, which gets the polygon and the vertices of the geometry kernel.
 *
 * A batch may draw a slot that the clip leaves whole with the vertices its triangles share,
 * and the official clipper gives every triangle three vertices of its own. So the two are
 * compared corner by corner, as the triangles are drawn, and not vertex number by vertex number.
 */

/** One corner of a triangle that is drawn: where it is, what it samples and its colors. */
interface Corner {
    x: number;
    y: number;
    u: number;
    v: number;
    light: number;
    slot: string;
}

/** A color of a pose as the bytes of a vertex: 0xAABBGGRR. */
function colorOf(rig: Rig, slot: number, tint: ArrayLike<number>): number {
    const { colors } = rig.engine.state;
    const byte = (channel: number): number => colorByte((colors[slot * 4 + channel] ?? 0) * (tint[channel] ?? 0));

    return (byte(0) | (byte(1) << 8) | (byte(2) << 16) | (byte(3) << 24)) >>> 0;
}

/** The triangles of one slot as the official runtime draws them: after its clipper, when a clip is active. */
interface SlotDraw {
    positions: Float32Array;
    uvs: Float32Array;
    indices: ArrayLike<number>;
    /** Whether a clip was active, and whether it changed the triangles. */
    clipped: boolean;
    changed: boolean;
}

/** Runs the triangles of a visible slot through the official clipper when a clip cuts the slot. */
function officialSlot(rig: Rig, clipper: OfficialClip, slot: number, attachment: Drawable, clipped: boolean): SlotDraw {
    const triangles = trianglesOf(rig, attachment);
    const positions = kernelPositions(rig, slot, attachment);
    const { uvs } = kernelUVs(rig, slot, attachment);

    if (!clipped) return { positions, uvs, indices: triangles, clipped, changed: false };
    clipper.run(positions, uvs, triangles);
    const left = clipper.read();
    const whole = left.indices.length === triangles.length && left.positions.length === triangles.length * 2;

    return { ...left, clipped, changed: !whole };
}

/** What the official runtime draws for the pose of a rig, corner by corner, in the space of the skeleton. */
function officialCorners(rig: Rig): { corners: Corner[]; cut: number; whole: number } {
    const { cuts } = walkOfficial(rig);
    const clipper = officialClip(rig.model.version);
    const corners: Corner[] = [];
    let current = -1;
    let cut = 0;
    let whole = 0;

    visibleSlots(rig).forEach(({ slot, attachment }, place) => {
        const clip = cuts[place] ?? -1;
        const shown = rig.engine.state.attachments[clip];

        if (clip !== current && current !== -1) clipper.end();
        if (clip !== current && shown?.type === 'clipping') {
            clipper.start(clipPolygon(rig, clip, shown), shown.inverse, shown.convex);
        }
        current = clip;
        const draw = officialSlot(rig, clipper, slot, attachment, clip !== -1);
        const light = colorOf(rig, slot, attachment.color);

        if (draw.changed) cut++;
        else if (draw.clipped) whole++;
        for (let i = 0; i < draw.indices.length; i++) {
            const vertex = (draw.indices[i] ?? 0) * 2;

            corners.push({
                x: draw.positions[vertex] ?? Number.NaN,
                y: draw.positions[vertex + 1] ?? Number.NaN,
                u: draw.uvs[vertex] ?? Number.NaN,
                v: draw.uvs[vertex + 1] ?? Number.NaN,
                light,
                slot: rig.model.slots.names[slot] ?? '',
            });
        }
    });

    return { corners, cut, whole };
}

/** What a check of a clipped batch counted. */
export interface ClipCount {
    /** Visible slots inside a clip that the official clipper changed. */
    cut: number;
    /** Visible slots inside a clip that it left as they were. */
    whole: number;
    /** The corners that were compared. */
    corners: number;
}

/**
 * Checks that the batch draws for a rig what the official clipper leaves: every triangle, in
 * order, with the positions under the transform of the display object, the texture coordinates
 * and the color of its slot, to the bit. Returns what it counted.
 */
export function expectClippedBatch(rig: Rig): ClipCount {
    const { view } = rig;
    const { a, b, c, d, tx, ty } = bodyOf(view)?.groupTransform ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const { corners, cut, whole } = officialCorners(rig);
    const drawn = readRuns(view).flat();
    const problems: string[] = [];

    expect(elementOf(view).resized, 'the batch has room for the skeleton').toBe(false);
    expect(drawn.length, 'corners the batch draws').toBe(corners.length);
    for (let i = 0; i < corners.length && problems.length < 5; i++) {
        const want = corners[i];
        const held = readVertex(view, drawn[i] ?? -1);

        if (want === undefined) continue;
        const x = Math.fround(a * want.x + c * want.y + tx);
        const y = Math.fround(d * want.y + b * want.x + ty);

        if (!Object.is(held.x, x) || !Object.is(held.y, y)) {
            problems.push(`corner ${i} of ${want.slot} is at ${held.x}, ${held.y} and not at ${x}, ${y}`);
        }
        // a triangle without area that is cut has texture coordinates that are no numbers, on both sides
        if (!Object.is(held.u, want.u) || !Object.is(held.v, want.v)) {
            problems.push(`corner ${i} of ${want.slot} samples ${held.u}, ${held.v} and not ${want.u}, ${want.v}`);
        }
        if (held.light !== want.light) problems.push(`corner ${i} of ${want.slot} has the color ${held.light}`);
    }
    expect(problems).toEqual([]);

    return { cut, whole, corners: corners.length };
}
