import type { AtlasRegion } from './atlas-regions';
import { type FloatArray, float } from './read';

/** The untrimmed image of a region in texture coordinates: its first corner and its size. */
interface ImageRect {
    u: number;
    v: number;
    width: number;
    height: number;
}

/** Where the whole image would be on the page, with the trimmed border put back, per rotation. */
function imageRect(region: AtlasRegion): ImageRect {
    const { pageWidth, pageHeight, width, height, offsetX, offsetY, originalWidth, originalHeight } = region;

    switch (region.degrees) {
        case 90:
            return {
                u: region.u - (originalHeight - offsetY - height) / pageWidth,
                v: region.v - (originalWidth - offsetX - width) / pageHeight,
                width: originalHeight / pageWidth,
                height: originalWidth / pageHeight,
            };
        case 180:
            return {
                u: region.u - (originalWidth - offsetX - width) / pageWidth,
                v: region.v - offsetY / pageHeight,
                width: originalWidth / pageWidth,
                height: originalHeight / pageHeight,
            };
        case 270:
            return {
                u: region.u - offsetY / pageWidth,
                v: region.v - offsetX / pageHeight,
                width: originalHeight / pageWidth,
                height: originalWidth / pageHeight,
            };
        default:
            return {
                u: region.u - offsetX / pageWidth,
                v: region.v - (originalHeight - offsetY - height) / pageHeight,
                width: originalWidth / pageWidth,
                height: originalHeight / pageHeight,
            };
    }
}

/**
 * Writes the texture coordinates of a mesh for an atlas region, as the official
 * `MeshAttachment.updateRegion` does for rotations of 0, 90, 180 and 270 degrees. 4.3 moved the
 * same math to `MeshAttachment.computeUVs` and keeps one set per sequence index.
 *
 * `regionUVs` holds u, v per vertex relative to the untrimmed image. For a linked mesh pass the
 * `regionUVs` of `meshSource(lookup, mesh)` with the region of the linked mesh itself. The result
 * is rounded to 32-bit floats, as in the official runtime.
 *
 * The model stores region UVs in 32 bits, which is what a binary file holds. The official JSON
 * reader keeps 64-bit numbers. For a JSON file the result can therefore differ from the official
 * one by what that rounding moves a coordinate. With 64-bit region UVs it is the same bit for bit.
 *
 * The official 4.1 divides by the size of the loaded image where 4.2 and 4.3 divide by the page
 * size of the atlas. This function has no image and uses the page size for every version.
 *
 * One u, v pair is written every `stride` numbers from `offset` on.
 *
 * @example
 * const source = meshSource(lookup, mesh);
 * const uvs = new Float32Array(source.regionUVs.length);
 * computeMeshUVs(readRegion(atlas, findRegion(atlas, mesh.path)), source.regionUVs, uvs);
 */
export function computeMeshUVs(
    region: AtlasRegion,
    regionUVs: FloatArray,
    out: FloatArray,
    offset = 0,
    stride = 2,
): void {
    const { u, v, width, height } = imageRect(region);
    const { degrees } = region;

    for (let i = 0, w = offset; i < regionUVs.length; i += 2, w += stride) {
        const ru = float(regionUVs, i);
        const rv = float(regionUVs, i + 1);
        let s = ru;
        let t = rv;

        if (degrees === 90) {
            s = rv;
            t = 1 - ru;
        } else if (degrees === 180) {
            s = 1 - ru;
            t = 1 - rv;
        } else if (degrees === 270) {
            s = 1 - rv;
            t = ru;
        }
        out[w] = Math.fround(u + s * width);
        out[w + 1] = Math.fround(v + t * height);
    }
}
