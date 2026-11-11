import type { SpineVersion } from '../base/version';
import type { RegionAttachmentData } from '../model/attachments';
import type { AtlasRegion } from './atlas-regions';
import type { FloatArray } from './read';
import { transformPoints } from './vertices';

/** Degrees to radians as the official 4.2 and 4.3 runtimes convert, with their pi of 8 digits. */
// biome-ignore lint/suspicious/noApproximativeNumericConstant: the official MathUtils.PI is this rounded number
const DEG_RAD = 3.1415927 / 180;

/** Writes one x, y pair. `round` stores it as the 32-bit float an official `Float32Array` holds. */
function put(out: FloatArray, at: number, x: number, y: number, round: boolean): void {
    out[at] = round ? Math.fround(x) : x;
    out[at + 1] = round ? Math.fround(y) : y;
}

/**
 * Writes the 8 vertex offsets of a region attachment for an atlas region: the four corners
 * relative to the bone, as the official `RegionAttachment.updateRegion` computes them. A trimmed
 * region gives a smaller quad. The rotation of the region inside its page does not change the
 * offsets.
 *
 * The official versions differ, and `version` selects which one to reproduce:
 *
 * - 4.1 turns the rotation into radians with the full pi, 4.2 and 4.3 with a pi of 8 digits.
 * - 4.1 and 4.2 keep the offsets in the attachment as 32-bit floats, for the region shown last.
 * - 4.3 moved the math to the static `RegionAttachment.computeUVs`. `Sequence.update` calls it for
 *   every sequence index and keeps the results in `Sequence.offsets` as 64-bit numbers.
 *
 * For a 4.3 model pass a `Float64Array` to keep the official numbers. A `Float32Array` rounds
 * them, and world positions can then differ from the official ones in the last bits.
 *
 * One x, y pair is written every `stride` numbers from `offset` on. The order is the official
 * one: bottom right, bottom left, upper left, upper right.
 *
 * @example
 * const region = readRegion(atlas, findRegion(atlas, attachment.path));
 * const offsets = model.version === '4.3' ? new Float64Array(8) : new Float32Array(8);
 * computeRegionOffsets(model.version, attachment, region, offsets);
 */
export function computeRegionOffsets(
    version: SpineVersion,
    attachment: RegionAttachmentData,
    region: AtlasRegion,
    out: FloatArray,
    offset = 0,
    stride = 2,
): void {
    const { x, y, scaleX, scaleY, width, height } = attachment;
    const regionScaleX = (width / region.originalWidth) * scaleX;
    const regionScaleY = (height / region.originalHeight) * scaleY;
    const localX = (-width / 2) * scaleX + region.offsetX * regionScaleX;
    const localY = (-height / 2) * scaleY + region.offsetY * regionScaleY;
    const localX2 = localX + region.width * regionScaleX;
    const localY2 = localY + region.height * regionScaleY;
    const radians = version === '4.1' ? (attachment.rotation * Math.PI) / 180 : attachment.rotation * DEG_RAD;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const localXCos = localX * cos + x;
    const localXSin = localX * sin;
    const localYCos = localY * cos + y;
    const localYSin = localY * sin;
    const localX2Cos = localX2 * cos + x;
    const localX2Sin = localX2 * sin;
    const localY2Cos = localY2 * cos + y;
    const localY2Sin = localY2 * sin;
    const round = version !== '4.3';

    put(out, offset, localXCos - localYSin, localYCos + localXSin, round);
    put(out, offset + stride, localXCos - localY2Sin, localY2Cos + localXSin, round);
    put(out, offset + stride * 2, localX2Cos - localY2Sin, localY2Cos + localX2Sin, round);
    put(out, offset + stride * 3, localX2Cos - localYSin, localYCos + localX2Sin, round);
}

/**
 * Writes the 8 texture coordinates of a region attachment for an atlas region, as the official
 * `RegionAttachment.updateRegion` does, and `RegionAttachment.computeUVs` in 4.3. The three
 * official versions give the same numbers. They turn the coordinates for a region rotated by 90
 * degrees and for no other rotation. The numbers are 32-bit floats, as in the official runtime.
 *
 * One u, v pair is written every `stride` numbers from `offset` on, in the order of the offsets.
 *
 * @example
 * const uvs = new Float32Array(8);
 * computeRegionUVs(readRegion(atlas, findRegion(atlas, attachment.path)), uvs);
 */
export function computeRegionUVs(region: AtlasRegion, out: FloatArray, offset = 0, stride = 2): void {
    const { u, v, u2, v2 } = region;

    if (region.degrees === 90) {
        put(out, offset, u2, v2, true);
        put(out, offset + stride, u, v2, true);
        put(out, offset + stride * 2, u, v, true);
        put(out, offset + stride * 3, u2, v, true);
    } else {
        put(out, offset, u, v2, true);
        put(out, offset + stride, u, v, true);
        put(out, offset + stride * 2, u2, v, true);
        put(out, offset + stride * 3, u2, v2, true);
    }
}

/**
 * Writes the world positions of the 4 vertices of a region attachment, as the official
 * `RegionAttachment.computeWorldVertices` does. The three official versions agree.
 *
 * `offsets` holds the 8 numbers from {@link computeRegionOffsets}, starting at `offsetsStart`.
 * `world` is `PoseState.world` and `bone` is the bone of the slot. One x, y pair is written every
 * `stride` numbers from `offset` on. Nothing is allocated.
 *
 * @example
 * const positions = new Float32Array(8);
 * computeRegionWorldVertices(offsets, 0, state.world, state.model.slots.bones[slot] ?? 0, positions);
 */
export function computeRegionWorldVertices(
    offsets: FloatArray,
    offsetsStart: number,
    world: Float64Array,
    bone: number,
    out: FloatArray,
    offset = 0,
    stride = 2,
): void {
    transformPoints(offsets, offsetsStart, world, bone, out, offset, offset + 4 * stride, stride);
}
