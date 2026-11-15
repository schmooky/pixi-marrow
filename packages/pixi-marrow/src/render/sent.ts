import type { Buffer, Renderer } from 'pixi.js';
import { i32 } from '../geometry/read';

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
 * Uploads the stretch of a vertex buffer that waits, and notes that nothing waits. The stretch
 * is two whole numbers at `at` in `waiting`: its first vertex and the one behind its last. An
 * empty stretch uploads nothing. Returns the bytes it uploaded.
 *
 * @param itemBytes The bytes of one vertex in the buffer.
 * @param push A renderer whose buffers keep a stretch until they are bound, which uploads it
 * now, or null. That is WebGL before pixi.js 8.23, see `uploadsStretch`.
 *
 * @example
 * stats.uploadBytes.positions += uploadWaiting(positions, waiting, 0, 8, null);
 */
export function uploadWaiting(
    buffer: Buffer,
    waiting: Int32Array,
    at: number,
    itemBytes: number,
    push: Renderer | null,
): number {
    const from = i32(waiting, at);
    const bytes = (i32(waiting, at + 1) - from) * itemBytes;

    if (bytes <= 0) return 0;
    waiting[at] = 0;
    waiting[at + 1] = 0;
    buffer.update(bytes, from * itemBytes);
    // a renderer without a GPU has no buffer to upload
    if (push !== null && 'buffer' in push) push.buffer.updateBuffer(buffer);

    return bytes;
}
