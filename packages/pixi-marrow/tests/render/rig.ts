import { Mesh, Texture, TextureSource } from 'pixi.js';
import { expect } from 'vitest';
import { importAtlas } from '../../src/formats/atlas';
import { importSkeleton } from '../../src/formats/import';
import { attachmentRegions, readRegion, resolveSequenceIndex } from '../../src/geometry/atlas-regions';
import { computeMeshUVs } from '../../src/geometry/mesh';
import { computeRegionOffsets, computeRegionUVs, computeRegionWorldVertices } from '../../src/geometry/region';
import { computeWorldVertices } from '../../src/geometry/vertices';
import type { AtlasModel } from '../../src/model/atlas';
import type { MeshAttachmentData, RegionAttachmentData } from '../../src/model/attachments';
import type { SkeletonModel } from '../../src/model/model';
import { createPoseEngine, type PoseEngine } from '../../src/pose/engine';
import { type AttachmentLookup, createAttachmentLookup, meshSource } from '../../src/pose/shared/lookup';
import { type PoseState, touchPose } from '../../src/pose/state';
import { loadClipCode } from '../../src/render/clip-code';
import { loadCutCode } from '../../src/render/cut-code';
import { loadMeshCode } from '../../src/render/mesh-code';
import { hasClip } from '../../src/render/mode';
import { SkeletonView, type SkeletonViewOptions } from '../../src/render/skeleton-view';
import { listFixtures, readFixture } from '../parity/fixtures';
import type { RigFiles } from '../parity/official';

/*
 * What the render tests share. The expectations are computed here on their own: which slots are
 * visible, and what the geometry kernel gives for each. The view is read from the outside only,
 * through the Pixi buffers of its meshes.
 */

/** One frame at 30 frames per second, in seconds. */
export const FRAME = 1 / 30;

/** The two triangles of a region attachment in the official Pixi runtime. */
const QUAD = [0, 1, 2, 0, 2, 3];

/** An attachment that draws pixels. */
export type Drawable = RegionAttachmentData | MeshAttachmentData;

/** A skeleton with a pose engine and a view. */
export interface Rig {
    model: SkeletonModel;
    atlas: AtlasModel;
    lookup: AttachmentLookup;
    engine: PoseEngine;
    view: SkeletonView;
}

/** A visible slot, and where the view keeps its vertices. */
export interface Drawn {
    slot: number;
    attachment: Drawable;
    /** The first vertex of the attachment in the vertex buffers. */
    first: number;
    /** How many vertices it has. */
    count: number;
    /** The index of the mesh that draws it. */
    range: number;
}

/** The files of a fixture, by its id, for example `4.2/spineboy-pro.skel`. */
export function fixtureFiles(id: string): RigFiles {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (fixture === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);

    return readFixture(fixture);
}

/** What a rig is drawn with: the page textures and the options of the view. */
export interface RigView {
    /**
     * One texture per atlas page. Default: a texture of one pixel per page, which allows no cut
     * of overdraw. Every rig gets textures of its own, as every loaded skeleton does. The shaders
     * of the mesh mode are shared by page texture.
     */
    textures?: (atlas: AtlasModel) => Texture[];
    /**
     * The render mode, the outlines and the cuts of overdraw. Default: the mesh mode without
     * outlines. The helpers of this file read the buffers of the meshes.
     */
    options?: (atlas: AtlasModel) => SkeletonViewOptions;
}

