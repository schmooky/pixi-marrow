import { TextureAtlas } from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importAtlas } from '../../src/formats/atlas';

const ATLAS = [
    'ignored: header',
    'page-one.png',
    'size: 256, 128',
    'filter: MipMap, Linear',
    'repeat: xy',
    'pma: true',
    'head',
    'bounds: 2, 4, 60, 40',
    'offsets: 1, 2, 64, 48',
    'rotate: 90',
    'index: 3',
    'split: 1, 2, 3, 4, 5',
    'pad: 6, 7',
    ' body ',
    'xy: 70, 4',
    'size: 20, 30',
    'offset: 5, 6',
    'orig: 40, 50',
    'rotate: true',
    'tail',
    'bounds: 100, 4, 8, 8',
    'rotate: false',
    '',
    'page-two.png',
    'size: 64, 64',
    'filter: Nearest, MipMapNearestLinear',
    'repeat: y',
    'leg',
    'bounds: 0, 0, 32, 32',
    'rotate: 180',
].join('\n');

describe('importAtlas', () => {
    const atlas = importAtlas(ATLAS);

    it('reads pages', () => {
        expect(atlas.pages).toEqual([
            {
                name: 'page-one.png',
                width: 256,
                height: 128,
                minFilter: 'mipMapLinearLinear',
                magFilter: 'linear',
                repeatX: true,
                repeatY: true,
                pma: true,
            },
            {
                name: 'page-two.png',
                width: 64,
                height: 64,
                minFilter: 'nearest',
                magFilter: 'mipMapNearestLinear',
                repeatX: false,
                repeatY: true,
                pma: false,
            },
        ]);
    });

    it('reads regions in both spellings of position, size and trimming', () => {
        expect(atlas.regionNames).toEqual(['head', ' body ', 'tail', 'leg']);
        expect([...atlas.regions]).toEqual([
            ...[0, 2, 4, 60, 40, 1, 2, 64, 48, 90, 3],
            ...[0, 70, 4, 20, 30, 5, 6, 40, 50, 90, 0],
            // no original size: the region is not trimmed
            ...[0, 100, 4, 8, 8, 0, 0, 8, 8, 0, 0],
            ...[1, 0, 0, 32, 32, 0, 0, 32, 32, 180, 0],
        ]);
    });

    it('keeps fields the format does not define, with at most four values', () => {
        expect(atlas.custom).toEqual([
            { region: 0, name: 'split', values: [1, 2, 3, 4] },
            { region: 0, name: 'pad', values: [6, 7] },
        ]);
    });

    it('agrees with the official class on the same text', () => {
        const official = new TextureAtlas(ATLAS);

        expect(atlas.regionNames).toEqual(official.regions.map((region) => region.name));
        expect(official.regions.map((region) => region.names)).toEqual([['split', 'pad'], null, null, null]);
        expect(official.regions[0]?.values).toEqual([
            [1, 2, 3, 4],
            [6, 7],
        ]);
    });

    it('skips blank lines before the first page', () => {
        expect(importAtlas('\n \npage.png\nsize: 8, 8\nbox\nbounds: 0, 0, 8, 8\n').regionNames).toEqual(['box']);
    });

    it('accepts Windows and old Mac line endings', () => {
        expect(importAtlas(ATLAS.replaceAll('\n', '\r\n'))).toEqual(atlas);
        expect(importAtlas(ATLAS.replaceAll('\n', '\r'))).toEqual(atlas);
    });

    it('rejects text without a page', () => {
        expect(() => importAtlas('')).toThrow(MarrowError);
        expect(() => importAtlas('\n\n')).toThrow('holds no page');
    });

    it('rejects an unknown texture filter and lists the known ones', () => {
        try {
            importAtlas('page.png\nfilter: Cubic, Linear\n');
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(MarrowError);
            if (!(error instanceof MarrowError)) return;
            expect(error.code).toBe('invalid-data');
            expect(error.validNames).toContain('linear');
        }
    });
});
