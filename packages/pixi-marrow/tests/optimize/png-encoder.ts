import { crc32, deflateSync } from 'node:zlib';

/*
 * A small PNG encoder for the tests. It builds a file sample by sample, with any color type and
 * any row filter, and with faults on request. zlib packs the data and gives the checksums.
 */

/** Samples per pixel by color type. */
export const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
export const SIGNATURE: readonly number[] = [137, 80, 78, 71, 13, 10, 26, 10];

export interface PngSpec {
    width: number;
    height: number;
    colorType: number;
    /** The samples of all rows, without filter bytes. */
    samples: Uint8Array;
    /** The filter of each row. Rows past the end of the list use the last one. */
    filters: number[];
    depth?: number;
    interlace?: number;
    /** r, g, b per palette color. */
    palette?: number[];
    /** The bytes of the tRNS chunk. */
    transparency?: number[];
    /** How many IDAT chunks the packed data is split into. */
    parts?: number;
    /** Chunks to add before the pixel data. */
    extra?: Uint8Array[];
}

export function chunk(type: string, data: ArrayLike<number>): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);

    view.setUint32(0, data.length);
    out.set(
        Array.from(type, (letter) => letter.charCodeAt(0)),
        4,
    );
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));

    return out;
}

export function header({ width, height, colorType, depth = 8, interlace = 0 }: PngSpec): Uint8Array {
    const data = new Uint8Array(13);
    const view = new DataView(data.buffer);

    view.setUint32(0, width);
    view.setUint32(4, height);
    data.set([depth, colorType, 0, 0, interlace], 8);

    return chunk('IHDR', data);
}

/** The predictor of the Paeth filter, written from the PNG specification. */
function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);

    if (pa <= pb && pa <= pc) return a;

    return pb <= pc ? b : c;
}

/** Puts a filter byte in front of every row and filters the row with it. */
export function filterRows(spec: PngSpec): Uint8Array {
    const step = CHANNELS[spec.colorType] ?? 1;
    const length = spec.width * step;
    const out = new Uint8Array((length + 1) * spec.height);
    const sample = (y: number, i: number): number => (y < 0 || i < 0 ? 0 : (spec.samples[y * length + i] ?? 0));

    for (let y = 0; y < spec.height; y++) {
        const filter = spec.filters[Math.min(y, spec.filters.length - 1)] ?? 0;

        out[y * (length + 1)] = filter;
        for (let i = 0; i < length; i++) {
            const left = sample(y, i - step);
            const up = sample(y - 1, i);
            const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, sample(y - 1, i - step))][filter] ?? 0;

            out[y * (length + 1) + 1 + i] = sample(y, i) - predicted;
        }
    }

    return out;
}

export function encodePng(spec: PngSpec, packed: Uint8Array = deflateSync(filterRows(spec))): Uint8Array {
    const parts = spec.parts ?? 1;
    const size = Math.ceil(packed.length / parts);
    const chunks = [
        Uint8Array.from(SIGNATURE),
        header(spec),
        ...(spec.palette === undefined ? [] : [chunk('PLTE', spec.palette)]),
        ...(spec.transparency === undefined ? [] : [chunk('tRNS', spec.transparency)]),
        ...(spec.extra ?? []),
        ...Array.from({ length: parts }, (_, i) => chunk('IDAT', packed.subarray(i * size, (i + 1) * size))),
        chunk('IEND', []),
    ];
    const out = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));

    chunks.reduce((at, part) => {
        out.set(part, at);

        return at + part.length;
    }, 0);

    return out;
}