/** Imports files and creates an engine and a view. `code` says whether the code that loads on demand is loaded first. */
async function buildRig(
    files: RigFiles,
    change: ((model: SkeletonModel, atlas: AtlasModel) => void) | undefined,
    drawn: RigView,
    code: boolean,
): Promise<Rig> {
    const model = await importSkeleton(files.skeleton);
    const atlas = importAtlas(files.atlas);

    change?.(model, atlas);
    const engine = await createPoseEngine(model);
    const textures =
        drawn.textures?.(atlas) ??
        atlas.pages.map(() => new Texture({ source: new TextureSource({ width: 1, height: 1 }) }));
    const options: SkeletonViewOptions = { renderMode: code ? 'mesh' : 'batched', ...drawn.options?.(atlas) };

    // What an asset loads with a skeleton: the code of the mesh mode for a view that asks for it,
    // the code that clips, and the code that cuts with outlines, which a view can get at any time
    if (code) {
        await Promise.all([
            options.renderMode === 'mesh' ? loadMeshCode() : undefined,
            hasClip(model) ? loadClipCode() : undefined,
            loadCutCode(),
        ]);
    }
    const view = new SkeletonView(model, atlas, textures, options);

    return { model, atlas, lookup: createAttachmentLookup(model), engine, view };
}

/**
 * Imports files and creates an engine and a view with a white texture per page. `change` can
 * edit the model and the atlas before the view sees them. `drawn` gives the view other textures
 * and options.
 */
export function createRig(
    files: RigFiles,
    change?: (model: SkeletonModel, atlas: AtlasModel) => void,
    drawn: RigView = {},
): Promise<Rig> {
    return buildRig(files, change, drawn, true);
}

/**
 * {@link createRig} in the batched mode, and without the code that loads on demand: the view
 * asks for what it needs, as when no asset loaded it before.
 */
export function createBareRig(files: RigFiles, drawn: RigView = {}): Promise<Rig> {
    return buildRig(files, undefined, drawn, false);
}

/** {@link createRig} for a fixture. */
export const loadRig = (id: string, change?: (model: SkeletonModel, atlas: AtlasModel) => void): Promise<Rig> =>
    createRig(fixtureFiles(id), change);

/**
 * Brings a view in line with a pose that a test wrote itself: the arrays of a `PoseState`
 * directly, without an engine. Marks the whole pose as changed first, as such code must.
 */
export function drawPose(view: SkeletonView, state: PoseState): void {
    touchPose(state);
    view.update(state);
}

/**
 * One more frame of a pose in which nothing has to move: the engine updates by no time, the pose
 * is marked as changed, and the view does the work of a pose that changed. Tests of what a view
 * does from frame to frame use it. An engine alone leaves a pose that did not move unmarked,
 * and a view then has nothing to do.
 */
export function redraw(rig: Rig): void {
    rig.engine.update(0);
    drawPose(rig.view, rig.engine.state);
}

/** Advances the pose and brings the view in line with it. */
export function step(rig: Rig, dt: number = FRAME): void {
    rig.engine.update(dt);
    rig.view.update(rig.engine.state);
}

/** Plays an animation by name from its start, without advancing. */
export function play(rig: Rig, animation: string): void {
    const index = rig.model.animations.findIndex((candidate) => candidate.name === animation);

    if (index === -1) throw new Error(`no animation ${animation}`);
    rig.engine.setAnimation(0, index, true);
}

/** The slot index for a name. */
export function slotIndex(rig: Rig, name: string): number {
    const index = rig.model.slots.names.indexOf(name);

    if (index === -1) throw new Error(`no slot ${name}`);

    return index;
}

/**
 * The meshes of the view that draw at the moment, in draw order. The meshes of clipped slots are
 * the children of a container with a mask. The mask itself is not listed.
 */
export function meshes(view: SkeletonView): Mesh[] {
    const drawn: Mesh[] = [];

    for (const child of view.container.children) {
        if (!child.visible) continue;
        for (const mesh of child instanceof Mesh ? [child] : child.children) {
            if (mesh instanceof Mesh && mesh.visible && mesh !== child.mask) drawn.push(mesh);
        }
    }

    return drawn;
}

const isFloat32 = (data: unknown): data is Float32Array => data instanceof Float32Array;
const isUint8 = (data: unknown): data is Uint8Array => data instanceof Uint8Array;

