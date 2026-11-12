/*
 * Browser part of scripts/check-render.mjs: draws one object alone into a render texture, reads
 * the raw pixels back and compares two pictures. Pixels are premultiplied RGBA, as the GPU holds them.
 */

/** The backgrounds a frame is drawn on. Bytes are what a cleared pixel reads back as. */
export const BACKGROUNDS = {
    // what the blending wrote, alpha included
    clear: { color: [0, 0, 0, 0], bytes: [0, 0, 0, 0] },
    // what a person sees on a canvas: alpha errors show as color, and multiply slots show at all
    solid: { color: [64 / 255, 96 / 255, 128 / 255, 1], bytes: [64, 96, 128, 255] },
};

/** Counts the draw calls of the page, on WebGL2 and on WebGPU. Read `count`, reset it to 0. */
export function countDraws() {
    const draws = { count: 0 };
    const counted = [
        [globalThis.GPURenderPassEncoder, ['draw', 'drawIndexed']],
        [
            globalThis.WebGL2RenderingContext,
            ['drawElements', 'drawElementsInstanced', 'drawArrays', 'drawArraysInstanced', 'drawRangeElements'],
        ],
    ];

    for (const [type, names] of counted) {
        if (!type) continue;
        for (const name of names) {
            const original = type.prototype[name];

            type.prototype[name] = function (...args) {
                draws.count++;

                return original.apply(this, args);
            };
        }
    }

    return draws;
}

/**
 * Counts how often Pixi builds the instructions of a render group. Read `count`, reset it to 0.
 *
 * A render group keeps a list of instructions, one per batch, mesh, mask or filter step, and runs
 * that list every frame. It builds the list again when a child was added or removed, when
 * `visible` or `renderable` changed below it, or when a render pipe says that an object no longer
 * fits its instruction. That build walks every object of the group. The one place where it
 * happens is `_buildInstructions` of the render group system, which is wrapped here. Checked
 * against pixi.js 8.23.0. `counted` is false when a renderer has no such method.
 */
export function countBuilds(renderer) {
    const system = renderer.renderGroup;
    const builds = { count: 0, counted: typeof system?._buildInstructions === 'function' };

    if (!builds.counted) return builds;
    const original = system._buildInstructions;

    system._buildInstructions = function (...args) {
        builds.count++;

        return original.apply(this, args);
    };

    return builds;
}

/**
 * A render texture of `size` by `size` pixels and the means to draw into it and read it back.
 * On WebGPU the texture is copied to a buffer: the extract system of Pixi goes through a 2D canvas
 * there, which divides by alpha and loses the raw values. `antialias` makes the target multisampled.
 *
 * @param builds What `countBuilds` returned, or null where nobody asks how often Pixi built instructions.
 */
export function createStudio(PIXI, renderer, size, draws, antialias = false, builds = null) {
    const target = PIXI.RenderTexture.create({ width: size, height: size, resolution: 1, antialias });
    const isGpu = renderer.type === PIXI.RendererType.WEBGPU;
    const bytesPerRow = Math.ceil((size * 4) / 256) * 256;
    const buffer = isGpu
        ? renderer.gpu.device.createBuffer({
              size: bytesPerRow * size,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          })
        : null;

    async function readGpu() {
        const { device } = renderer.gpu;
        const encoder = device.createCommandEncoder();
        const pixels = new Uint8ClampedArray(size * size * 4);

        encoder.copyTextureToBuffer(
            { texture: renderer.texture.getGpuSource(target.source) },
            { buffer, bytesPerRow, rowsPerImage: size },
            { width: size, height: size },
        );
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const mapped = new Uint8Array(buffer.getMappedRange());

        for (let y = 0; y < size; y++)
            pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + size * 4), y * size * 4);
        buffer.unmap();
        if (target.source.format.startsWith('bgra')) {
            for (let i = 0; i < pixels.length; i += 4) {
                const blue = pixels[i];

                pixels[i] = pixels[i + 2];
                pixels[i + 2] = blue;
            }
        }

        return pixels;
    }

    /** Draws a container alone on a background. Returns the draw calls and the instruction builds it took. */
    function render(container, background) {
        draws.count = 0;
        if (builds) builds.count = 0;
        renderer.render({ container, target, clear: true, clearColor: background.color });

        return { draws: draws.count, builds: builds ? builds.count : 0 };
    }

    return {
        size,
        /** True when the instruction builds of a render are counted, see `countBuilds`. */
        countsBuilds: builds?.counted === true,
        /**
         * Draws a container alone on a background and reads nothing back.
         *
         * @returns The draw calls the render took, and how often Pixi built instructions for it.
         */
        draw: render,
        /**
         * Draws a container alone on a background and reads the picture back.
         *
         * @returns The pixels, the draw calls the render took and the instruction builds.
         */
        async shoot(container, background) {
            const counted = render(container, background);
            const pixels = isGpu ? await readGpu() : renderer.texture.getPixels(target).pixels;

            return { pixels, ...counted };
        },
    };
}

