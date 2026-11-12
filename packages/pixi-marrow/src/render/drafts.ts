import { MarrowError } from '../base/errors';
import { attachmentRegions } from '../geometry/atlas-regions';
import type { AtlasModel } from '../model/atlas';
import type { AttachmentData, MeshAttachmentData, RegionAttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import { type AttachmentLookup, meshSource } from '../pose/shared/lookup';
import { type Cuts, NO_CUT, type RegionCut, regionCut } from './cuts';

/*
 * What a template lays out: one draft per region and mesh attachment a slot can show, with the
 * vertex count and the triangles it will have. Nothing is allocated for the vertex data here.
 */

/** An attachment that draws pixels. */
export type Drawable = RegionAttachmentData | MeshAttachmentData;

/** The two triangles of a region attachment, in the order of the official Pixi runtime. */
const QUAD: Uint16Array = Uint16Array.of(0, 1, 2, 0, 2, 3);

/** The slot blend mode that blends normally. An index into `BLEND_MODES`. */
const NORMAL = 0;

/** What is known about an entry of a template before its buffers exist. */
export interface Draft {
    slot: number;
    attachment: Drawable;
    /** The mesh that holds the vertices and the region UVs, or null for a region attachment. */
    source: MeshAttachmentData | null;
    triangles: Uint16Array;
    /** The atlas region of each frame. */
    regions: Int32Array;
    vertices: number;
    /** What the outline of the region allows. */
    cut: RegionCut;
    /** True for a region that shows no pixel: no vertex, and still a place in the draw order. */
    hollow: boolean;
}

/**
 * Whether an attachment draws pixels: a region or a mesh.
 *
 * @example
 * if (isDrawable(state.attachments[slot])) console.log('the slot can be visible');
 */
export const isDrawable = (attachment: AttachmentData | null | undefined): attachment is Drawable =>
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

/** The draft of a region attachment: its quad, or the polygon the outline of its region allows. */
function regionDraft(
    atlas: AtlasModel,
    slot: number,
    attachment: RegionAttachmentData,
    cuts: Cuts | undefined,
    normalBlend: boolean,
): Draft {
    const regions = attachmentRegions(atlas, attachment);
    const cut = regionCut(cuts, atlas, attachment, regions, normalBlend);
    const { polygon } = cut;
    const vertices = polygon === null ? 4 : polygon.length >> 1;

    return {
        slot,
        attachment,
        source: null,
        triangles: polygon === null ? QUAD : cut.triangles,
        regions,
        // a sequence without regions keeps its entry and draws nothing
        vertices: regions.length > 0 ? vertices : 0,
        cut,
        hollow: polygon !== null && vertices === 0,
    };
}

function meshDraft(atlas: AtlasModel, lookup: AttachmentLookup, slot: number, attachment: MeshAttachmentData): Draft {
    const regions = attachmentRegions(atlas, attachment);
    const source = meshGeometry(lookup, attachment);
    // a mesh without triangles keeps its entry and draws nothing
    const drawn = regions.length > 0 && source.triangles.length > 0;
    const vertices = drawn ? source.worldVerticesLength >> 1 : 0;

    return { slot, attachment, source, triangles: source.triangles, regions, vertices, cut: NO_CUT, hollow: false };
}

/**
 * The drafts of every region and mesh attachment each slot can show with a skin, sorted by slot:
 * the attachments of that skin, of the default skin, and the ones in `shown`.
 *
 * With `cuts` a region attachment is drafted as the polygon of its atlas region. Throws a
 * {@link MarrowError} when the atlas misses a region, and for a mesh that is damaged.
 *
 * @example
 * const drafts = draftEntries(model, atlas, createAttachmentLookup(model), -1, null, undefined);
 * console.log(drafts.reduce((sum, entry) => sum + entry.vertices, 0));
 */
export function draftEntries(
    model: SkeletonModel,
    atlas: AtlasModel,
    lookup: AttachmentLookup,
    skin: number,
    shown: readonly (AttachmentData | null)[] | null,
    cuts: Cuts | undefined,
): Draft[] {
    return collectDrawables(model, lookup, skin, shown).flatMap((list, slot) =>
        list.map((attachment) =>
            attachment.type === 'region'
                ? regionDraft(atlas, slot, attachment, cuts, model.slots.blendModes[slot] === NORMAL)
                : meshDraft(atlas, lookup, slot, attachment),
        ),
    );
}
