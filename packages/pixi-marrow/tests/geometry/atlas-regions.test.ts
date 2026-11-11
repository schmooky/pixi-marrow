import { TextureAtlas as Atlas41, SkeletonJson as Json41, AtlasAttachmentLoader as Loader41 } from 'spine-core-4.1';
import { TextureAtlas as Atlas42, SkeletonJson as Json42, AtlasAttachmentLoader as Loader42 } from 'spine-core-4.2';
import {
    TextureAtlas as Atlas43,
    SkeletonJson as Json43,
    AtlasAttachmentLoader as Loader43,
    Sequence as Sequence43,
    SlotPose,
} from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importAtlas } from '../../src/formats/atlas';
import {
    attachmentRegions,
    findRegion,
    readRegion,
    resolveSequenceIndex,
    sequencePath,
} from '../../src/geometry/atlas-regions';
import type { RegionAttachmentData, SequenceData } from '../../src/model/attachments';
import { ATLAS_TEXT, regionName } from './synthetic';

const atlas = importAtlas(ATLAS_TEXT);

/** A region attachment that shows a path, with or without a sequence. */
const attachment = (path: string, sequence: SequenceData | null): RegionAttachmentData => ({
    type: 'region',
    name: 'shown',
    path,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    width: 20,
    height: 24,
    color: Float64Array.of(1, 1, 1, 1),
    sequence,
});

/**
 * The official sequence of every version for the sequence map of a skeleton file. 4.1 and 4.2
 * export no Sequence class, so their JSON readers build it.
 */
function officialSequences(map: object): { getPath(basePath: string, index: number): string }[] {
    const sequences = [
        new Json41(new Loader41(new Atlas41(ATLAS_TEXT))).readSequence(map),
        new Json42(new Loader42(new Atlas42(ATLAS_TEXT))).readSequence(map),
        new Json43(new Loader43(new Atlas43(ATLAS_TEXT))).readSequence(map),
    ];

    return sequences.flatMap((sequence) => (sequence ? [sequence] : []));
}

/** The error a call throws. Fails when it throws nothing or something else. */
function marrowError(run: () => unknown): MarrowError {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('Nothing was thrown');
}

describe('findRegion', () => {
    it('finds a region by its name', () => {
        expect(atlas.regionNames[findRegion(atlas, 'flame_09')]).toBe('flame_09');
        expect(findRegion(atlas, regionName(0, false))).toBe(0);
    });

    it('takes the first of several regions with one name, as the official atlas does', () => {
        const twice = importAtlas(
            'page.png\nsize: 8, 8\nframe\nbounds: 0, 0, 2, 2\nindex: 1\nframe\nbounds: 4, 4, 2, 2\n',
        );

        expect(findRegion(twice, 'frame')).toBe(0);
    });

    it('names the path when the atlas has no such region', () => {
        const error = marrowError(() => findRegion(atlas, 'nose/long'));

        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain('"nose/long"');
        expect(error.validNames).toEqual(atlas.regionNames);
    });
});

describe('readRegion', () => {
    it('reads a region and derives its texture coordinates from the page size', () => {
        expect(readRegion(atlas, findRegion(atlas, regionName(0, true)))).toEqual({
            page: 0,
            pageWidth: 256,
            pageHeight: 128,
            x: 2,
            y: 60,
            width: 36,
            height: 22,
            offsetX: 3,
            offsetY: 5,
            originalWidth: 44,
            originalHeight: 32,
            degrees: 0,
            u: 2 / 256,
            v: 60 / 128,
            u2: 38 / 256,
            v2: 82 / 128,
        });
    });

    it('swaps width and height on the page for 90 degrees and for no other rotation', () => {
        const corners = (degrees: number): number[] => {
            const region = readRegion(atlas, findRegion(atlas, regionName(degrees, false)));

            return [region.degrees, (region.u2 - region.u) * 256, (region.v2 - region.v) * 128];
        };

        expect(corners(0)).toEqual([0, 40, 30]);
        expect(corners(90)).toEqual([90, 30, 40]);
        // the official loader keeps the unrotated size for these, and so does this one
        expect(corners(180)).toEqual([180, 40, 30]);
        expect(corners(270)).toEqual([270, 40, 30]);
    });

    it('reads the page of a region', () => {
        const region = readRegion(atlas, findRegion(atlas, 'flame_10'));

        expect([region.page, region.pageWidth, region.pageHeight]).toEqual([1, 64, 512]);
        expect(atlas.pages[region.page]?.name).toBe('page-b.png');
    });

    it.each([-1, 0.5, atlas.regionNames.length, Number.NaN])('refuses the region index %s', (index) => {
        const error = marrowError(() => readRegion(atlas, index));

        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain(`no region ${index}`);
    });

    it('refuses a region on a page the atlas does not have', () => {
        const regions = atlas.regions.slice();

        regions[0] = 7;
        expect(marrowError(() => readRegion({ ...atlas, regions }, 0)).message).toContain('page 7');
    });
});

