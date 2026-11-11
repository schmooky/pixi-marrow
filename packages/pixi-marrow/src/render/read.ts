import { MarrowError } from '../base/errors';

function pastEnd(index: number, length: number): never {
    throw new MarrowError('invalid-data', `The renderer read index ${index} of an array of ${length} numbers.`, {
        fix: 'Pass the PoseState of the model the view was created for.',
    });
}

/*
 * Readers for the array types the geometry kernel has none for. A plain read past the end gives
 * undefined, which would draw garbage without a word. Each reader sees one array type only.
 */

/**
 * Reads one number of a `Uint8Array`. Throws a {@link MarrowError} past the end of the array.
 *
 * @example
 * const active = u8(state.active, bone) === 1;
 */
export function u8(array: Uint8Array, index: number): number {
    return array[index] ?? pastEnd(index, array.length);
}

/**
 * Reads one number of a `Uint16Array`. Throws a {@link MarrowError} past the end of the array.
 *
 * @example
 * const corner = u16(mesh.triangles, 0);
 */
export function u16(array: Uint16Array, index: number): number {
    return array[index] ?? pastEnd(index, array.length);
}
