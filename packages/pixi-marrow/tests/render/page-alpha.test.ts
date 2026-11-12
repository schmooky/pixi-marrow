import {
    BufferImageSource,
    CompressedSource,
    DOMAdapter,
    type ICanvas,
    type ICanvasRenderingContext2D,
    TextureSource,
} from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildAtlasOutlines } from '../../src/geometry/outlines';
import { createPageReader, readPagePixels } from '../../src/render/page-alpha';
import { listAtlasFixtures, loadAtlasFixture } from '../geometry/outline-checks';

/*
 * Node has no canvas. The tests give Pixi a canvas that records what is drawn to it and hands
 * out the pixels a browser would read back.
 */

const adapter = DOMAdapter.get();

/** What a canvas was asked to do. */
interface Calls {
    size: number[];
    context: unknown[];
    drawn: unknown[];
    read: number[];
}

const isCanvas = (value: unknown): value is ICanvas =>
    typeof value === 'object' && value !== null && 'getContext' in value;
const isContext = (value: unknown): value is ICanvasRenderingContext2D =>
    typeof value === 'object' && value !== null && 'getImageData' in value;

/** Makes Pixi create canvases whose 2D context returns `data`, or fails as told. */
function useCanvas(data: Uint8ClampedArray, fail: 'no' | 'draw' | 'read' = 'no'): Calls {
    const calls: Calls = { size: [], context: [], drawn: [], read: [] };
    const context: unknown = {
        drawImage: (...args: unknown[]) => {
            if (fail === 'draw') throw new TypeError('The image cannot be drawn.');
            calls.drawn.push(...args);
        },
        getImageData: (...args: number[]) => {
            if (fail === 'read') throw new Error('The canvas has been tainted by cross-origin data.');
            calls.read.push(...args);

            return { data };
        },
    };

    DOMAdapter.set({
        ...adapter,
        createCanvas: (width = 0, height = 0) => {
            const canvas: unknown = {
                width,
                height,
                getContext: (...args: unknown[]) => {
                    calls.context.push(...args);

                    return isContext(context) ? context : null;
                },
            };

            calls.size.push(width, height);
            if (!isCanvas(canvas)) throw new Error('not a canvas');

            return canvas;
        },
    });

    return calls;
}

/** Something a canvas can draw, as an image or an ImageBitmap is in a browser. */
const image = (width: number, height: number): TextureSource =>
    new TextureSource({ resource: { width, height, close: () => undefined } });

afterEach(() => DOMAdapter.set(adapter));

describe('readPagePixels', () => {
    it('draws the image to a canvas of its size and reads the pixels back', () => {
        const data = Uint8ClampedArray.from({ length: 4 * 3 * 4 }, (_, i) => i);
        const calls = useCanvas(data);
        const source = image(4, 3);

        expect(readPagePixels(source)).toEqual({ width: 4, height: 3, data });
        expect(calls.size).toEqual([4, 3]);
        expect(calls.context).toEqual(['2d', { willReadFrequently: true }]);
        expect(calls.drawn).toEqual([source.resource, 0, 0]);
        expect(calls.read).toEqual([0, 0, 4, 3]);
    });

    it('returns null without a 2D context, as in Node', () => {
        expect(readPagePixels(image(4, 3))).toBeNull();
    });

    it('returns null for an image that cannot be drawn or read, as one of another origin', () => {
        const data = new Uint8ClampedArray(4 * 3 * 4);

        useCanvas(data, 'draw');
        expect(readPagePixels(image(4, 3))).toBeNull();
        useCanvas(data, 'read');
        expect(readPagePixels(image(4, 3))).toBeNull();
    });

    it('returns null for a compressed texture and for a source without an image', () => {
        const calls = useCanvas(new Uint8ClampedArray(64));
        const compressed = new CompressedSource({
            resource: [new Uint8Array(16)],
            width: 4,
            height: 4,
            format: 'bc3-rgba-unorm',
        });

        expect(readPagePixels(compressed)).toBeNull();
        expect(readPagePixels(new TextureSource({ width: 4, height: 4 }))).toBeNull();
        expect(readPagePixels(new TextureSource({ resource: { url: 'hero.png' }, width: 4, height: 4 }))).toBeNull();
        expect(calls.size).toEqual([]);
    });

    it('returns the bytes of a texture that was made from bytes, without a canvas', () => {
        const calls = useCanvas(new Uint8ClampedArray(64));
        const bytes = Uint8Array.from({ length: 4 * 2 * 4 }, (_, i) => i);
        const clamped = new Uint8ClampedArray(bytes);

        for (const format of ['rgba8unorm', 'bgra8unorm'] as const) {
            const read = readPagePixels(new BufferImageSource({ resource: bytes, width: 4, height: 2, format }));

            expect(read).toEqual({ width: 4, height: 2, data: bytes });
            expect(read?.data).toBe(bytes);
        }
        expect(readPagePixels(new BufferImageSource({ resource: clamped, width: 4, height: 2 }))?.data).toBe(clamped);
        // floats, another size and another format are not pixels of four bytes
        expect(
            readPagePixels(new BufferImageSource({ resource: new Float32Array(32), width: 4, height: 2 })),
        ).toBeNull();
        expect(
            readPagePixels(new BufferImageSource({ resource: bytes, width: 4, height: 4, format: 'rgba8unorm' })),
        ).toBeNull();
        expect(
            readPagePixels(new BufferImageSource({ resource: bytes, width: 8, height: 4, format: 'r8unorm' })),
        ).toBeNull();
        expect(calls.size).toEqual([]);
    });

    it('gives pixels that the outlines of an atlas can be built from', async () => {
        const fixture = listAtlasFixtures().find((candidate) => candidate.id === '4.2/spineboy.atlas');

        if (fixture === undefined) throw new Error('no fixture 4.2/spineboy.atlas. Run: pnpm fixtures');
        const { atlas, pages } = await loadAtlasFixture(fixture);
        const read = pages.map((page) => {
            useCanvas(new Uint8ClampedArray(page.data));

            return readPagePixels(image(page.width, page.height));
        });

        expect(read[0]?.data).toBeInstanceOf(Uint8ClampedArray);
        expect(buildAtlasOutlines(atlas, read)).toEqual(buildAtlasOutlines(atlas, pages));
    });
});

