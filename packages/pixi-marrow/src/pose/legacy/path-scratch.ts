/*
 * The scratch of the path constraints.
 *
 * The official constraint keeps arrays of its own. Here every path constraint of every instance
 * shares the arrays below, which grow to the largest size that was needed and stay. That is exact,
 * because the official code writes every number of its arrays before it reads it, in each update.
 * Past its official length an array holds NaN, which is what a read past the end of the official
 * array computes with.
 */

/** The scratch arrays of the path constraints. A function reads the fields again after a call that can grow them. */
export const pathScratch: {
    /** The official `spaces`: the distance from each bone to the next. */
    spaces: Float64Array;
    /** The official `lengths`: the world length of each bone, for rotate mode `chainScale`. */
    lengths: Float64Array;
    /** The official `positions`: x, y and rotation for every space, then two zeros. */
    positions: Float64Array;
    /** The official `world`: world vertices of the path. */
    world: Float64Array;
    /** The official `curves`: the length up to the end of each curve. */
    curves: Float64Array;
    /** The official `segments`: the length up to the end of each tenth of a curve. */
    readonly segments: Float64Array;
} = {
    spaces: new Float64Array(0),
    lengths: new Float64Array(0),
    positions: new Float64Array(0),
    world: new Float64Array(0),
    curves: new Float64Array(0),
    segments: new Float64Array(10),
};

/**
 * Scratch numbers that go from one step to the next. A number that is passed to a call or
 * returned from one can cost an allocation.
 */
export const num: Float64Array = new Float64Array(4);
/** The place along the path, or along a curve, that the next step works on. */
export const PLACE = 0;
/** The official `pathLength`. */
export const PATH_LENGTH = 1;
/** The official `multiplier` of a space. */
export const MULTIPLIER = 2;
/** The official `curveLength`: the length of the curve the segments were measured for. */
export const CURVE_LENGTH = 3;

/** An array of at least `size` numbers: the one given, or a longer new one. */
export function atLeast(array: Float64Array, size: number): Float64Array {
    return array.length >= size ? array : new Float64Array(size + 16);
}

/** Makes `world` hold `size` numbers and NaN after them, as far as a read past the end can reach. */
export function sizeWorld(size: number): Float64Array {
    const world = atLeast(pathScratch.world, size + 8);

    pathScratch.world = world;
    world.fill(Number.NaN, size, size + 8);

    return world;
}