describe('sequencePath', () => {
    const sequence = (start: number, digits: number): SequenceData => ({ count: 12, start, digits, setupIndex: 0 });

    it('appends the number of the index, padded with zeros', () => {
        expect(sequencePath('fire/flame_', sequence(1, 2), 0)).toBe('fire/flame_01');
        expect(sequencePath('fire/flame_', sequence(8, 2), 2)).toBe('fire/flame_10');
        expect(sequencePath('flame', sequence(0, 0), 3)).toBe('flame3');
        expect(sequencePath('flame', sequence(98, 2), 5)).toBe('flame103');
        expect(sequencePath('flame', sequence(1, 4), 0)).toBe('flame0001');
    });

    it('keeps the path of an attachment without a sequence', () => {
        expect(sequencePath('head', null, 0)).toBe('head');
        // 4.3 gives every attachment a sequence. One without a path suffix is no sequence in the model.
        expect(new Sequence43(1, false).getPath('head', 0)).toBe('head');
    });

    it('builds the paths of the official Sequence.getPath of every version', () => {
        for (const start of [0, 1, 8, 99]) {
            for (const digits of [0, 1, 2, 4]) {
                const data = sequence(start, digits);
                const officials = officialSequences({ count: data.count, start, digits });

                expect(officials).toHaveLength(3);
                for (let index = 0; index < data.count; index++) {
                    const ours = sequencePath('a/b_', data, index);

                    expect(officials.map((official) => official.getPath('a/b_', index))).toEqual([ours, ours, ours]);
                }
            }
        }
    });
});

describe('attachmentRegions', () => {
    const flame: SequenceData = { count: 3, start: 8, digits: 2, setupIndex: 1 };

    it('gives one region for an attachment without a sequence', () => {
        expect(attachmentRegions(atlas, attachment('flame_09', null))).toEqual(
            Int32Array.of(findRegion(atlas, 'flame_09')),
        );
    });

    it('gives the region of every sequence index', () => {
        const regions = attachmentRegions(atlas, attachment('flame_', flame));

        expect(regions).toBeInstanceOf(Int32Array);
        expect(Array.from(regions, (region) => atlas.regionNames[region])).toEqual([
            'flame_08',
            'flame_09',
            'flame_10',
        ]);
    });

    it('gives no region for a sequence without regions', () => {
        expect(attachmentRegions(atlas, attachment('flame_', { ...flame, count: 0 }))).toEqual(new Int32Array(0));
    });

    it('names the path and the attachment when a region of the sequence is missing', () => {
        const error = marrowError(() => attachmentRegions(atlas, attachment('flame_', { ...flame, count: 4 })));

        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain('"flame_11"');
        expect(error.message).toContain('"shown"');
        expect(error.validNames).toEqual(atlas.regionNames);
    });

    it('names the path when the region of an attachment without a sequence is missing', () => {
        expect(marrowError(() => attachmentRegions(atlas, attachment('flame_', null))).message).toContain('"flame_"');
    });
});

describe('resolveSequenceIndex', () => {
    const sequence = (count: number, setupIndex: number): SequenceData => ({ count, start: 1, digits: 0, setupIndex });

    it('shows the setup index for -1', () => {
        expect(resolveSequenceIndex(sequence(3, 1), -1)).toBe(1);
    });

    it('shows the index a slot holds', () => {
        expect([0, 1, 2].map((index) => resolveSequenceIndex(sequence(3, 1), index))).toEqual([0, 1, 2]);
    });

    it('shows the last region for an index past the end', () => {
        expect(resolveSequenceIndex(sequence(3, 1), 3)).toBe(2);
        expect(resolveSequenceIndex(sequence(3, 1), 7)).toBe(2);
        expect(resolveSequenceIndex(sequence(3, 9), -1)).toBe(2);
    });

    it('has nothing to show for a sequence without regions', () => {
        expect(resolveSequenceIndex(sequence(0, 0), -1)).toBe(-1);
    });

    it('shows the one region of an attachment without a sequence', () => {
        expect([-1, 0, 5].map((index) => resolveSequenceIndex(null, index))).toEqual([0, 0, 0]);
    });

    it('resolves as the official 4.3 Sequence.resolveIndex does', () => {
        for (const count of [0, 1, 3, 5]) {
            for (const setupIndex of [0, 1, 4, 9]) {
                const official = new Sequence43(count, true);
                const pose = new SlotPose();

                official.setupIndex = setupIndex;
                for (let index = -1; index < 8; index++) {
                    pose.sequenceIndex = index;
                    expect(resolveSequenceIndex(sequence(count, setupIndex), index)).toBe(official.resolveIndex(pose));
                }
            }
        }
    });
});