/** The typed arrays behind the vertex buffers of the view. */
export interface VertexData {
    /** x, y per vertex. */
    positions: Float32Array;
    /** u, v and four flag bytes per vertex. */
    statics: Float32Array;
    /** The color bytes as the view keeps them. */
    colorBytes: Uint8Array;
    /** The same bytes as one number per color: 0xAABBGGRR. */
    colors: Uint32Array;
}

/** The typed arrays behind the vertex buffers of the view. The view needs one mesh for this. */
export function vertexData(view: SkeletonView): VertexData {
    const geometry = meshes(view)[0]?.geometry;
    const positions = geometry?.getBuffer('aPosition').data;
    const statics = geometry?.getBuffer('aUV').data;
    const colorBytes = geometry?.getBuffer('aColor').data;

    if (!isFloat32(positions) || !isFloat32(statics) || !isUint8(colorBytes)) throw new Error('the view has no mesh');

    return {
        positions,
        statics,
        colorBytes,
        colors: new Uint32Array(colorBytes.buffer, colorBytes.byteOffset, colorBytes.byteLength / 4),
    };
}

/** The indices a mesh draws. */
function drawnIndices(mesh: Mesh): number[] {
    const { data } = mesh.geometry.indexBuffer;

    return Array.from(data.subarray(0, mesh.geometry.indexCount));
}

/** The slots that must be visible for the pose, in draw order: the rule of the official Pixi runtime. */
export function visibleSlots(rig: Rig): { slot: number; attachment: Drawable }[] {
    const { state } = rig.engine;
    const visible: { slot: number; attachment: Drawable }[] = [];

    for (const slot of state.drawOrder) {
        const attachment = state.attachments[slot];

        if (attachment == null || (attachment.type !== 'region' && attachment.type !== 'mesh')) continue;
        if (state.active[rig.model.slots.bones[slot] ?? -1] !== 1) continue;
        if ((state.colors[slot * 4 + 3] ?? 0) * (attachment.color[3] ?? 0) === 0) continue;
        visible.push({ slot, attachment });
    }

    return visible;
}

/** The triangles of an attachment, relative to its first vertex. */
export function trianglesOf(rig: Rig, attachment: Drawable): number[] {
    return attachment.type === 'region' ? QUAD : Array.from(meshSource(rig.lookup, attachment).triangles);
}

const vertexCount = (rig: Rig, attachment: Drawable): number =>
    attachment.type === 'region' ? 4 : meshSource(rig.lookup, attachment).worldVerticesLength / 2;

/**
 * Reads the index buffers of the view against the visible slots. Every visible slot must be there
 * once, in draw order, with its own triangles, and nothing else. Returns where each one is.
 */
export function readDrawn(rig: Rig): Drawn[] {
    const ranges = meshes(rig.view).map(drawnIndices);
    const drawn: Drawn[] = [];
    let range = 0;
    let at = 0;

    for (const { slot, attachment } of visibleSlots(rig)) {
        const triangles = trianglesOf(rig, attachment);

        if (at === ranges[range]?.length) {
            range++;
            at = 0;
        }
        const indices = ranges[range]?.slice(at, at + triangles.length) ?? [];
        const first = (indices[0] ?? 0) - (triangles[0] ?? 0);

        expect(indices, `triangles of slot ${rig.model.slots.names[slot]}`).toEqual(
            triangles.map((vertex) => first + vertex),
        );
        at += triangles.length;
        drawn.push({ slot, attachment, first, count: vertexCount(rig, attachment), range });
    }
    expect(at, 'indices after the last visible slot').toBe(ranges[range]?.length ?? 0);
    expect(range, 'ranges after the last visible slot').toBe(Math.max(ranges.length - 1, 0));

    return drawn;
}

