import type { Buffer } from 'pixi.js';

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

/**
 * Uploads the items of a buffer from `from` up to `to`, or the whole buffer where Pixi cannot
 * upload a stretch on its own. Does nothing for an empty stretch. Returns the bytes it uploaded.
 *
 * @param ranged What `uploadsStretch` says about this Pixi.
 * @param itemBytes The bytes of one item.
 *
 * @example
 * uploadStretch(positions, ranged, pass.from, pass.to, 8);
 */
export function uploadStretch(buffer: Buffer, ranged: boolean, from: number, to: number, itemBytes: number): number {
    if (to <= from) return 0;
    if (ranged) buffer.update((to - from) * itemBytes, from * itemBytes);
    else buffer.update();

    return ranged ? (to - from) * itemBytes : buffer.data.byteLength;
}
