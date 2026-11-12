import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { decodePng } from '../../src/optimize/png';
import { listAtlasFixtures, loadAtlasFixture, seeded } from '../geometry/outline-checks';
import { CHANNELS, chunk, encodePng, filterRows, header, type PngSpec, SIGNATURE } from './png-encoder';

/*
 * The decoder is tested against PNG files that a small encoder builds sample by sample: every
 * color type with every row filter.
 */

/** Whether the tRNS chunk of an RGB image names this color. It holds 16 bits per sample. */
const isKey = (key: number[], r: number, g: number, b: number): boolean =>
    key.length === 6 && key[0] === 0 && key[2] === 0 && key[4] === 0 && key[1] === r && key[3] === g && key[5] === b;

/** What the samples of one pixel mean as red, green, blue, alpha. */
function pixelOf(spec: PngSpec, [a = 0, b = 0, c = 0, d = 0]: Uint8Array): number[] {
    const key = spec.transparency ?? [];

    switch (spec.colorType) {
        case 0:
            return [a, a, a, key.length === 2 && key[0] === 0 && key[1] === a ? 0 : 255];
        case 2:
            return [a, b, c, isKey(key, a, b, c) ? 0 : 255];
        case 3:
            return [...(spec.palette ?? []).slice(a * 3, a * 3 + 3), key[a] ?? 255];
        case 4:
            return [a, a, a, b];
        default:
            return [a, b, c, d];
    }
}

/** What the samples of a spec mean as red, green, blue, alpha. */
function expectedRgba(spec: PngSpec): number[] {
    const step = CHANNELS[spec.colorType] ?? 1;
    const out: number[] = [];

    for (let at = 0; at < spec.samples.length; at += step)
        out.push(...pixelOf(spec, spec.samples.subarray(at, at + step)));

    return out;
}

const WIDTH = 7;
const HEIGHT = 6;
const PALETTE = Array.from({ length: 5 * 3 }, (_, i) => (i * 37 + 11) % 256);

/** An image of random samples. A palette image uses the 5 colors of {@link PALETTE}. */
function randomSpec(colorType: number, filters: number[], seed: number): PngSpec {
    const random = seeded(seed);
    const most = colorType === 3 ? 5 : 256;
    const samples = Uint8Array.from({ length: WIDTH * HEIGHT * (CHANNELS[colorType] ?? 1) }, () =>
        Math.floor(random() * most),
    );

    return {
        width: WIDTH,
        height: HEIGHT,
        colorType,
        samples,
        filters,
        ...(colorType === 3 ? { palette: PALETTE } : {}),
    };
}

const rgbaSpec = (changes: Partial<PngSpec> = {}): PngSpec => ({
    ...randomSpec(6, [1, 2, 3, 4, 0, 4], 99),
    ...changes,
});

async function failure(bytes: Uint8Array, name?: string): Promise<MarrowError> {
    const error = await decodePng(bytes, name).catch((reason: unknown) => reason);

    if (!(error instanceof MarrowError)) throw new Error(`expected a MarrowError, got ${String(error)}`);
    expect(error.code).toBe('invalid-data');

    return error;
}

