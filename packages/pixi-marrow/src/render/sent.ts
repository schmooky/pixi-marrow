/*
 * Bytes the mesh mode handed to the GPU where no view is at hand: the index buffers of the draw
 * ranges and the buffers of the clip masks. The numbers only grow. The paint of a view reads
 * them before and after its own work, and counts the difference in the stats of its view.
 */

/**
 * The bytes of index buffers and of clip masks that the mesh mode uploaded so far, for all views.
 *
 * @example
 * const before = sent.indices;
 * ranges.build(template, seen.list, seen.clips, skipped, seen.count, seen);
 * stats.uploadBytes.indices += sent.indices - before;
 */
export const sent = { indices: 0, masks: 0 };
