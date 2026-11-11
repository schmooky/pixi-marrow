import { importAtlas } from '../../src/formats/atlas';
import { importSkeleton } from '../../src/formats/import';
import {
    type AtlasRegion,
    attachmentRegions,
    readRegion,
    resolveSequenceIndex,
} from '../../src/geometry/atlas-regions';
import { computeMeshUVs } from '../../src/geometry/mesh';
import { computeRegionOffsets, computeRegionUVs, computeRegionWorldVertices } from '../../src/geometry/region';
import { computeWorldVertices } from '../../src/geometry/vertices';
import type { AtlasModel } from '../../src/model/atlas';
import type { AttachmentData, MeshAttachmentData, RegionAttachmentData } from '../../src/model/attachments';
import type { SkeletonModel } from '../../src/model/model';
import { type AttachmentLookup, createAttachmentLookup, meshSource } from '../../src/pose/shared/lookup';
import { createPoseState, type PoseState } from '../../src/pose/state';
import { Problems } from './geometry-compare';
import {
    loadOfficialGeometry,
    type OfficialDrawable,
    type OfficialGeometry,
    type OfficialGeometryPlayback,
    type OfficialShown,
    type OfficialTexture,
} from './geometry-official';
import type { RigFiles } from './official';

/*
 * The checks of the geometry parity test. The official core of a skeleton's version loads it with
 * its atlas and plays it. Our kernels get the official bone transforms and the official deform of
 * each frame, so the pose engines play no part. Offsets, texture coordinates and world positions
 * must then have the bits of the official ones.
 *
 * One difference is allowed. The model stores the region UVs of a mesh as 32-bit floats. The
 * official JSON reader keeps them as 64-bit numbers. A mesh UV of a JSON file may therefore be off
 * by what that rounding moves it, see `uvSlack`, plus one 32-bit step. Three things must still
 * match bit for bit: every mesh UV of a binary file, the official math run on the rounded region
 * UVs, and our math run on the 64-bit region UVs of the official loader.
 */

/** Frames stepped per animation, and how many of them make one loop. */
const FRAMES = 12;
const FRAMES_PER_LOOP = 9;
/** Where the second world vertex call writes: not at the start and not packed. */
const OFFSET = 3;
const STRIDE = 5;
/** What output arrays hold before a kernel writes. A kernel must leave the gaps alone. */
const UNTOUCHED = 7;

/** What a renderer computes once per region or mesh attachment. */
interface Template {
    /** The atlas region of each sequence index. */
    regions: Int32Array;
    /** Region attachments: 8 offsets per sequence index. 64-bit for 4.3, as the official runtime keeps them. */
    offsets: Float32Array | Float64Array;
    /** The texture coordinates of each sequence index, `uvLength` numbers each. */
    uvs: Float32Array;
    uvLength: number;
}

/** A skeleton and its atlas, imported by us and loaded by the official core of its version. */
export interface GeometryRig {
    /** Whether the skeleton file is JSON. Only then the official region UVs are 64-bit. */
    json: boolean;
    model: SkeletonModel;
    atlas: AtlasModel;
    lookup: AttachmentLookup;
    official: OfficialGeometry;
    templates: Map<AttachmentData, Template>;
}

/** Imports a skeleton and its atlas, and loads both in the official core of the skeleton's version. */
export async function loadGeometryRig(files: RigFiles): Promise<GeometryRig> {
    const model = await importSkeleton(files.skeleton);

    return {
        json: typeof files.skeleton === 'string',
        model,
        atlas: importAtlas(files.atlas),
        lookup: createAttachmentLookup(model),
        official: loadOfficialGeometry(model.version, files),
        templates: new Map(),
    };
}

function buildTemplate(rig: GeometryRig, attachment: RegionAttachmentData | MeshAttachmentData): Template {
    const { atlas, model } = rig;
    const regions = attachmentRegions(atlas, attachment);
    const quads = attachment.type === 'region' ? regions.length : 0;
    const regionUVs = attachment.type === 'mesh' ? meshSource(rig.lookup, attachment).regionUVs : null;
    const uvLength = regionUVs === null ? 8 : regionUVs.length;
    const offsets = model.version === '4.3' ? new Float64Array(quads * 8) : new Float32Array(quads * 8);
    const uvs = new Float32Array(regions.length * uvLength);

    regions.forEach((index, i) => {
        const region = readRegion(atlas, index);

        if (attachment.type === 'region') {
            computeRegionOffsets(model.version, attachment, region, offsets, i * 8);
            computeRegionUVs(region, uvs, i * 8);
        } else if (regionUVs !== null) computeMeshUVs(region, regionUVs, uvs, i * uvLength);
    });

    return { regions, offsets, uvs, uvLength };
}

function templateOf(rig: GeometryRig, attachment: RegionAttachmentData | MeshAttachmentData): Template {
    const template = rig.templates.get(attachment) ?? buildTemplate(rig, attachment);

    rig.templates.set(attachment, template);

    return template;
}

