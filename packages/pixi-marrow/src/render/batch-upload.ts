import type { Buffer } from 'pixi.js';

/*
 * What a batch buffer has to upload before the next draw. Skeletons change their static vertex
 * data and their indices now and then, each a short stretch of a buffer that all skeletons of a
 * batcher share. Uploading the whole buffer for one stretch costs more than the stretch, and a
 * call per stretch costs more than the whole once many skeletons changed. So the stretches of a
 * frame are kept, and the cheaper of the two is done when the batch is about to draw. Stretches
 * that lie near each other upload as one.
 */

/** The most stretches that are kept. One more joins the ones that lie near each other. */
const MAX_STRETCHES = 256;

/** What one more upload call costs, in bytes of a copy. A guess that errs on the side of fewer calls. */
const CALL_BYTES = 8192;

/** The first pixi.js 8 minor whose buffers upload at once, on WebGL too, when they are told that they changed. */
const AT_ONCE_MINOR = 23;

/**
 * Whether a Pixi can upload the stretches of a buffer one by one. Two things are needed, and
 * pixi.js has both from 8.23 on:
 *
 * - `Buffer.update` takes an offset. pixi.js 8.16 to 8.19 has none: every change uploads the
 *   buffer from its start.
 * - A buffer uploads at once when it is told that it changed. Up to 8.22 a WebGL buffer waits
 *   until its geometry is bound, and keeps the one stretch it was told last. A second stretch
 *   before that would replace the first.
 *
 * @param version The version of Pixi, as its `VERSION` says.
 *
 * @example
 * const pending = new PendingUpload(uploadsStretch(Buffer.prototype.update, VERSION));
 */
export function uploadsStretch(update: Buffer['update'], version: string): boolean {
    const [major = 0, minor = 0] = version.split('.').map(Number);

    return update.length > 1 && (major > 8 || (major === 8 && minor >= AT_ONCE_MINOR));
}

/**
 * How a batch buffer uploads what changed. `each` uploads every stretch on its own. `span` uploads
 * one stretch from the first change to the last. `whole` uploads the used part of the buffer.
 */
export type UploadMode = 'whole' | 'span' | 'each';

/**
 * How the buffers of a batch upload with this Pixi and this kind of renderer.
 *
 * - WebGPU writes a stretch at once when a buffer is told about it, from pixi.js 8.21 on: `each`.
 * - WebGL does so from pixi.js 8.23 on: `each`.
 * - An older WebGL buffer keeps one stretch until its geometry is bound: `span`.
 *
 * @param webgpu Whether the renderer is one of WebGPU.
 *
 * @example
 * const mode = uploadMode(Buffer.prototype.update, VERSION, 'gpu' in renderer);
 */
export function uploadMode(update: Buffer['update'], version: string, webgpu: boolean): UploadMode {
    if (update.length < 2) return 'whole';

    return webgpu || uploadsStretch(update, version) ? 'each' : 'span';
}

/**
 * Uploads the items of a buffer from `from` up to `to`, or the whole buffer where Pixi cannot
 * upload a stretch on its own. Does nothing for an empty stretch.
 *
 * @param ranged What {@link uploadsStretch} says about this Pixi.
 * @param itemBytes The bytes of one item.
 *
 * @example
 * uploadStretch(positions, ranged, pass.from, pass.to, 8);
 */
export function uploadStretch(buffer: Buffer, ranged: boolean, from: number, to: number, itemBytes: number): void {
    if (to <= from) return;
    if (ranged) buffer.update((to - from) * itemBytes, from * itemBytes);
    else buffer.update();
}

/**
 * The stretches of one buffer that changed since its last upload.
 *
 * @example
 * const pending = new PendingUpload();
 * pending.add(120, 40);
 * pending.flush(buffer, 4, used, 'each');
 */
