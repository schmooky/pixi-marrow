import type { Buffer } from 'pixi.js';

/*
 * What a batch buffer has to upload before the next draw. Skeletons change their static vertex
 * data and their indices now and then, each a short stretch of a buffer that all skeletons of a
 * batcher share. Uploading the whole buffer for one stretch costs more than the stretch, and a
 * call per stretch costs more than the whole once many skeletons changed. So the stretches of a
 * frame are kept, and the cheaper of the two is done when the batch is about to draw.
 */

/** The most stretches that are kept. One more makes the upload whole. */
const MAX_STRETCHES = 32;

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
 * const pending = new PendingUpload(uploadsStretch(Buffer.prototype.update, VERSION));
 * pending.add(120, 40);
 * pending.flush(buffer, 4, used);
 */
export class PendingUpload {
    /** True when the whole buffer must upload. */
    whole = false;
    /** How many stretches are kept. */
    count = 0;
    /** Per stretch: its first item and how many items it has. */
    private readonly stretches = new Int32Array(MAX_STRETCHES * 2);
    private readonly ranged: boolean;

    /** @param ranged Whether Pixi can upload a stretch that does not start at the beginning of a buffer. */
    constructor(ranged: boolean) {
        this.ranged = ranged;
    }

    /** Notes that `size` items from item `from` on changed. */
    add(from: number, size: number): void {
        // an upload of no bytes is one of the whole buffer to Pixi
        if (this.whole || size <= 0) return;
        if (!this.ranged || this.count === MAX_STRETCHES) {
            this.whole = true;

            return;
        }
        this.stretches[this.count * 2] = from;
        this.stretches[this.count * 2 + 1] = size;
        this.count++;
    }

    /** Forgets what was noted: the buffer was uploaded by other means. */
    clear(): void {
        this.whole = false;
        this.count = 0;
    }

    /**
     * Uploads what changed: the stretches one by one, or the first `used` items of the buffer
     * when that is less work. Returns the bytes it uploaded.
     *
     * @param itemBytes The bytes of one item.
     */
    flush(buffer: Buffer, itemBytes: number, used: number): number {
        const { stretches, count } = this;
        let bytes = 0;

        if (!this.whole && count === 0) return 0;
        for (let i = 0; i < count; i++) bytes += Number(stretches[i * 2 + 1]) * itemBytes;
        if (this.whole || bytes + count * CALL_BYTES >= used * itemBytes) {
            bytes = used * itemBytes;
            buffer.update(bytes);
        } else {
            for (let i = 0; i < count; i++) {
                buffer.update(Number(stretches[i * 2 + 1]) * itemBytes, Number(stretches[i * 2]) * itemBytes);
            }
        }
        this.clear();

        return bytes;
    }
}
