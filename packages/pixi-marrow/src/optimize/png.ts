import { MarrowError } from '../base/errors';

/*
 * A PNG decoder for the command line tool, which reads atlas pages without a browser. It has no
 * dependency: the pixel data is unpacked by `DecompressionStream`, which Node has as a global.
 * It reads what atlas pages are in practice: 8 bits per channel, not interlaced.
 */

/** A decoded image: four bytes per pixel in the order red, green, blue, alpha, rows from the top. */
export interface PngImage {
    width: number;
    height: number;
    data: Uint8Array;
}

const SIGNATURE: readonly number[] = [137, 80, 78, 71, 13, 10, 26, 10];
/** Bytes of a chunk besides its data: length, type and checksum. */
const CHUNK_OVERHEAD = 12;
const FIX_DAMAGED = 'Export the image again, or save it again as a PNG file.';
const FIX_UNSUPPORTED = 'Save the image as a PNG with 8 bits per channel and without interlacing.';

/** Samples per pixel by color type. A color type that is missing here does not exist. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const GRAY = 0;
const PALETTE = 3;
const GRAY_ALPHA = 4;

/** What the chunks of a file hold. */
interface Chunks {
    width: number;
    height: number;
    colorType: number;
    /** Samples per pixel as they are stored. */
    channels: number;
    /** Three bytes per palette color, or null. */
    palette: Uint8Array | null;
    /** The tRNS chunk: alpha per palette color, or the one color that is transparent. */
    transparency: Uint8Array | null;
    /** The packed pixel data of all IDAT chunks. */
    packed: Uint8Array<ArrayBuffer>;
}

/** Makes the errors of one file. Every message starts with the image the caller named. */
interface Complain {
    damaged(what: string): MarrowError;
    unsupported(what: string): MarrowError;
}

function complainAbout(name: string | undefined): Complain {
    const image = name === undefined ? 'The image' : `The image "${name}"`;

    return {
        damaged: (what) =>
            new MarrowError('invalid-data', `${image} is not a valid PNG file: ${what}.`, { fix: FIX_DAMAGED }),
        unsupported: (what) =>
            new MarrowError('invalid-data', `${image} ${what}, which the PNG decoder does not read.`, {
                fix: FIX_UNSUPPORTED,
            }),
    };
}

let crcTable: Uint32Array | undefined;