/**
 * The pixels of a picture as 32-bit words, one per pixel, or null when its bytes do not start on
 * a word. Two pixels are the same when their words are: that is one read where the bytes need four.
 */
function wordsOf(pixels) {
    return pixels.byteOffset % 4 === 0 ? new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length >> 2) : null;
}

/** The word a picture holds for a pixel with these four bytes. */
const wordOf = (bytes) => new Uint32Array(Uint8Array.from(bytes).buffer)[0];

/**
 * Compares two pictures of the same size.
 *
 * Most pixels of two pictures that are compared here are the same, so a pixel is first read as a
 * word from both. Only a pixel that differs is looked at channel by channel.
 *
 * @param alpha False leaves the alpha channel out.
 * @returns `max` is the largest channel difference. `differ` counts the pixels that differ at all,
 * `over1` and `over8` the ones that differ by more than 1 and more than 8 in a channel. `covered`
 * counts the pixels either picture drew on.
 * `box` bounds the pixels over 8, and `worst` is the pixel with the largest difference.
 */
export function compare(a, b, size, background, alpha = true) {
    const channels = alpha ? 4 : 3;
    const [br, bg, bb, ba] = background.bytes;
    const channelMax = [0, 0, 0, 0];
    const box = [size, size, -1, -1];
    let max = 0;
    let differ = 0;
    let over1 = 0;
    let over8 = 0;
    let covered = 0;
    let worst = -1;
    const wordsA = wordsOf(a);
    const wordsB = wordsOf(b);
    const words = wordsA !== null && wordsB !== null;
    const cleared = wordOf(background.bytes);

    for (let i = 0, p = 0; i < a.length; i += 4, p++) {
        let d = 0;

        // the same pixel in both pictures: it differs by nothing, and it is covered unless it is the background
        if (words && wordsA[p] === wordsB[p]) {
            if (wordsA[p] !== cleared) covered++;
            continue;
        }

        for (let c = 0; c < channels; c++) {
            const dc = Math.abs(a[i + c] - b[i + c]);

            if (dc > d) d = dc;
            if (dc > channelMax[c]) channelMax[c] = dc;
        }
        if (
            a[i] !== br ||
            a[i + 1] !== bg ||
            a[i + 2] !== bb ||
            a[i + 3] !== ba ||
            b[i] !== br ||
            b[i + 1] !== bg ||
            b[i + 2] !== bb ||
            b[i + 3] !== ba
        ) {
            covered++;
        }
        if (d > max) {
            max = d;
            worst = p;
        }
        if (d > 0) differ++;
        if (d > 1) over1++;
        if (d > 8) {
            const x = p % size;
            const y = (p - x) / size;

            over8++;
            if (x < box[0]) box[0] = x;
            if (y < box[1]) box[1] = y;
            if (x > box[2]) box[2] = x;
            if (y > box[3]) box[3] = y;
        }
    }

    return {
        max,
        channelMax: channelMax.slice(0, channels),
        differ,
        over1,
        over8,
        covered,
        box: over8 ? box : null,
        worst:
            worst < 0
                ? null
                : {
                      x: worst % size,
                      y: Math.floor(worst / size),
                      a: Array.from(a.subarray(worst * 4, worst * 4 + 4)),
                      b: Array.from(b.subarray(worst * 4, worst * 4 + 4)),
                  },
    };
}

/** The halves of the pictures that were halved before. A picture is compared with several others. */
const halves = new WeakMap();

/** A picture at half its size: every pixel is the mean of a block of four. */
function halve(pixels, size) {
    const half = size / 2;
    const known = halves.get(pixels);

    if (known) return known;
    const out = new Uint8ClampedArray(half * half * 4);

    halves.set(pixels, out);

    for (let y = 0; y < half; y++) {
        for (let x = 0; x < half; x++) {
            const i = (y * 2 * size + x * 2) * 4;

            for (let c = 0; c < 4; c++) {
                out[(y * half + x) * 4 + c] =
                    (pixels[i + c] + pixels[i + 4 + c] + pixels[i + size * 4 + c] + pixels[i + size * 4 + 4 + c] + 2) >>
                    2;
            }
        }
    }

    return out;
}