/** What a WebGL context was asked to do, by a fake that hands back given bytes. */
interface GlCalls {
    names: string[];
    storage: unknown[][];
    uploaded: unknown[];
    lost: number;
}

/** Makes Pixi create canvases whose WebGL context returns `data` from `readPixels`, or fails as told. */
function useGl(data: Uint8Array, fail: 'no' | 'incomplete' | 'upload' | 'none' = 'no', maxSize = 4096): GlCalls {
    const calls: GlCalls = { names: [], storage: [], uploaded: [], lost: 0 };
    const note =
        (name: string) =>
        (...args: unknown[]): void => {
            calls.names.push(name);
            if (name === 'pixelStorei') calls.storage.push(args);
        };
    const gl: unknown = {
        UNPACK_PREMULTIPLY_ALPHA_WEBGL: 1,
        UNPACK_COLORSPACE_CONVERSION_WEBGL: 2,
        UNPACK_FLIP_Y_WEBGL: 3,
        NONE: 0,
        NO_ERROR: 0,
        FRAMEBUFFER_COMPLETE: 7,
        MAX_TEXTURE_SIZE: 8,
        createTexture: () => ({}),
        createFramebuffer: () => ({}),
        pixelStorei: note('pixelStorei'),
        bindTexture: note('bindTexture'),
        bindFramebuffer: note('bindFramebuffer'),
        framebufferTexture2D: note('framebufferTexture2D'),
        deleteFramebuffer: note('deleteFramebuffer'),
        deleteTexture: note('deleteTexture'),
        texImage2D: (...args: unknown[]) => {
            if (fail === 'upload') throw new Error('The image is of another origin.');
            calls.uploaded.push(args.at(-1));
        },
        checkFramebufferStatus: () => (fail === 'incomplete' ? 0 : 7),
        readPixels: (...args: unknown[]) => {
            const out = args.at(-1);

            if (out instanceof Uint8Array) out.set(data);
        },
        getError: () => 0,
        getParameter: () => maxSize,
        getExtension: () => ({
            loseContext: () => {
                calls.lost++;
            },
        }),
    };

    DOMAdapter.set({
        ...adapter,
        createCanvas: (width = 0, height = 0) => {
            const canvas: unknown = { width, height, getContext: () => (fail === 'none' ? null : gl) };

            calls.names.push('createCanvas');
            if (!isCanvas(canvas)) throw new Error('not a canvas');

            return canvas;
        },
    });

    return calls;
}

describe('createPageReader', () => {
    it('reads a premultiplied page through one WebGL context, as the bytes of the image', () => {
        const data = Uint8Array.from({ length: 2 * 2 * 4 }, (_, i) => i + 1);
        const calls = useGl(data);
        const reader = createPageReader();
        const first = image(2, 2);
        const second = image(2, 2);

        expect(reader.read(first, true)).toEqual({ width: 2, height: 2, data });
        expect(reader.read(second, true)).toEqual({ width: 2, height: 2, data });
        // no multiplication by alpha, no color conversion, no flip
        expect(calls.storage).toEqual([
            [1, false],
            [2, 0],
            [3, false],
            [1, false],
            [2, 0],
            [3, false],
        ]);
        expect(calls.uploaded).toEqual([first.resource, second.resource]);
        // one context for both pages, and it is given back
        expect(calls.names.filter((name) => name === 'createCanvas')).toHaveLength(1);
        expect(calls.names.filter((name) => name === 'deleteTexture')).toHaveLength(2);
        expect(calls.lost).toBe(0);
        reader.release();
        expect(calls.lost).toBe(1);
    });

    it('reads a straight page through the 2D canvas, and bytes in memory as they are', () => {
        const pixels = Uint8ClampedArray.from({ length: 16 }, (_, i) => i);
        const bytes = Uint8Array.from({ length: 16 }, (_, i) => 16 - i);
        const reader = createPageReader();

        useCanvas(pixels);
        expect(reader.read(image(2, 2), false)).toEqual({ width: 2, height: 2, data: pixels });
        const buffer = new BufferImageSource({ resource: bytes, width: 2, height: 2, format: 'rgba8unorm' });

        expect(reader.read(buffer, true)?.data).toBe(bytes);
        expect(reader.read(buffer, false)?.data).toBe(bytes);
        // no context was made, so there is none to give back
        expect(() => reader.release()).not.toThrow();
    });

    it('returns null for a premultiplied page it cannot read exactly', () => {
        const data = new Uint8Array(16);

        for (const fail of ['incomplete', 'upload', 'none'] as const) {
            useGl(data, fail);
            expect(createPageReader().read(image(2, 2), true)).toBeNull();
        }
        // an image larger than WebGL takes, and an image without a size
        useGl(data, 'no', 1);
        expect(createPageReader().read(image(2, 2), true)).toBeNull();
        useGl(data);
        expect(createPageReader().read(image(0, 2), true)).toBeNull();
        expect(createPageReader().read(new TextureSource({ width: 2, height: 2 }), true)).toBeNull();
    });
});
