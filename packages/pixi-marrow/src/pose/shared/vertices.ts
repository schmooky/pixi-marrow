import type { VertexData } from '../../model/attachments';
import { WORLD_STRIDE } from '../state';
import { type FloatArray, f32, f64, float, i16 } from './read';

/**
 * Writes the world positions of points that follow one bone: `x * a + y * b + worldX` and
 * `x * c + y * d + worldY`, in the operation order of the official runtime.
 *
 * `points` holds x, y pairs from `start` on. `world` is `PoseState.world`. One pair is written
 * every `stride` numbers from `offset` up to `end`, which is not written.
 *
 * @example
 * const out = new Float32Array(8);
 * // the four corners of a region attachment
 * transformPoints(offsets, 0, state.world, model.slots.bones[slot] ?? 0, out, 0, 8, 2);
 */
export function transformPoints(
    points: FloatArray,
    start: number,
    world: Float64Array,
    bone: number,
    out: FloatArray,
    offset: number,
    end: number,
    stride: number,
): void {
    const m = bone * WORLD_STRIDE;
    const a = f64(world, m);
    const b = f64(world, m + 1);
    const c = f64(world, m + 2);
    const d = f64(world, m + 3);
    const x = f64(world, m + 4);
    const y = f64(world, m + 5);

    for (let v = start, w = offset; w < end; v += 2, w += stride) {
        const vx = float(points, v);
        const vy = float(points, v + 1);

        out[w] = vx * a + vy * b + x;
        out[w + 1] = vx * c + vy * d + y;
    }
}

/** The position in `bones` of the vertex that `start` points at. Each vertex before it is skipped. */
function skipVertices(bones: Int16Array, start: number): number {
    let v = 0;

    for (let i = 0; i < start; i += 2) v += i16(bones, v) + 1;

    return v;
}

/** Weighted vertices without a deform. `first` and `firstWeight` are the positions to start at in `bones` and `vertices`. */
function blend(
    bones: Int16Array,
    vertices: Float32Array,
    first: number,
    firstWeight: number,
    world: Float64Array,
    out: FloatArray,
    offset: number,
    end: number,
    stride: number,
): void {
    let v = first;
    let b = firstWeight;

    for (let w = offset; w < end; w += stride) {
        // per vertex: a count, then that many bone indices
        const n = v + 1 + i16(bones, v);
        let wx = 0;
        let wy = 0;

        for (v++; v < n; v++, b += 3) {
            const m = i16(bones, v) * WORLD_STRIDE;
            const vx = f32(vertices, b);
            const vy = f32(vertices, b + 1);
            const weight = f32(vertices, b + 2);

            wx += (vx * f64(world, m) + vy * f64(world, m + 1) + f64(world, m + 4)) * weight;
            wy += (vx * f64(world, m + 2) + vy * f64(world, m + 3) + f64(world, m + 5)) * weight;
        }
        out[w] = wx;
        out[w + 1] = wy;
    }
}

/**
 * Weighted vertices with a deform, which adds an x and a y to every weight. `firstDeform` is the
 * position to start at in `deform`.
 */
function blendDeformed(
    bones: Int16Array,
    vertices: Float32Array,
    deform: Float64Array,
    first: number,
    firstWeight: number,
    firstDeform: number,
    world: Float64Array,
    out: FloatArray,
    offset: number,
    end: number,
    stride: number,
): void {
    let v = first;
    let b = firstWeight;
    let f = firstDeform;

    for (let w = offset; w < end; w += stride) {
        const n = v + 1 + i16(bones, v);
        let wx = 0;
        let wy = 0;

        for (v++; v < n; v++, b += 3, f += 2) {
            const m = i16(bones, v) * WORLD_STRIDE;
            const vx = f32(vertices, b) + f64(deform, f);
            const vy = f32(vertices, b + 1) + f64(deform, f + 1);
            const weight = f32(vertices, b + 2);

            wx += (vx * f64(world, m) + vy * f64(world, m + 1) + f64(world, m + 4)) * weight;
            wy += (vx * f64(world, m + 2) + vy * f64(world, m + 3) + f64(world, m + 5)) * weight;
        }
        out[w] = wx;
        out[w + 1] = wy;
    }
}

/**
 * Writes the world positions of a mesh, bounding box, path or clipping attachment, as the official
 * `VertexAttachment.computeWorldVertices` does. The three official versions agree.
 *
 * `data` holds the vertices: the attachment, or `meshSource(lookup, mesh)` for a mesh, since a
 * linked mesh has none of its own. `world` is `PoseState.world` and `bone` is the bone of the slot.
 * `deform` and `deformLength` are the slot's entries of `PoseState.deform` and `deformLengths`.
 * A length of 0 means no deform. An unweighted attachment takes a deform as its vertices. A
 * weighted one adds it to them.
 *
 * One x, y pair is written every `stride` numbers from `offset` on. `start` is the first vertex
 * value to transform and `count` the number of values to write, both two per vertex. Nothing is
 * allocated. The caller sizes `out`.
 *
 * Throws a {@link MarrowError} when the vertices, the deform or the bones end before the count does.
 *
 * @example
 * const source = meshSource(lookup, mesh);
 * const positions = new Float32Array(source.worldVerticesLength);
 * const bone = state.model.slots.bones[slot] ?? 0;
 * const deform = state.deform[slot] ?? new Float64Array(0);
 * computeWorldVertices(source, state.world, bone, deform, state.deformLengths[slot] ?? 0, positions);
 */
export function computeWorldVertices(
    data: VertexData,
    world: Float64Array,
    bone: number,
    deform: Float64Array,
    deformLength: number,
    out: FloatArray,
    offset = 0,
    stride = 2,
    start = 0,
    count: number = data.worldVerticesLength - start,
): void {
    const end = offset + (count >> 1) * stride;
    const { bones, vertices } = data;

    if (bones === null) {
        transformPoints(deformLength > 0 ? deform : vertices, start, world, bone, out, offset, end, stride);

        return;
    }
    const v = skipVertices(bones, start);
    // every skipped vertex took one count from bones. The rest of v is the weights that were skipped.
    const skip = v - ((start + 1) >> 1);

    if (deformLength === 0) blend(bones, vertices, v, skip * 3, world, out, offset, end, stride);
    else blendDeformed(bones, vertices, deform, v, skip * 3, skip << 1, world, out, offset, end, stride);
}
