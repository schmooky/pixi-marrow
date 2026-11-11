import { MarrowError } from '../base/errors';
import { ATLAS_REGION_STRIDE, type AtlasModel } from '../model/atlas';
import type { MeshAttachmentData, RegionAttachmentData, SequenceData } from '../model/attachments';
import { i32 } from './read';

/** Field offsets inside one region of `AtlasModel.regions`. */
const X = 1;
const Y = 2;
const WIDTH = 3;
const HEIGHT = 4;
const OFFSET_X = 5;
const OFFSET_Y = 6;
const ORIGINAL_WIDTH = 7;
const ORIGINAL_HEIGHT = 8;
const DEGREES = 9;

/**
 * One region of an atlas with the numbers the official `TextureAtlasRegion` holds. Sizes are in
 * pixels of the page. Texture coordinates are 64-bit, as in the official runtime.
 */
export interface AtlasRegion {
    /** The index of the page in `AtlasModel.pages`. */
    page: number;
    /** The size of the page. Texture coordinates are relative to it. */
    pageWidth: number;
    pageHeight: number;
    /** The top left corner of the region on the page. */
    x: number;
    y: number;
    /** The size of the packed image, before it was rotated into the page. */
    width: number;
    height: number;
    /** The pixels trimmed from the left and from the bottom of the original image. */
    offsetX: number;
    offsetY: number;
    /** The size of the image before it was trimmed. */
    originalWidth: number;
    originalHeight: number;
    /** The rotation of the image inside the page. */
    degrees: number;
    /** The texture coordinates of the top left corner on the page. */
    u: number;
    v: number;
    /** The texture coordinates of the bottom right corner. Width and height swap for `degrees` 90 only. */
    u2: number;
    v2: number;
}

function missingRegion(atlas: AtlasModel, path: string, user: string): MarrowError {
    return new MarrowError('invalid-data', `The atlas has no region "${path}"${user}.`, {
        fix: 'Pass the atlas that was exported with the skeleton, or export both again.',
        validNames: atlas.regionNames,
    });
}

/**
 * Finds the region of an atlas for an attachment path, as the official `TextureAtlas.findRegion`
 * does: the first region with that name. Throws a {@link MarrowError} that names the path when
 * the atlas has no such region.
 *
 * @example
 * const atlas = importAtlas(atlasText);
 * const region = readRegion(atlas, findRegion(atlas, 'head'));
 */
export function findRegion(atlas: AtlasModel, path: string): number {
    const index = atlas.regionNames.indexOf(path);

    if (index === -1) throw missingRegion(atlas, path, '');

    return index;
}

/**
 * Reads a region of an atlas by index and derives its texture coordinates, as the official
 * `TextureAtlas` does while it loads. Throws a {@link MarrowError} for an index or a page the
 * atlas does not have.
 *
 * @example
 * const region = readRegion(atlas, findRegion(atlas, 'head'));
 * console.log(atlas.pages[region.page]?.name, region.u, region.v, region.u2, region.v2);
 */
export function readRegion(atlas: AtlasModel, region: number): AtlasRegion {
    const { regions } = atlas;
    const at = region * ATLAS_REGION_STRIDE;

    if (!Number.isInteger(region) || region < 0 || region >= atlas.regionNames.length) {
        throw new MarrowError(
            'invalid-data',
            `The atlas has ${atlas.regionNames.length} regions and no region ${region}.`,
            {
                fix: 'Pass an index from findRegion or attachmentRegions.',
            },
        );
    }
    const pageIndex = i32(regions, at);
    const page = atlas.pages[pageIndex];

    if (page === undefined) {
        throw new MarrowError(
            'invalid-data',
            `Region ${region} of the atlas is on page ${pageIndex}, which the atlas does not have.`,
            {
                fix: 'Import the atlas again with importAtlas.',
            },
        );
    }
    const x = i32(regions, at + X);
    const y = i32(regions, at + Y);
    const width = i32(regions, at + WIDTH);
    const height = i32(regions, at + HEIGHT);
    const degrees = i32(regions, at + DEGREES);
    // the official loader swaps the sides for 90 degrees and for no other rotation
    const rotated = degrees === 90;

    return {
        page: pageIndex,
        pageWidth: page.width,
        pageHeight: page.height,
        x,
        y,
        width,
        height,
        offsetX: i32(regions, at + OFFSET_X),
        offsetY: i32(regions, at + OFFSET_Y),
        originalWidth: i32(regions, at + ORIGINAL_WIDTH),
        originalHeight: i32(regions, at + ORIGINAL_HEIGHT),
        degrees,
        u: x / page.width,
        v: y / page.height,
        u2: (x + (rotated ? height : width)) / page.width,
        v2: (y + (rotated ? width : height)) / page.height,
    };
}

/**
 * The atlas path of one index of a sequence, as the official `Sequence.getPath` builds it: the
 * path, then `start + index` padded with zeros to `digits`. The three official versions build the
 * same paths. Without a sequence the path stays as it is. 4.3 does that for the sequence without
 * a path suffix that it gives such an attachment.
 *
 * @example
 * const sequence = { count: 3, start: 1, digits: 2, setupIndex: 0 };
 * console.log(sequencePath('fire/flame_', sequence, 2)); // fire/flame_03
 */
export function sequencePath(path: string, sequence: SequenceData | null, index: number): string {
    if (sequence === null) return path;

    return path + String(sequence.start + index).padStart(sequence.digits, '0');
}

/**
 * The atlas region of a region or mesh attachment for every index of its sequence. An attachment
 * without a sequence has one region. A linked mesh has its own path and so its own regions.
 * Throws a {@link MarrowError} that names the path when the atlas misses a region.
 *
 * @example
 * const regions = attachmentRegions(atlas, attachment);
 * const shown = regions[resolveSequenceIndex(attachment.sequence, state.sequenceIndices[slot] ?? -1)];
 */
export function attachmentRegions(
    atlas: AtlasModel,
    attachment: RegionAttachmentData | MeshAttachmentData,
): Int32Array {
    const { path, sequence } = attachment;
    const count = sequence === null ? 1 : sequence.count;
    const regions: number[] = [];

    for (let i = 0; i < count; i++) {
        const regionPath = sequencePath(path, sequence, i);
        const index = atlas.regionNames.indexOf(regionPath);

        if (index === -1) throw missingRegion(atlas, regionPath, ` for the attachment "${attachment.name}"`);
        regions.push(index);
    }

    return Int32Array.from(regions);
}

/**
 * The position in {@link attachmentRegions} that a slot shows, as the official `Sequence` resolves
 * a slot's sequence index. -1 stands for the setup index. An index past the end shows the last
 * region. The result is -1 for a sequence without regions.
 *
 * @example
 * const index = resolveSequenceIndex(attachment.sequence, state.sequenceIndices[slot] ?? -1);
 */
export function resolveSequenceIndex(sequence: SequenceData | null, index: number): number {
    if (sequence === null) return 0;
    const resolved = index === -1 ? sequence.setupIndex : index;

    return resolved >= sequence.count ? sequence.count - 1 : resolved;
}