/** The CRC-32 of a byte range, as PNG and zlib define it. */
function crc32(bytes: Uint8Array, start: number, end: number): number {
    if (crcTable === undefined) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;

            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c;
        }
    }
    let crc = 0xffffffff;

    for (let i = start; i < end; i++) crc = (crcTable[(crc ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);

    return (crc ^ 0xffffffff) >>> 0;
}

/** Checks the IHDR chunk and returns the size, the color type and the samples per pixel. */
function readHeader(
    header: Uint8Array,
    complain: Complain,
): Pick<Chunks, 'width' | 'height' | 'colorType' | 'channels'> {
    if (header.length !== 13) throw complain.damaged(`its header has ${header.length} bytes`);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const [depth = 0, colorType = 0, compression = 0, filter = 0, interlace = 0] = header.subarray(8);
    const channels = CHANNELS[colorType];
    const width = view.getUint32(0);
    const height = view.getUint32(4);

    if (channels === undefined) throw complain.damaged(`it has the color type ${colorType}`);
    if (compression !== 0 || filter !== 0 || interlace > 1)
        throw complain.damaged('its header names an unknown method');
    if (width === 0 || height === 0) throw complain.damaged('it has no pixels');
    if (depth !== 8) throw complain.unsupported(`has ${depth} bits per channel`);
    if (interlace === 1) throw complain.unsupported('is interlaced');

    return { width, height, colorType, channels };
}

/** Walks the chunks of a file, checks each checksum and collects what the decoder needs. */
function readChunks(bytes: Uint8Array, complain: Complain): Chunks {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const found = new Map<string, Uint8Array>();
    const data: Uint8Array[] = [];
    let at = SIGNATURE.length;
    let type = '';

    if (!SIGNATURE.every((byte, i) => bytes[i] === byte))
        throw complain.damaged('it does not start as a PNG file does');
    while (type !== 'IEND') {
        if (at + CHUNK_OVERHEAD > bytes.length) throw complain.damaged('it ends before its last chunk');
        const length = view.getUint32(at);
        const end = at + 8 + length;

        if (end + 4 > bytes.length) throw complain.damaged('it ends in the middle of a chunk');
        type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        if (crc32(bytes, at + 4, end) !== view.getUint32(end)) {
            throw complain.damaged(`the checksum of its chunk ${JSON.stringify(type)} is wrong`);
        }
        if ((found.size === 0) !== (type === 'IHDR')) throw complain.damaged('its header is not its first chunk');
        if (type === 'IDAT') data.push(bytes.subarray(at + 8, end));
        // a chunk with a capital first letter must be understood. These four are all there are.
        else if (/^[A-Z]/.test(type) && !['IHDR', 'PLTE', 'IEND'].includes(type)) {
            throw complain.damaged(`it has the unknown chunk ${JSON.stringify(type)}`);
        }
        found.set(type, bytes.subarray(at + 8, end));
        at = end + 4;
    }
    const packed = new Uint8Array(data.reduce((sum, part) => sum + part.length, 0));

    data.reduce((offset, part) => {
        packed.set(part, offset);

        return offset + part.length;
    }, 0);
    if (packed.length === 0) throw complain.damaged('it has no pixel data');

    return {
        ...readHeader(found.get('IHDR') ?? new Uint8Array(0), complain),
        palette: found.get('PLTE') ?? null,
        transparency: found.get('tRNS') ?? null,
        packed,
    };
}

/** Unpacks zlib data. The stream fails for damaged data, for data that ends early and for bytes after the end. */
async function inflate(packed: Uint8Array<ArrayBuffer>, complain: Complain): Promise<Uint8Array> {
    try {
        const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'));

        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
        throw complain.damaged('its pixel data cannot be unpacked');
    }
}

/** The Paeth predictor: of left, up and upper left, the one closest to left + up - upper left. */
function paeth(left: number, up: number, upLeft: number): number {
    const p = left + up - upLeft;
    const toLeft = Math.abs(p - left);
    const toUp = Math.abs(p - up);
    const toUpLeft = Math.abs(p - upLeft);

    if (toLeft <= toUp && toLeft <= toUpLeft) return left;

    return toUp <= toUpLeft ? up : upLeft;
}

/** Undoes the Average filter of one row. `up` is -1 for the first row, which has zeros above it. */
function unfilterAverage(raw: Uint8Array, row: number, up: number, length: number, step: number): void {
    for (let i = 0; i < length; i++) {
        const left = i >= step ? (raw[row + i - step] ?? 0) : 0;
        const above = up >= 0 ? (raw[up + i] ?? 0) : 0;

        raw[row + i] = (raw[row + i] ?? 0) + ((left + above) >> 1);
    }
}

/** Undoes the Paeth filter of one row. */
function unfilterPaeth(raw: Uint8Array, row: number, up: number, length: number, step: number): void {
    for (let i = 0; i < length; i++) {
        const left = i >= step ? (raw[row + i - step] ?? 0) : 0;
        const above = up >= 0 ? (raw[up + i] ?? 0) : 0;
        const aboveLeft = up >= 0 && i >= step ? (raw[up + i - step] ?? 0) : 0;

        raw[row + i] = (raw[row + i] ?? 0) + paeth(left, above, aboveLeft);
    }
}

/**
 * Undoes the filter of one row in place. `row` is the index of its first sample, `up` the index
 * of the first sample of the row above, or -1 for the first row. `step` is the bytes per pixel.
 * The array keeps the low 8 bits of each sum. False for a filter that does not exist.
 */
function unfilterRow(raw: Uint8Array, filter: number, row: number, up: number, length: number, step: number): boolean {
    if (filter === 1) {
        for (let i = step; i < length; i++) raw[row + i] = (raw[row + i] ?? 0) + (raw[row + i - step] ?? 0);
    } else if (filter === 2 && up >= 0) {
        for (let i = 0; i < length; i++) raw[row + i] = (raw[row + i] ?? 0) + (raw[up + i] ?? 0);
    } else if (filter === 3) unfilterAverage(raw, row, up, length, step);
    else if (filter === 4) unfilterPaeth(raw, row, up, length, step);

    return filter <= 4;
}

/** Undoes the row filters in place. Each row starts with the number of its filter. */
function unfilter(raw: Uint8Array, chunks: Chunks, complain: Complain): void {
    const length = chunks.width * chunks.channels;
    const stride = length + 1;

    if (raw.length !== stride * chunks.height) {
        throw complain.damaged(`it holds ${raw.length} bytes of pixel data and needs ${stride * chunks.height}`);
    }
    for (let y = 0; y < chunks.height; y++) {
        const start = y * stride;
        const filter = raw[start] ?? 0;

        if (!unfilterRow(raw, filter, start + 1, y === 0 ? -1 : start + 1 - stride, length, chunks.channels)) {
            throw complain.damaged(`row ${y} has the unknown filter ${filter}`);
        }
    }
}

/**
 * The alpha of a color without an alpha sample: 0 for the one color the tRNS chunk names, else
 * 255. The chunk holds 16 bits per sample. A color of 8 bits matches when the high bytes are 0.
 */
function keyAlpha(transparency: Uint8Array | null, raw: Uint8Array, at: number, samples: number): number {
    if (transparency === null || transparency.length !== samples * 2) return 255;
    for (let i = 0; i < samples; i++) {
        if (transparency[i * 2] !== 0 || transparency[i * 2 + 1] !== raw[at + i]) return 255;
    }

    return 0;
}

/**
 * Writes one row of a palette image. Returns the first color number the palette does not have,
 * or -1 when every pixel has a color.
 */
function paletteRow(
    chunks: Chunks,
    palette: Uint8Array,
    raw: Uint8Array,
    at: number,
    out: Uint8Array,
    to: number,
): number {
    for (let x = 0; x < chunks.width; x++) {
        const index = raw[at + x] ?? 0;

        if (index * 3 + 2 >= palette.length) return index;
        out[to + x * 4] = palette[index * 3] ?? 0;
        out[to + x * 4 + 1] = palette[index * 3 + 1] ?? 0;
        out[to + x * 4 + 2] = palette[index * 3 + 2] ?? 0;
        out[to + x * 4 + 3] = chunks.transparency?.[index] ?? 255;
    }

    return -1;
}

/** Writes one row of a gray or RGB image, with or without an alpha sample. */
function colorRow(chunks: Chunks, raw: Uint8Array, start: number, out: Uint8Array, to: number): void {
    const { colorType, channels, transparency } = chunks;
    const gray = colorType === GRAY || colorType === GRAY_ALPHA;

    for (let x = 0, at = start; x < chunks.width; x++, at += channels) {
        const first = raw[at] ?? 0;

        out[to + x * 4] = first;
        out[to + x * 4 + 1] = gray ? first : (raw[at + 1] ?? 0);
        out[to + x * 4 + 2] = gray ? first : (raw[at + 2] ?? 0);
        out[to + x * 4 + 3] = colorType === GRAY_ALPHA ? (raw[at + 1] ?? 0) : keyAlpha(transparency, raw, at, channels);
    }
}

/** Turns unfiltered rows into red, green, blue, alpha. */
function toRgba(raw: Uint8Array, chunks: Chunks, complain: Complain): Uint8Array {
    const { width, height, colorType, channels, palette } = chunks;
    const out = new Uint8Array(width * height * 4);

    if (colorType === PALETTE && palette === null) throw complain.damaged('it has no palette');
    for (let y = 0; y < height; y++) {
        const at = y * (width * channels + 1) + 1;
        const to = y * width * 4;

        if (channels === 4) out.set(raw.subarray(at, at + width * 4), to);
        else if (palette === null || colorType !== PALETTE) colorRow(chunks, raw, at, out, to);
        else {
            const missing = paletteRow(chunks, palette, raw, at, out, to);

            if (missing !== -1) {
                throw complain.damaged(`a pixel has the color ${missing}, which its palette does not have`);
            }
        }
    }

    return out;
}

/**
 * Decodes a PNG file into red, green, blue, alpha bytes. Reads images with 8 bits per channel
 * that are not interlaced: gray, gray with alpha, RGB, RGBA and palette images, with the
 * transparency of a tRNS chunk. The checksum of every chunk is checked.
 *
 * Throws a {@link MarrowError} for a file that is damaged, and for 16 bits per channel, fewer
 * than 8 bits and interlacing. `name` is the file name the message states.
 *
 * It needs `DecompressionStream`, which Node 18 and every current browser have.
 *
 * @example
 * const image = await decodePng(new Uint8Array(readFileSync('hero.png')), 'hero.png');
 * console.log(image.width, image.height, image.data.length); // data holds width * height * 4 bytes
 */
export async function decodePng(bytes: Uint8Array, name?: string): Promise<PngImage> {
    const complain = complainAbout(name);
    const chunks = readChunks(bytes, complain);

    const raw = await inflate(chunks.packed, complain);

    unfilter(raw, chunks, complain);

    return { width: chunks.width, height: chunks.height, data: toRgba(raw, chunks, complain) };
}
