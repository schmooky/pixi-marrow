import { BufferImageSource } from 'pixi.js';
import { type FloatArray, f32, float, i16, i32 } from '../geometry/read';
import type { VertexData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import type { Template } from './template';

/*
 * What the vertex shader of `skinning: 'gpu'` reads of a layout. It is the same for every
 * instance of the layout, so it is laid out once and shared, like the texture coordinates:
 *
 * - Per vertex, two numbers: the first influence, then the count of influences in the low 16
 *   bits and the slot in the high 16. The attribute `aSkin` of the meshes reads them.
 * - Per influence one texel: the bone, the x and y of the vertex in the space of that bone, and
 *   the weight. A region, the polygon of a region and a mesh without weights have one influence a
 *   vertex, on the bone of the slot, with a weight of 1.
 *
 * A region with a sequence has other offsets in every frame, so the CPU places it: its vertices
 * have no influence. So does a weighted vertex without a bone, which only a broken file has.
 */

/** The most texels in a row of a data texture. WebGL2 allows 2048 at least. */
const DATA_ROW = 2048;

/** The shared skin data of one layout, and how many views draw with it. */
export interface SkinLayout {
    /** Per vertex two numbers. The first influence, then the influence count and the slot as `count | slot << 16`. */
    readonly vertices: Uint32Array;
    /** Per influence: bone, x, y, weight. */
    readonly influences: BufferImageSource;
    /** Per entry: 1 when the vertex shader can place its vertices. */
    readonly placeable: Uint8Array;
    /** How many entries the vertex shader can place. */
    readonly count: number;
    uses: number;
}

/** The width and height of a data texture of this many texels. */
function shapeOf(texels: number): [number, number] {
    const width = Math.max(1, Math.min(texels, DATA_ROW));

    return [width, Math.max(1, Math.ceil(texels / width))];
}

/**
 * The numbers of a data texture of this many texels: 4 a texel, with the rest of its last row.
 *
 * @example
 * const data = new Float32Array(dataRoom(texels));
 */
export function dataRoom(texels: number): number {
    const [width, height] = shapeOf(texels);

    return width * height * 4;
}

/**
 * A texture of 4 numbers a texel for data that a shader loads by index: 32-bit floats, or bytes.
 * `data` has the length {@link dataRoom} gives for `texels`. Nearest filtering keeps a float
 * texture complete for WebGL2, which cannot filter it.
 *
 * @example
 * const data = new Float32Array(dataRoom(texels));
 * const bones = dataTexture(data, texels, 'marrow-bones');
 */
export function dataTexture(data: Float32Array | Uint8Array, texels: number, label: string): BufferImageSource {
    const [width, height] = shapeOf(texels);

    return new BufferImageSource({
        resource: data,
        width,
        height,
        format: data instanceof Float32Array ? 'rgba32float' : 'rgba8unorm',
        alphaMode: 'no-premultiply-alpha',
        scaleMode: 'nearest',
        autoGenerateMipmaps: false,
        label,
    });
}

/** Writes one texel of 4 numbers. */
function put(out: Float32Array, texel: number, a: number, b: number, c: number, d: number): void {
    const at = texel * 4;

    out[at] = a;
    out[at + 1] = b;
    out[at + 2] = c;
    out[at + 3] = d;
}

/** The influences of the vertices of an entry, or -1 when the vertex shader cannot place them. */
function influenceCount(template: Template, entry: number): number {
    const count = i32(template.counts, entry);
    const source = template.sources[entry] ?? null;

    if (count === 0) return 0;
    if (source === null) return i32(template.frameCounts, entry) > 1 ? -1 : count;
    if (source.bones === null) return count;
    let total = 0;

    for (let v = 0, at = 0; v < count; v++) {
        const bones = i16(source.bones, at);

        if (bones === 0) return -1;
        total += bones;
        at += bones + 1;
    }

    return total;
}

/** Where the points of a rigid entry start: the polygon, the quad of its one frame, or the mesh. */
function rigidPoints(template: Template, entry: number, source: VertexData | null): [FloatArray, number] {
    const tight = i32(template.tightAt, entry);

    if (tight >= 0) return [template.tightOffsets, tight];
    if (source === null) return [template.offsets, i32(template.offsetAt, entry)];

    return [source.vertices, 0];
}

/** Writes the influences of one entry from `at` on and returns the texel after them. */
function writeEntry(
    template: Template,
    entry: number,
    bone: number,
    vertices: Uint32Array,
    out: Float32Array,
    at: number,
): number {
    const first = i32(template.first, entry);
    const count = i32(template.counts, entry);
    const source = template.sources[entry] ?? null;
    let texel = at;

    if (source === null || source.bones === null) {
        const [points, start] = rigidPoints(template, entry, source);

        for (let v = 0; v < count; v++, texel++) {
            vertices[(first + v) * 2] = texel;
            vertices[(first + v) * 2 + 1] = Number(vertices[(first + v) * 2 + 1]) | 1;
            put(out, texel, bone, float(points, start + v * 2), float(points, start + v * 2 + 1), 1);
        }

        return texel;
    }
    const { bones, vertices: weights } = source;

    for (let v = 0, b = 0, w = 0; v < count; v++) {
        const n = i16(bones, b++);

        vertices[(first + v) * 2] = texel;
        vertices[(first + v) * 2 + 1] = Number(vertices[(first + v) * 2 + 1]) | n;
        for (let k = 0; k < n; k++, texel++, w += 3) {
            put(out, texel, i16(bones, b++), f32(weights, w), f32(weights, w + 1), f32(weights, w + 2));
        }
    }

    return texel;
}

/** Lays out the skin data of a layout. */
function layOut(template: Template, slotBones: Int16Array): SkinLayout {
    const entries = template.slots.length;
    const placeable = new Uint8Array(entries);
    // a GPU buffer cannot be empty, so there is room for one vertex at least
    const vertices = new Uint32Array(Math.max(template.vertexCount, 1) * 2);
    let total = 0;
    let count = 0;

    for (let entry = 0; entry < entries; entry++) {
        const influences = influenceCount(template, entry);

        if (influences <= 0) continue;
        placeable[entry] = 1;
        total += influences;
        count++;
    }
    const out = new Float32Array(dataRoom(total));
    const influences = dataTexture(out, total, 'marrow-influences');
    let texel = 0;

    for (let entry = 0; entry < entries; entry++) {
        const slot = i32(template.slots, entry);
        const first = i32(template.first, entry);

        for (let v = 0; v < i32(template.counts, entry); v++) vertices[(first + v) * 2 + 1] = (slot << 16) >>> 0;
        if (placeable[entry] === 1) texel = writeEntry(template, entry, i16(slotBones, slot), vertices, out, texel);
    }

    return { vertices, influences, placeable, count, uses: 0 };
}

/** Per layout, by an array that all instances of it share: its skin data while a view draws with it. */
const layouts = new WeakMap<Int32Array, SkinLayout>();

/**
 * The skin data of the layout of a template, for one more view that draws with it. It is laid
 * out the first time. Give it back with {@link releaseSkinLayout}.
 *
 * @example
 * const skin = retainSkinLayout(template, model);
 * buffer.data = skin.vertices;
 */
export function retainSkinLayout(template: Template, model: SkeletonModel): SkinLayout {
    // the instances of a layout share `first` with it
    let layout = layouts.get(template.first);

    if (layout === undefined) {
        layout = layOut(template, model.slots.bones);
        layouts.set(template.first, layout);
    }
    layout.uses++;

    return layout;
}

/**
 * Gives skin data of {@link retainSkinLayout} back. The last view that gives it back frees its
 * texture, and the next view lays it out again.
 *
 * @example
 * releaseSkinLayout(template, skin);
 */
export function releaseSkinLayout(template: Template, layout: SkinLayout): void {
    layout.uses--;
    if (layout.uses > 0) return;
    if (layouts.get(template.first) === layout) layouts.delete(template.first);
    layout.influences.destroy();
}
