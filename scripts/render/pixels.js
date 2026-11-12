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
 * A render texture of `size` by `size` pixels and the means to draw into it and read it back.
 * On WebGPU the texture is copied to a buffer: the extract system of Pixi goes through a 2D canvas
 * there, which divides by alpha and loses the raw values. `antialias` makes the target multisampled.
 */
export function createStudio(PIXI, renderer, size, draws, antialias = false) {
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

    return {
        size,
        /** Draws a container alone on a background and reads nothing back. */
        draw(container, background) {
            renderer.render({ container, target, clear: true, clearColor: background.color });
        },
        /**
         * Draws a container alone on a background and reads the picture back.
         *
         * @returns The pixels and the draw calls the render took.
         */
        async shoot(container, background) {
            draws.count = 0;
            renderer.render({ container, target, clear: true, clearColor: background.color });
            const count = draws.count;
            const pixels = isGpu ? await readGpu() : renderer.texture.getPixels(target).pixels;

            return { pixels, draws: count };
        },
    };
}

/**
 * Compares two pictures of the same size.
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

    for (let i = 0, p = 0; i < a.length; i += 4, p++) {
        let d = 0;

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

/** A picture at half its size: every pixel is the mean of a block of four. */
function halve(pixels, size) {
    const half = size / 2;
    const out = new Uint8ClampedArray(half * half * 4);

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
    let covered = 0;
    let count = 0;

    for (let p = 0; p < size * size; p++) {
        if (drawn(a, p * 4) || drawn(b, p * 4)) covered++;
        if (!inside(a, b, p) || !inside(b, a, p)) count++;
    }

    return count / Math.max(covered, 1);
}

/** The number of pixels a picture drew on. */
export function coverage(pixels, background) {
    const [r, g, b, a] = background.bytes;
    let count = 0;

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