/** The world positions the geometry kernel gives for a slot in the current pose, as 32-bit floats. */
export function kernelPositions(rig: Rig, slot: number, attachment: Drawable): Float32Array {
    const { model, atlas } = rig;
    const { state } = rig.engine;
    const bone = model.slots.bones[slot] ?? -1;

    if (attachment.type === 'region') {
        const frame = resolveSequenceIndex(attachment.sequence, state.sequenceIndices[slot] ?? -1);
        const region = readRegion(atlas, attachmentRegions(atlas, attachment)[frame] ?? -1);
        const offsets = model.version === '4.3' ? new Float64Array(8) : new Float32Array(8);
        const out = new Float32Array(8);

        computeRegionOffsets(model.version, attachment, region, offsets);
        computeRegionWorldVertices(offsets, 0, state.world, bone, out);

        return out;
    }
    const source = meshSource(rig.lookup, attachment);
    const out = new Float32Array(source.worldVerticesLength);
    const deform = state.deform[slot] ?? new Float64Array(0);

    computeWorldVertices(source, state.world, bone, deform, state.deformLengths[slot] ?? 0, out);

    return out;
}

/** The texture coordinates and the page the geometry kernel gives for a slot in the current pose. */
export function kernelUVs(rig: Rig, slot: number, attachment: Drawable): { uvs: Float32Array; page: number } {
    const { atlas } = rig;
    const frame = resolveSequenceIndex(attachment.sequence, rig.engine.state.sequenceIndices[slot] ?? -1);
    const region = readRegion(atlas, attachmentRegions(atlas, attachment)[frame] ?? -1);

    if (attachment.type === 'region') {
        const uvs = new Float32Array(8);

        computeRegionUVs(region, uvs);

        return { uvs, page: region.page };
    }
    const source = meshSource(rig.lookup, attachment);
    const uvs = new Float32Array(source.regionUVs.length);

    computeMeshUVs(region, source.regionUVs, uvs);

    return { uvs, page: region.page };
}

/** How many 32-bit numbers the view keeps per vertex next to the position: u, v and four flag bytes. */
const STATIC_STRIDE = 3;

/** The texture coordinates of a vertex range in the static buffer, without the flags between them. */
export function readUVs(statics: Float32Array, first: number, count: number): Float32Array {
    const uvs = new Float32Array(count * 2);

    for (let vertex = 0; vertex < count; vertex++) {
        uvs[vertex * 2] = statics[(first + vertex) * STATIC_STRIDE] ?? Number.NaN;
        uvs[vertex * 2 + 1] = statics[(first + vertex) * STATIC_STRIDE + 1] ?? Number.NaN;
    }

    return uvs;
}

/** The flag bytes of a vertex: the texture unit of its page, and 255 when its slot is additive. */
export function readFlags(statics: Float32Array, vertex: number): { unit: number; additive: number } {
    const bytes = new Uint8Array(statics.buffer, statics.byteOffset + vertex * STATIC_STRIDE * 4 + 8, 4);

    return { unit: bytes[0] ?? -1, additive: bytes[1] ?? -1 };
}

/**
 * Checks every visible slot against the geometry kernel: the positions, the texture coordinates
 * and the page in the vertex buffers, and through {@link readDrawn} the triangles.
 */
export function expectKernel(rig: Rig): Drawn[] {
    const drawn = readDrawn(rig);

    if (drawn.length === 0) return drawn;
    const { positions, statics } = vertexData(rig.view);

    for (const { slot, attachment, first, count } of drawn) {
        const name = rig.model.slots.names[slot];
        const expected = kernelPositions(rig, slot, attachment);
        const { uvs, page } = kernelUVs(rig, slot, attachment);

        expect(positions.subarray(first * 2, first * 2 + expected.length), `positions of slot ${name}`).toEqual(
            expected,
        );
        expect(readUVs(statics, first, count), `texture coordinates of slot ${name}`).toEqual(uvs);
        expect(readFlags(statics, first).unit, `page of slot ${name}`).toBe(page % 8);
        expect(readFlags(statics, first + count - 1).unit, `page of slot ${name}`).toBe(page % 8);
    }

    return drawn;
}