export class PendingUpload {
    /** True when the whole buffer must upload. */
    whole = false;
    /** How many stretches are kept. */
    count = 0;
    /** Per stretch: its first item and the item behind its last. */
    private readonly stretches = new Int32Array(MAX_STRETCHES * 2);

    /** Notes that `size` items from item `from` on changed. */
    add(from: number, size: number): void {
        const { stretches } = this;
        const end = from + size;
        let at = this.count * 2;

        // an upload of no bytes is one of the whole buffer to Pixi
        if (this.whole || size <= 0) return;
        // skeletons write in the order of the buffer, so a stretch often goes on where the one before ended
        if (at > 0 && from <= Number(stretches[at - 1]) && end >= Number(stretches[at - 2])) {
            stretches[at - 2] = Math.min(from, Number(stretches[at - 2]));
            stretches[at - 1] = Math.max(end, Number(stretches[at - 1]));

            return;
        }
        if (this.count === MAX_STRETCHES) {
            // no room: stretches join in pairs, the nearest ones first, until half of the room is free
            for (let gap = 1024; this.count > MAX_STRETCHES / 2; gap *= 2) this.join(gap, true);
            at = this.count * 2;
        }
        stretches[at] = from;
        stretches[at + 1] = end;
        this.count++;
    }

    /** Forgets what was noted: the buffer was uploaded by other means. */
    clear(): void {
        this.whole = false;
        this.count = 0;
    }

    /**
     * Uploads what changed, the cheapest way the mode allows: the stretches one by one, one
     * stretch around all of them, or the first `used` items. Returns the bytes it uploaded.
     *
     * @param itemBytes The bytes of one item.
     */
    flush(buffer: Buffer, itemBytes: number, used: number, mode: UploadMode): number {
        const { stretches } = this;
        const bytes = used * itemBytes;

        if (!this.whole && this.count === 0) return 0;
        if (!this.whole && mode !== 'whole') {
            // a gap that is cheaper to upload than one more call is uploaded
            this.join(mode === 'span' ? used : CALL_BYTES / itemBytes, false);
            const { count } = this;
            let sum = 0;

            for (let i = 0; i < count; i++) sum += Number(stretches[i * 2 + 1]) - Number(stretches[i * 2]);
            sum *= itemBytes;
            if (count === 1 || sum + count * CALL_BYTES < bytes) {
                for (let i = 0; i < count; i++) {
                    const from = Number(stretches[i * 2]);

                    buffer.update((Number(stretches[i * 2 + 1]) - from) * itemBytes, from * itemBytes);
                }
                this.clear();

                return sum;
            }
        }
        buffer.update(bytes);
        this.clear();

        return bytes;
    }

    /**
     * Sorts the stretches, and makes one of every two that overlap or have up to `gap` items
     * between them. With `pairs` a stretch that was made of two takes no third.
     */
    private join(gap: number, pairs: boolean): void {
        const { stretches, count } = this;
        let last = 0;
        let single = true;

        for (let i = 1; i < count; i++) {
            const from = Number(stretches[i * 2]);
            const end = Number(stretches[i * 2 + 1]);
            let at = i * 2;

            for (; at > 0 && Number(stretches[at - 2]) > from; at -= 2) {
                stretches[at] = Number(stretches[at - 2]);
                stretches[at + 1] = Number(stretches[at - 1]);
            }
            stretches[at] = from;
            stretches[at + 1] = end;
        }
        for (let i = 1; i < count; i++) {
            const from = Number(stretches[i * 2]);
            const end = Number(stretches[i * 2 + 1]);

            if (from <= Number(stretches[last * 2 + 1]) + gap && (single || !pairs)) {
                stretches[last * 2 + 1] = Math.max(end, Number(stretches[last * 2 + 1]));
                single = false;
            } else {
                single = true;
                last++;
                stretches[last * 2] = from;
                stretches[last * 2 + 1] = end;
            }
        }
        if (count > 0) this.count = last + 1;
    }
}