/**
 * How far one texture coordinate of a mesh can move when the region UVs of its vertex are rounded
 * to 32 bits, as the model stores them: the rounding times the size of the image on the page.
 */
function uvSlack(region: AtlasRegion, officialRegionUVs: ArrayLike<number>, index: number): number {
    const vertex = index - (index % 2);
    const u = officialRegionUVs[vertex] ?? 0;
    const v = officialRegionUVs[vertex + 1] ?? 0;
    const moved = Math.max(Math.abs(u - Math.fround(u)), Math.abs(v - Math.fround(v)));
    // a rotated region maps u to v, so both get the longer side of the image
    const side = Math.max(region.originalWidth, region.originalHeight);

    return (moved * side) / (index % 2 === 0 ? region.pageWidth : region.pageHeight);
}

/**
 * The region, the offsets and the texture coordinates we compute for one sequence index against
 * what the official runtime holds for it. `officialRegionUVs` are those of the official mesh.
 */
function compareTexture(
    rig: GeometryRig,
    problems: Problems,
    where: string,
    attachment: RegionAttachmentData | MeshAttachmentData,
    index: number,
    official: OfficialTexture,
    officialRegionUVs: ArrayLike<number>,
): void {
    const template = templateOf(rig, attachment);
    const regionIndex = template.regions[index];
    const uvs = template.uvs.subarray(index * template.uvLength, (index + 1) * template.uvLength);

    problems.same(`${where} region`, regionIndex, official.region);
    if (attachment.type === 'region') {
        problems.equal(`${where} offsets`, template.offsets.subarray(index * 8, index * 8 + 8), official.offsets ?? []);
        problems.equal(`${where} uvs`, uvs, official.uvs);
    } else if (rig.json && regionIndex !== undefined) {
        const region = readRegion(rig.atlas, regionIndex);

        // the one allowed difference: JSON region UVs are 64-bit in the official runtime
        problems.equal(`${where} uvs`, uvs, official.uvs, (i) => uvSlack(region, officialRegionUVs, i));
    } else problems.equal(`${where} uvs`, uvs, official.uvs);
}

/** A region or mesh attachment against what the official loader holds for each of its sequence indices. */
function compareDrawable(rig: GeometryRig, problems: Problems, drawable: OfficialDrawable): void {
    const { ref, frames } = drawable;
    const where = `${rig.model.skins[ref.skin]?.name}/${rig.model.slots.names[ref.slot]}/${ref.name}`;
    const attachment = rig.lookup.resolve(ref);

    if (attachment?.type !== drawable.type || (attachment.type !== 'region' && attachment.type !== 'mesh')) {
        problems.add(where, `the model has ${attachment?.type}, the official loader has ${drawable.type}`);

        return;
    }
    const template = templateOf(rig, attachment);
    const officialRegionUVs = drawable.regionUVs ?? new Float64Array(0);

    problems.same(`${where} frames`, template.regions.length, frames.length);
    frames.forEach((frame, index) => {
        const at = `${where} frame ${index}`;
        const regionIndex = template.regions[index];

        compareTexture(rig, problems, at, attachment, index, frame, officialRegionUVs);
        if (attachment.type !== 'mesh' || regionIndex === undefined) return;
        const uvs = template.uvs.subarray(index * template.uvLength, (index + 1) * template.uvLength);
        const fromOfficial = new Float32Array(uvs.length);

        // the official math on the region UVs of the model has our bits
        problems.equal(`${at} uvs from rounded region UVs`, uvs, frame.roundedUvs ?? []);
        // our math on the region UVs of the official loader has the official bits, also for JSON
        computeMeshUVs(readRegion(rig.atlas, regionIndex), officialRegionUVs, fromOfficial);
        problems.equal(`${at} uvs from official region UVs`, fromOfficial, frame.uvs);
    });
}

/** The 4 vertices of a region attachment, packed and then with an offset and a stride. */
function compareRegion(
    rig: GeometryRig,
    state: PoseState,
    problems: Problems,
    where: string,
    attachment: RegionAttachmentData,
    shown: OfficialShown,
): void {
    const template = templateOf(rig, attachment);
    const index = resolveSequenceIndex(attachment.sequence, shown.sequenceIndex);
    const packed = new Float64Array(8);
    const officialPacked: number[] = [];
    const size = OFFSET + 4 * STRIDE;
    const spread = new Float64Array(size).fill(UNTOUCHED);
    const officialSpread = new Array<number>(size).fill(UNTOUCHED);

    if (shown.texture) compareTexture(rig, problems, where, attachment, index, shown.texture, []);
    else problems.add(where, 'the official runtime shows no region');
    computeRegionWorldVertices(template.offsets, index * 8, state.world, shown.bone, packed);
    shown.computeWorld(0, 8, officialPacked, 0, 2);
    problems.equal(`${where} world`, packed, Float64Array.from(officialPacked));
    computeRegionWorldVertices(template.offsets, index * 8, state.world, shown.bone, spread, OFFSET, STRIDE);
    shown.computeWorld(0, 8, officialSpread, OFFSET, STRIDE);
    problems.equal(`${where} world with a stride`, spread, Float64Array.from(officialSpread));
}

