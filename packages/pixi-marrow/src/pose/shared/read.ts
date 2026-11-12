import { MarrowError } from '../../base/errors';

/** A typed array of floats. A kernel writes 32-bit or 64-bit numbers, as the caller chooses. */
export type FloatArray = Float32Array | Float64Array;

function pastEnd(index: number, length: number): never {
    throw new MarrowError('invalid-data', `A geometry kernel read index ${index} of an array of ${length} numbers.`, {
        fix: 'Pass arrays as long as the attachment needs. Check the deform length, the bone count and the vertex count.',
    });
}

/*
 * One reader per array type. A plain read past the end gives undefined, which would turn into
 * NaN positions without a word. Each reader sees one array type only.
 */

/**
 * Reads one number of a `Float32Array`. Throws a {@link MarrowError} past the end of the array.
 *
 * @example
 * const x = f32(mesh.vertices, 0);
 */
export function f32(array: Float32Array, index: number): number {
    return array[index] ?? pastEnd(index, array.length);
}

/**
 * Reads one number of a `Float64Array`. Throws a {@link MarrowError} past the end of the array.
 *
 * @example
 * const worldX = f64(state.world, bone * WORLD_STRIDE + 4);
 */
export function f64(array: Float64Array, index: number): number {
    return array[index] ?? pastEnd(index, array.length);
}

/**
 * Reads one number of an `Int16Array`. Throws a {@link MarrowError} past the end of the array.
 *
 * @example
 * const boneCount = i16(mesh.bones, 0);
 */
export function i16(array: Int16Array, index: number): number {
    return array[index] ?? pastEnd(index, array.length);
}

/**
 * Reads one number of an `Int32Array`. Throws a {@link MarrowError} past the end of the array.
 *
 * @example
 * const page = i32(atlas.regions, region * ATLAS_REGION_STRIDE);
 */
export function i32(array: Int32Array, index: number): number {
    return array[index] ?? pastEnd(index, array.length);
}

/**
 * Reads one number of a float array of either width. Throws a {@link MarrowError} past the end of the array.
 *
 * @example
 * const offsetX = float(offsets, 0);
 */
export function float(array: FloatArray, index: number): number {
    return array[index] ?? pastEnd(index, array.length);
}
