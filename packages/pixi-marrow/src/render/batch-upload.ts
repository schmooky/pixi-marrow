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

/**
 * Whether this Pixi can upload a stretch of a buffer that does not start at its beginning: its
 * `Buffer.update` takes an offset, which pixi.js 8.16 does not. Without it every change uploads
 * the buffer from its start.
 *
 * @example
 * const pending = new PendingUpload(uploadsStretch(Buffer.prototype.update));
 */
export const uploadsStretch = (update: Buffer['update']): boolean => update.length > 1;

/**
 * The stretches of one buffer that changed since its last upload.
 *
 * @example
 * const pending = new PendingUpload(true);
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
