import { MarrowError } from '../base/errors';
import { attachmentRegions, readRegion, resolveSequenceIndex } from '../geometry/atlas-regions';
import { computeMeshUVs } from '../geometry/mesh';
import { type FloatArray, f32, i32 } from '../geometry/read';
import { computeRegionOffsets, computeRegionUVs } from '../geometry/region';
import type { AtlasModel } from '../model/atlas';
import type { AttachmentData, MeshAttachmentData, RegionAttachmentData, VertexData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import { type AttachmentLookup, meshSource } from '../pose/shared/lookup';
import { MAX_PAGES } from './shader';

/*
 * The stable vertex layout of one skeleton instance. Every region and mesh attachment a slot can
 * show gets an entry with its own vertex range. Texture coordinates, pages and triangles are
 * written once. Showing, hiding and reordering slots never moves a vertex: the index buffer
 * decides what is drawn. Only a sequence rewrites the texture coordinates of its own range.
 */

/** An attachment that draws pixels. */
type Drawable = RegionAttachmentData | MeshAttachmentData;

/** 32-bit numbers per vertex in {@link Template.statics}: u, v, then four flag bytes. */
export const STATIC_STRIDE = 3;

/** The two triangles of a region attachment, in the order of the official Pixi runtime. */
const QUAD: Uint16Array = Uint16Array.of(0, 1, 2, 0, 2, 3);

/** The slot blend mode that adds. An index into `BLEND_MODES`. */
const ADDITIVE = 1;

/**
 * The vertex ranges of a skeleton for one skin, and the vertex data of one instance. Arrays named
 * "per entry" have one item per attachment a slot can show.
 */
export interface Template {
    /** The skin the template was built for, or -1. */
    readonly skin: number;
    /** Vertices in all ranges. */
    readonly vertexCount: number;
    /** The most indices that can be visible at once: the largest attachment of every slot. */
    readonly indexCapacity: number;
    /** Per slot, and one more: the first entry of the slot. Entries are sorted by slot. */
    readonly slotEntries: Int32Array;
    /** Per entry: the attachment. */
    readonly attachments: readonly Drawable[];
    /** Per entry: the mesh that holds the vertices, or null for a region attachment. */
    readonly sources: readonly (VertexData | null)[];
    /** Per entry: three vertex numbers per triangle, relative to the first vertex. */
    readonly triangles: readonly Uint16Array[];
    /** Per entry: the slot. */
    readonly slots: Int32Array;
    /** Per entry: the first vertex. */
    readonly first: Int32Array;
    /** Per entry: the vertex count. 0 for an attachment that cannot be drawn. */
    readonly counts: Int32Array;
    /** Per entry: the attachment color r, g, b, a. */
    readonly tints: Float64Array;
    /** Per entry: how many atlas regions the attachment steps through. 1 without a sequence. */
    readonly frameCounts: Int32Array;
    /** Per entry: where the frames of the entry start in {@link framePages}. */
    readonly pageAt: Int32Array;
    /** Per entry: where the frames start in {@link frameUVs}, or -1 with a single frame. */
    readonly uvAt: Int32Array;
    /** Per entry: where the frames start in {@link offsets}, or -1 for a mesh. */
    readonly offsetAt: Int32Array;
    /** Per entry: the frame the vertex data holds at the moment. */
    readonly frames: Int32Array;
    /** Per entry: the atlas page of that frame. */
    readonly pages: Int32Array;
    /** Per entry: the light color the vertex data holds at the moment, as bytes r, g, b, a. */
    readonly light: Uint8Array;
    /** Per entry: the dark color the vertex data holds at the moment, as bytes r, g, b, a. */
    readonly dark: Uint8Array;
    /** The atlas page of every frame of every entry. */
    readonly framePages: Int32Array;
    /** The texture coordinates of every frame of the entries with more than one frame. */
    readonly frameUVs: Float32Array;
    /** The 8 region offsets of every frame of the region entries. 64-bit for a 4.3 model. */
    readonly offsets: FloatArray;
    /** x, y per vertex. */
    readonly positions: Float32Array;
    /** u, v and four flag bytes per vertex. See {@link STATIC_STRIDE}. */
    readonly statics: Float32Array;
    /** The bytes of {@link statics}. Per vertex, at byte 8: the texture unit, then 255 for additive. */
    readonly flags: Uint8Array;
    /** Per vertex: the light color as bytes r, g, b, a, and with `hasDark` the dark color after it. */
    readonly colors: Uint8Array;
    /** Whether {@link colors} holds dark colors. */
    readonly hasDark: boolean;
}

/** What is known about an entry before the buffers exist. */
interface Draft {
    slot: number;
    attachment: Drawable;
    /** The mesh that holds the vertices and the region UVs, or null for a region attachment. */
    source: MeshAttachmentData | null;
    triangles: Uint16Array;
    /** The atlas region of each frame. */
    regions: Int32Array;
    vertices: number;
}

const isDrawable = (attachment: AttachmentData | null | undefined): attachment is Drawable =>
    attachment != null && (attachment.type === 'region' || attachment.type === 'mesh');

/** The attachments each slot can show: those of the active skin, of the default skin and the ones shown now. */
function collectDrawables(
    model: SkeletonModel,
    lookup: AttachmentLookup,
    skin: number,
    shown: readonly (AttachmentData | null)[] | null,
): Drawable[][] {
    const perSlot: Drawable[][] = Array.from({ length: model.slots.count }, () => []);
    const add = (slot: number, attachment: AttachmentData | null | undefined): void => {
        const list = perSlot[slot];

        if (list !== undefined && isDrawable(attachment) && !list.includes(attachment)) list.push(attachment);
    };

    for (const index of new Set([skin, lookup.defaultSkin])) {
        // a name of the default skin that the active skin also has shows the attachment of the active skin
        for (const entry of model.skins[index]?.attachments ?? [])
            add(entry.slot, lookup.find(skin, entry.slot, entry.name));
    }
    // after a skin change a slot can still show an attachment of the skin before
    shown?.forEach((attachment, slot) => add(slot, attachment));

    return perSlot;
}

function badMesh(mesh: MeshAttachmentData, what: string): MarrowError {
    return new MarrowError('invalid-data', `The mesh "${mesh.name}" ${what}.`, {
        fix: 'Export the skeleton again.',
    });
}

/** The vertices and triangles of a mesh, checked so that a damaged mesh cannot reach into another range. */
function meshGeometry(lookup: AttachmentLookup, mesh: MeshAttachmentData): MeshAttachmentData {
    const source = meshSource(lookup, mesh);
    const vertices = source.worldVerticesLength >> 1;

    if (source.regionUVs.length !== source.worldVerticesLength) {
        throw badMesh(mesh, `has ${vertices} vertices and ${source.regionUVs.length >> 1} texture coordinates`);
    }
    if (source.triangles.some((vertex) => vertex >= vertices)) {
        throw badMesh(mesh, `has a triangle that points past its ${vertices} vertices`);
    }

    return source;
}

function draft(atlas: AtlasModel, lookup: AttachmentLookup, slot: number, attachment: Drawable): Draft {
    const regions = attachmentRegions(atlas, attachment);
    const source = attachment.type === 'mesh' ? meshGeometry(lookup, attachment) : null;
    const triangles = source === null ? QUAD : source.triangles;
    const vertices = source === null ? 4 : source.worldVerticesLength >> 1;
    // a sequence without regions or a mesh without triangles keeps its entry and draws nothing
    const drawn = regions.length > 0 && triangles.length > 0;

    return { slot, attachment, source, triangles, regions, vertices: drawn ? vertices : 0 };
}

/** Sizes that follow from the drafts: how long each shared array is. */
interface Sizes {
    vertices: number;
    frames: number;
    frameUVs: number;
    offsets: number;
    indexCapacity: number;
}

function measure(drafts: readonly Draft[], slotCount: number): Sizes {
    const sizes: Sizes = { vertices: 0, frames: 0, frameUVs: 0, offsets: 0, indexCapacity: 0 };
    const largest = new Int32Array(slotCount);

    for (const { slot, source, regions, vertices, triangles } of drafts) {
        if (vertices === 0) continue;
        sizes.vertices += vertices;
        sizes.frames += regions.length;
        if (regions.length > 1) sizes.frameUVs += regions.length * vertices * 2;
        if (source === null) sizes.offsets += regions.length * 8;
        largest[slot] = Math.max(largest[slot] ?? 0, triangles.length);
    }
    sizes.indexCapacity = largest.reduce((sum, indices) => sum + indices, 0);

    return sizes;
}

function allocate(model: SkeletonModel, skin: number, drafts: readonly Draft[], dark: boolean): Template {
    const sizes = measure(drafts, model.slots.count);
    const entries = drafts.length;
    // a GPU buffer cannot be empty, so there is room for one vertex at least
    const room = Math.max(sizes.vertices, 1);
    const statics = new Float32Array(room * STATIC_STRIDE);

    return {
        skin,
        vertexCount: sizes.vertices,
        indexCapacity: sizes.indexCapacity,
        slotEntries: new Int32Array(model.slots.count + 1),
        attachments: drafts.map((entry) => entry.attachment),
        sources: drafts.map((entry) => entry.source),
        triangles: drafts.map((entry) => entry.triangles),
        slots: Int32Array.from(drafts, (entry) => entry.slot),
        first: new Int32Array(entries),
        counts: Int32Array.from(drafts, (entry) => entry.vertices),
        tints: new Float64Array(entries * 4),
        frameCounts: Int32Array.from(drafts, (entry) => (entry.vertices === 0 ? 0 : entry.regions.length)),
        pageAt: new Int32Array(entries).fill(-1),
        uvAt: new Int32Array(entries).fill(-1),
        offsetAt: new Int32Array(entries).fill(-1),
        frames: new Int32Array(entries),
        pages: new Int32Array(entries),
        light: new Uint8Array(entries * 4),
        dark: new Uint8Array(entries * 4),
        framePages: new Int32Array(sizes.frames),
        frameUVs: new Float32Array(sizes.frameUVs),
        offsets: model.version === '4.3' ? new Float64Array(sizes.offsets) : new Float32Array(sizes.offsets),
        positions: new Float32Array(room * 2),
        statics,
        flags: new Uint8Array(statics.buffer),
        colors: new Uint8Array(room * (dark ? 8 : 4)),
        hasDark: dark,
    };
}

/** Where the next entry puts its data in the shared arrays. */
interface Cursor {
    vertex: number;
    frame: number;
    uv: number;
    offset: number;
}

/** Writes the offsets, the texture coordinates and the page of every frame of one entry. */
function fillFrames(
    template: Template,
    model: SkeletonModel,
    atlas: AtlasModel,
    { attachment, source, regions, vertices }: Draft,
    cursor: Cursor,
): void {
    const many = regions.length > 1;
    // a single frame goes straight to the vertex data, more frames wait in their own array
    const out = many ? template.frameUVs : template.statics;
    const stride = many ? 2 : STATIC_STRIDE;

    regions.forEach((index, frame) => {
        const region = readRegion(atlas, index);
        const at = many ? cursor.uv + frame * vertices * 2 : cursor.vertex * STATIC_STRIDE;

        template.framePages[cursor.frame + frame] = region.page;
        if (source !== null) computeMeshUVs(region, source.regionUVs, out, at, stride);
        else if (attachment.type === 'region') {
            computeRegionOffsets(model.version, attachment, region, template.offsets, cursor.offset + frame * 8);
            computeRegionUVs(region, out, at, stride);
        }
    });
}

/** Writes what never changes for one entry, shows the frame of the setup pose and moves the cursor on. */
function fillEntry(
    template: Template,
    model: SkeletonModel,
    atlas: AtlasModel,
    entry: number,
    item: Draft,
    cursor: Cursor,
): void {
    const { attachment, source, regions, vertices, slot } = item;
    const frames = regions.length;

    template.tints.set(attachment.color, entry * 4);
    template.first[entry] = cursor.vertex;
    if (vertices === 0) return;
    template.pageAt[entry] = cursor.frame;
    if (frames > 1) template.uvAt[entry] = cursor.uv;
    if (source === null) template.offsetAt[entry] = cursor.offset;
    fillFrames(template, model, atlas, item, cursor);
    if (model.slots.blendModes[slot] === ADDITIVE) {
        for (let v = cursor.vertex; v < cursor.vertex + vertices; v++) template.flags[v * STATIC_STRIDE * 4 + 9] = 255;
    }
    // -1 makes showFrame write the frame of the setup pose
    template.frames[entry] = -1;
    showFrame(template, entry, resolveSequenceIndex(attachment.sequence, -1));
    cursor.vertex += vertices;
    cursor.frame += frames;
    if (frames > 1) cursor.uv += frames * vertices * 2;
    if (source === null) cursor.offset += frames * 8;
}

/**
 * Lays out a vertex range for every region and mesh attachment each slot can show with a skin: the
 * attachments of that skin, of the default skin, and the ones in `shown`. Texture coordinates,
 * pages and flags are written. Positions and colors start at zero.
 *
 * Throws the {@link MarrowError} of the geometry kernel when the atlas misses a region.
 *
 * @example
 * const lookup = createAttachmentLookup(model);
 * const template = buildTemplate(model, atlas, lookup, state.skin, state.attachments, false);
 * console.log(template.vertexCount, template.indexCapacity);
 */
export function buildTemplate(
    model: SkeletonModel,
    atlas: AtlasModel,
    lookup: AttachmentLookup,
    skin: number,
    shown: readonly (AttachmentData | null)[] | null,
    dark: boolean,
): Template {
    const perSlot = collectDrawables(model, lookup, skin, shown);
    const drafts = perSlot.flatMap((list, slot) => list.map((attachment) => draft(atlas, lookup, slot, attachment)));
    const template = allocate(model, skin, drafts, dark);
    const cursor: Cursor = { vertex: 0, frame: 0, uv: 0, offset: 0 };
    let entry = 0;

    perSlot.forEach((list, slot) => {
        template.slotEntries[slot] = entry;
        entry += list.length;
    });
    template.slotEntries[model.slots.count] = entry;
    drafts.forEach((item, index) => fillEntry(template, model, atlas, index, item, cursor));

    return template;
}

/**
 * Puts one frame of an entry into the vertex data: the page of the frame, and for a sequence its
 * texture coordinates. Does nothing when the vertex data holds the frame already. Returns whether
 * it wrote.
 *
 * Throws a {@link MarrowError} for a frame the attachment does not have.
 *
 * @example
 * const frame = resolveSequenceIndex(attachment.sequence, state.sequenceIndices[slot] ?? -1);
 * if (showFrame(template, entry, frame)) staticBuffer.update();
 */
export function showFrame(template: Template, entry: number, frame: number): boolean {
    const frames = i32(template.frameCounts, entry);

    if (frame === i32(template.frames, entry)) return false;
    if (!(frame >= 0 && frame < frames)) {
        throw new MarrowError(
            'invalid-data',
            `The attachment "${template.attachments[entry]?.name}" has ${frames} sequence regions and no region ${frame}.`,
            { fix: 'Set a sequence index below the count of the sequence, or -1 for its setup index.' },
        );
    }
    const first = i32(template.first, entry);
    const count = i32(template.counts, entry);
    const page = i32(template.framePages, i32(template.pageAt, entry) + frame);
    const uvAt = i32(template.uvAt, entry);
    const { statics, flags, frameUVs } = template;

    template.frames[entry] = frame;
    template.pages[entry] = page;
    for (let v = 0; v < count; v++) {
        const at = (first + v) * STATIC_STRIDE;

        flags[at * 4 + 8] = page % MAX_PAGES;
        if (uvAt < 0) continue;
        statics[at] = f32(frameUVs, uvAt + (frame * count + v) * 2);
        statics[at + 1] = f32(frameUVs, uvAt + (frame * count + v) * 2 + 1);
    }

    return true;
}

/**
 * The entry of a slot for an attachment. The result is -1 when the attachment is not a region or
 * a mesh, or cannot be drawn. The result is -2 when the template has no range for it. Then the
 * template must be built again.
 *
 * @example
 * const entry = findEntry(template, slot, state.attachments[slot] ?? null);
 * if (entry >= 0) console.log(template.first[entry], template.counts[entry]);
 */
export function findEntry(template: Template, slot: number, attachment: AttachmentData | null): number {
    if (!isDrawable(attachment)) return -1;
    const end = i32(template.slotEntries, slot + 1);

    for (let entry = i32(template.slotEntries, slot); entry < end; entry++) {
        if (template.attachments[entry] === attachment) return i32(template.counts, entry) > 0 ? entry : -1;
    }

    return -2;
}

/**
 * The bytes of the vertex data of a template: positions, texture coordinates with flags, colors.
 *
 * @example
 * console.log(templateBytes(template) / template.vertexCount);
 */
export function templateBytes(template: Template): number {
    return template.positions.byteLength + template.statics.byteLength + template.colors.byteLength;
}