/**
 * The share of the covered pixels that a small displacement cannot explain. Both pictures are
 * halved first. A pixel passes when each of its channels lies within the range the other picture
 * has in the 3 by 3 pixels around that place, widened by 8. Both directions count. A picture that
 * sits a fraction of a pixel away blends neighbors, so it stays inside those ranges, while a wrong
 * color or a missing part does not. This is the measure for the JSON and the binary export of a
 * rig: Spine 4.1 and 4.2 write JSON with few decimals, so the two pictures are a little apart.
 */
export function displacedShare(first, second, fullSize, background) {
    const size = fullSize / 2;
    const a = halve(first, fullSize);
    const b = halve(second, fullSize);
    const inside = (from, to, p) => {
        const i = p * 4;
        const x = p % size;
        const y = (p - x) / size;

        for (let c = 0; c < 4; c++) {
            const value = from[i + c];

            // the same place first: most pixels match there
            if (Math.abs(value - to[i + c]) <= 8) continue;
            let low = 255;
            let high = 0;

            for (let qy = Math.max(y - 1, 0); qy <= Math.min(y + 1, size - 1); qy++) {
                for (let qx = Math.max(x - 1, 0); qx <= Math.min(x + 1, size - 1); qx++) {
                    const other = to[(qy * size + qx) * 4 + c];

                    if (other < low) low = other;
                    if (other > high) high = other;
                }
            }
            if (value < low - 8 || value > high + 8) return false;
        }

        return true;
    };
    const drawn = (pixels, i) => background.bytes.some((byte, c) => pixels[i + c] !== byte);
    // a half picture is an array of its own, so it starts on a word
    const wordsA = wordsOf(a);
    const wordsB = wordsOf(b);
    const cleared = wordOf(background.bytes);
    let covered = 0;
    let count = 0;

    for (let p = 0; p < size * size; p++) {
        // the same pixel in both: it is inside every range, and drawn unless it is the background
        if (wordsA[p] === wordsB[p]) {
            if (wordsA[p] !== cleared) covered++;
            continue;
        }
        if (drawn(a, p * 4) || drawn(b, p * 4)) covered++;
        if (!inside(a, b, p) || !inside(b, a, p)) count++;
    }

    return count / Math.max(covered, 1);
}

/** The number of pixels a picture drew on. */
export function coverage(pixels, background) {
    const [r, g, b, a] = background.bytes;
    const words = wordsOf(pixels);
    const cleared = wordOf(background.bytes);
    let count = 0;

    if (words !== null) {
        for (let p = 0; p < words.length; p++) if (words[p] !== cleared) count++;

        return count;
    }
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== r || pixels[i + 1] !== g || pixels[i + 2] !== b || pixels[i + 3] !== a) count++;
    }

    return count;
}

/** Encodes opaque RGBA bytes as a PNG, base64. */
function encode(rgba, size) {
    const canvas = document.createElement('canvas');

    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0);

    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

/** A picture as a person sees it: premultiplied pixels over a dark checkerboard. */
export function picture(pixels, size) {
    const out = new Uint8ClampedArray(pixels.length);

    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
        const x = p % size;
        const y = (p - x) / size;
        const under = ((x >> 4) + (y >> 4)) % 2 ? 44 : 56;
        const through = 1 - pixels[i + 3] / 255;

        out[i] = pixels[i] + under * through;
        out[i + 1] = pixels[i + 1] + under * through;
        out[i + 2] = pixels[i + 2] + under * through;
        out[i + 3] = 255;
    }

    return encode(out, size);
}

/**
 * Where two pictures differ, over a dim copy of the second one. Blue differs by 1, yellow by up
 * to 8, red by more.
 */
export function difference(a, b, size, alpha = true) {
    const out = new Uint8ClampedArray(a.length);
    const channels = alpha ? 4 : 3;

    for (let i = 0; i < a.length; i += 4) {
        let d = 0;

        for (let c = 0; c < channels; c++) d = Math.max(d, Math.abs(a[i + c] - b[i + c]));
        const dim = (b[i] * 0.3 + b[i + 1] * 0.5 + b[i + 2] * 0.2) * 0.3;
        const color = d > 8 ? [255, 40, 40] : d > 1 ? [255, 220, 0] : d === 1 ? [60, 110, 255] : [dim, dim, dim];

        out[i] = color[0];
        out[i + 1] = color[1];
        out[i + 2] = color[2];
        out[i + 3] = 255;
    }

    return encode(out, size);
}