/** The vertices of a mesh, bounding box, path or clipping attachment: all of them, then a window. */
function compareVertices(
    rig: GeometryRig,
    state: PoseState,
    problems: Problems,
    where: string,
    attachment: Exclude<AttachmentData, RegionAttachmentData | { type: 'point' }>,
    shown: OfficialShown,
): void {
    const data = attachment.type === 'mesh' ? meshSource(rig.lookup, attachment) : attachment;
    const length = data.worldVerticesLength;
    // the official deform of this frame, in the layout of PoseState
    const deform = Float64Array.from(shown.deform);

    state.deform[shown.slot] = deform;
    state.deformLengths[shown.slot] = deform.length;
    problems.same(`${where} length`, length, shown.worldVerticesLength);
    if (attachment.type === 'mesh' && shown.texture) {
        const index = resolveSequenceIndex(attachment.sequence, shown.sequenceIndex);

        compareTexture(rig, problems, where, attachment, index, shown.texture, shown.regionUVs ?? []);
    } else problems.same(`${where} has a texture`, shown.texture !== null, attachment.type === 'mesh');
    const all = new Float64Array(length);
    const officialAll: number[] = [];

    computeWorldVertices(data, state.world, shown.bone, deform, deform.length, all);
    shown.computeWorld(0, length, officialAll, 0, 2);
    problems.equal(`${where} world`, all, Float64Array.from(officialAll));
    if (length < 4) return;
    // skip the first vertex, as a path constraint does, and write with an offset and a stride
    const count = length - 2;
    const size = OFFSET + (count >> 1) * STRIDE;
    const part = new Float64Array(size).fill(UNTOUCHED);
    const officialPart = new Array<number>(size).fill(UNTOUCHED);

    computeWorldVertices(data, state.world, shown.bone, deform, deform.length, part, OFFSET, STRIDE, 2, count);
    shown.computeWorld(2, count, officialPart, OFFSET, STRIDE);
    problems.equal(`${where} world from the second vertex`, part, Float64Array.from(officialPart));
}

/** Attachments of the current official frame against our kernels, fed with the official pose. */
function comparePose(
    rig: GeometryRig,
    state: PoseState,
    problems: Problems,
    label: string,
    playback: OfficialGeometryPlayback,
    placed: OfficialShown[],
): void {
    playback.readBones(state.world);
    for (const shown of placed) {
        const where = `${label} ${rig.model.slots.names[shown.slot]}/${shown.ref.name}`;
        const attachment = rig.lookup.resolve(shown.ref);

        problems.same(`${where} bone`, rig.model.slots.bones[shown.slot], shown.bone);
        if (attachment === undefined || attachment.type !== shown.type) {
            problems.add(where, `the model has ${attachment?.type}, the official runtime shows ${shown.type}`);
        } else if (attachment.type === 'region') compareRegion(rig, state, problems, where, attachment, shown);
        else compareVertices(rig, state, problems, where, attachment, shown);
    }
}

/**
 * Compares the regions, the offsets and the texture coordinates of every region and mesh
 * attachment, for every sequence index, with what the official loader holds. Lists the differences.
 */
export function checkDrawables(rig: GeometryRig): string[] {
    const problems = new Problems();

    for (const drawable of rig.official.drawables()) compareDrawable(rig, problems, drawable);

    return problems.lines;
}

/**
 * Plays every animation in the official runtime and compares the vertices of every slot, frame by
 * frame. `visit` sees everything that is compared, for a test that wants to know what was reached.
 */
export function checkAnimations(rig: GeometryRig, visit?: (shown: OfficialShown) => void): string[] {
    const problems = new Problems();
    const state = createPoseState(rig.model);
    const { animations, skins } = rig.official;

    animations.forEach((animation, index) => {
        // the skins take turns, so that the animations show the attachments of every skin
        const playback = rig.official.play(animation.name, skins[index % skins.length]);
        const dt = (animation.duration > 0 ? animation.duration : 1) / FRAMES_PER_LOOP;

        for (let frame = 0; frame < FRAMES && !problems.full; frame++) {
            playback.step(frame === 0 ? 0 : dt);
            const shown = playback.shown();

            if (visit) shown.forEach(visit);
            comparePose(rig, state, problems, `${animation.name} frame ${frame}`, playback, shown);
        }
    });

    return problems.lines;
}

/**
 * Compares the vertices of every attachment of every skin in the setup pose, shown or not. This
 * reaches bounding boxes and whatever no animation shows.
 */
export function checkSetupPoses(rig: GeometryRig, visit?: (shown: OfficialShown) => void): string[] {
    const problems = new Problems();
    const state = createPoseState(rig.model);

    // an active skin poses the bones that only it needs
    for (const skin of [undefined, ...rig.official.skins]) {
        const playback = rig.official.play(undefined, skin);

        playback.step(0);
        const stored = playback.stored();

        if (visit) stored.forEach(visit);
        comparePose(rig, state, problems, `skin ${skin}`, playback, stored);
    }

    return problems.lines;
}