describe('decodePng', () => {
    const colorTypes = [0, 2, 3, 4, 6];
    const filters = [[0], [1], [2], [3], [4], [4, 3, 2, 1, 0, 3]];

    it.each(colorTypes.flatMap((colorType) => filters.map((rows) => ({ colorType, rows }))))(
        'decodes color type $colorType with the row filters $rows',
        async ({ colorType, rows }) => {
            const spec = randomSpec(colorType, rows, colorType * 10 + (rows[0] ?? 0));
            const image = await decodePng(encodePng(spec));

            expect(image.width).toBe(WIDTH);
            expect(image.height).toBe(HEIGHT);
            expect(Array.from(image.data)).toEqual(expectedRgba(spec));
        },
    );

    it('applies the transparency of a tRNS chunk to palette, gray and RGB images', async () => {
        const palette = { ...randomSpec(3, [4], 1), transparency: [0, 128, 255] };
        const gray = randomSpec(0, [3], 2);
        const rgb = randomSpec(2, [1], 3);
        const [r = 0, g = 0, b = 0] = rgb.samples.subarray(9, 12);

        gray.transparency = [0, gray.samples[5] ?? 0];
        rgb.transparency = [0, r, 0, g, 0, b];
        for (const spec of [palette, gray, rgb]) {
            const expected = expectedRgba(spec);

            expect(Array.from((await decodePng(encodePng(spec))).data)).toEqual(expected);
            expect(expected.filter((_, i) => i % 4 === 3).some((alpha) => alpha !== 255)).toBe(true);
        }
        // a color of 16 bits per sample is not a color of this image
        rgb.transparency = [1, r, 0, g, 0, b];
        expect(
            (await decodePng(encodePng(rgb))).data.filter((_, i) => i % 4 === 3).every((alpha) => alpha === 255),
        ).toBe(true);
    });

    it('reads pixel data in several chunks, packed at any level, and skips chunks it does not need', async () => {
        const spec = rgbaSpec({ parts: 5, extra: [chunk('tEXt', [65, 0, 66]), chunk('gAMA', [0, 0, 177, 143])] });
        const expected = expectedRgba(spec);

        expect(Array.from((await decodePng(encodePng(spec))).data)).toEqual(expected);
        for (const level of [0, 1, 9]) {
            const packed = deflateSync(filterRows(spec), { level });

            expect(Array.from((await decodePng(encodePng(spec, packed))).data)).toEqual(expected);
        }
        // an RGB image may carry a palette as a hint
        expect((await decodePng(encodePng({ ...randomSpec(2, [0], 4), palette: PALETTE }))).width).toBe(WIDTH);
    });

    it('reads a file that is a view into a larger buffer', async () => {
        const file = encodePng(rgbaSpec());
        const buffer = new Uint8Array(file.length + 40);

        buffer.set(file, 17);
        expect(Array.from((await decodePng(buffer.subarray(17, 17 + file.length))).data)).toEqual(
            expectedRgba(rgbaSpec()),
        );
    });

    it('refuses 16 bits per channel, fewer than 8 bits and interlacing, and says what to do', async () => {
        const deep = await failure(encodePng(rgbaSpec({ depth: 16 })), 'hero.png');
        const shallow = await failure(encodePng({ ...randomSpec(3, [0], 5), depth: 4 }));
        const interlaced = await failure(encodePng(rgbaSpec({ interlace: 1 })), 'hero.png');

        expect(deep.message).toContain(
            'The image "hero.png" has 16 bits per channel, which the PNG decoder does not read.',
        );
        expect(shallow.message).toContain('The image has 4 bits per channel');
        expect(interlaced.message).toContain('The image "hero.png" is interlaced');
        for (const error of [deep, shallow, interlaced]) {
            expect(error.fix).toBe('Save the image as a PNG with 8 bits per channel and without interlacing.');
        }
    });

    it('refuses a file that is not a PNG', async () => {
        const error = await failure(new TextEncoder().encode('hero.png\n  size: 64, 64\n'), 'hero.atlas');

        expect(error.message).toContain(
            'The image "hero.atlas" is not a valid PNG file: it does not start as a PNG file does.',
        );
        await failure(new Uint8Array(0));
    });

    it('refuses a file that ends early, at every length', async () => {
        const file = encodePng(rgbaSpec({ parts: 2 }));

        for (let length = 0; length < file.length; length++) await failure(file.subarray(0, length));
    });

    it('refuses a file with one changed bit, wherever it is', async () => {
        const file = encodePng(rgbaSpec());

        for (let at = 0; at < file.length; at++) {
            const damaged = file.slice();

            damaged[at] = (damaged[at] ?? 0) ^ (1 << (at % 8));
            await failure(damaged);
        }
    });

    it('names the chunk with a wrong checksum', async () => {
        const file = encodePng(rgbaSpec());

        // the last byte of the header chunk is part of its checksum
        file[8 + 12 + 13 - 1] = (file[8 + 12 + 13 - 1] ?? 0) ^ 0xff;
        expect((await failure(file)).message).toContain('the checksum of its chunk "IHDR" is wrong');
    });

    it('refuses damaged contents behind valid checksums', async () => {
        const noPalette: PngSpec = { width: 2, height: 2, colorType: 3, samples: new Uint8Array(4), filters: [0] };
        const shortPalette = { ...randomSpec(3, [0], 7), palette: PALETTE.slice(0, 6) };
        const spec = rgbaSpec();
        const rows = filterRows(spec);
        const badFilter = rows.slice();

        badFilter[0] = 7;
        const cases: [Uint8Array, string][] = [
            [encodePng(noPalette), 'it has no palette'],
            [encodePng(shortPalette), 'which its palette does not have'],
            [encodePng(rgbaSpec({ colorType: 5 })), 'it has the color type 5'],
            [encodePng(rgbaSpec({ width: 0 })), 'it has no pixels'],
            [encodePng(spec, deflateSync(badFilter)), 'row 0 has the unknown filter 7'],
            [encodePng(spec, deflateSync(rows.subarray(0, rows.length - 3))), 'bytes of pixel data and needs'],
            [encodePng(spec, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)), 'its pixel data cannot be unpacked'],
            [encodePng(spec, new Uint8Array(0)), 'it has no pixel data'],
            [encodePng(rgbaSpec({ extra: [chunk('ABCD', [1])] })), 'it has the unknown chunk "ABCD"'],
            [encodePng(rgbaSpec({ extra: [header(spec)] })), 'its header is not its first chunk'],
        ];

        for (const [bytes, message] of cases) expect((await failure(bytes)).message).toContain(message);
    });

    it('refuses a header chunk of the wrong size and a file that does not start with one', async () => {
        const start = Uint8Array.from(SIGNATURE);
        const join = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from(parts.flatMap((part) => Array.from(part)));

        expect((await failure(join(start, chunk('IHDR', [0, 0, 0, 1]), chunk('IEND', [])))).message).toContain(
            'no pixel data',
        );
        expect((await failure(join(start, chunk('IEND', [])))).message).toContain('its header is not its first chunk');
        expect(
            (await failure(join(start, chunk('IHDR', [0, 0, 0, 1]), chunk('IDAT', [1]), chunk('IEND', [])))).message,
        ).toContain('its header has 4 bytes');
    });
});

describe('decodePng on the fixtures', () => {
    it.each(listAtlasFixtures())('decodes every page of $id to the size the atlas states', async (fixture) => {
        const { atlas, pages } = await loadAtlasFixture(fixture);

        expect(pages).toHaveLength(atlas.pages.length);
        atlas.pages.forEach((page, i) => {
            expect(pages[i]?.width).toBe(page.width);
            expect(pages[i]?.height).toBe(page.height);
            expect(pages[i]?.data).toHaveLength(page.width * page.height * 4);
            // an atlas page is not an empty image
            expect(pages[i]?.data.some((byte) => byte !== 0)).toBe(true);
        });
    });
});
