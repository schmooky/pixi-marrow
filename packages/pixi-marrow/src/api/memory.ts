import type { Texture, TextureSource } from 'pixi.js';
import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import { cutCode } from '../render/cut-code';

/*
 * Byte counts for `perf.memory()`. Only typed arrays, GPU buffers and textures are counted: their
 * size is known. JavaScript objects, strings and plain arrays have no size a page can read.
 */

/** The bytes of the models that were measured. A model never changes after its import. */
const measured = new WeakMap<object, number>();

/**
 * The bytes of every typed array that can be reached from a value through plain objects and
 * arrays. A buffer that several typed arrays share counts once, with its whole size.
 *
 * @example
 * typedArrayBytes({ parents: new Int16Array(4), setup: [new Float64Array(2)] }); // 24
 */
export function typedArrayBytes(root: unknown): number {
    const buffers = new Set<ArrayBufferLike>();
    const seen = new Set<object>();
    const stack: unknown[] = [root];
    let bytes = 0;

    while (stack.length > 0) {
        const value = stack.pop();

        if (typeof value !== 'object' || value === null || seen.has(value)) continue;
        seen.add(value);
        if (ArrayBuffer.isView(value)) {
            if (!buffers.has(value.buffer)) bytes += value.buffer.byteLength;
            buffers.add(value.buffer);
        } else for (const item of Array.isArray(value) ? value : Object.values(value)) stack.push(item);
    }

    return bytes;
}

/** The typed array bytes of a model or an atlas, counted once per object. */
function modelBytes(model: object): number {
    let bytes = measured.get(model);

    if (bytes === undefined) {
        bytes = typedArrayBytes(model);
        measured.set(model, bytes);
    }

    return bytes;
}

/**
 * The bytes an asset holds once for all of its instances: the typed arrays of the skeleton
 * model and of the atlas, and the triangles that views share for the outlines.
 *
 * @example
 * console.log(sharedBytes(asset.model, asset.atlas, asset.outlines));
 */
export function sharedBytes(model: SkeletonModel, atlas: AtlasModel, outlines: AtlasOutlines | undefined): number {
    return (
        modelBytes(model) + modelBytes(atlas) + (outlines === undefined ? 0 : (cutCode()?.triangleBytes(outlines) ?? 0))
    );
}

/** The bytes of one texture source on the GPU: 4 per pixel, for every mip level it has. */
function sourceBytes(source: TextureSource): number {
    let width = source.pixelWidth;
    let height = source.pixelHeight;
    let bytes = 0;

    for (let level = 0; level < Math.max(1, source.mipLevelCount); level++) {
        bytes += width * height * 4;
        width = Math.max(1, width >> 1);
        height = Math.max(1, height >> 1);
    }

    return bytes;
}

/**
 * The bytes the page textures of an asset take on the GPU: width times height times 4 for every
 * mip level. A source that two pages share counts once.
 *
 * @example
 * console.log(textureBytes(asset.textures));
 */
export function textureBytes(textures: readonly Texture[]): number {
    let bytes = 0;

    for (const source of new Set(textures.map((texture) => texture.source))) bytes += sourceBytes(source);

    return bytes;
}
