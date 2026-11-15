import type { Buffer } from 'pixi.js';

/*
 * What a batch buffer has to upload before the next draw. Skeletons change their static vertex
 * data and their indices now and then, each a short stretch of a buffer that all skeletons of a
 * batcher share. Uploading the whole buffer for one stretch costs more than the stretch, and a
 * call per stretch costs more than the whole once many skeletons changed. So the stretches of a
 * frame are kept, and the cheaper of the two is done when the batch is about to draw.
 */

/** The most stretches that are kept. One more makes one stretch of all that are kept. */
const MAX_STRETCHES = 256;

/** What one more upload call costs, in bytes of a copy. A guess that errs on the side of fewer calls. */
const CALL_BYTES = 8192;

/**
 * The stretches of one buffer that changed since its last upload.
 *
 * @example
 * const pending = new PendingUpload();
 * pending.add(120, 40);
 * pending.flush(buffer, 4, used);
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
        // an upload of no bytes is one of the whole buffer to Pixi
        if (this.whole || size <= 0) return;
        if (this.count === MAX_STRETCHES) this.span();
        this.stretches[this.count * 2] = from;
        this.stretches[this.count++ * 2 + 1] = from + size;
    }

    /** Forgets what was noted: the buffer was uploaded by other means. */
    clear(): void {
        this.whole = false;
        this.count = 0;
    }

    /**
     * Uploads what changed, the cheaper way: the stretches one by one, or the first `used` items
     * of the buffer. Returns the bytes it uploaded. A buffer uploads at once when it is told that
     * a stretch changed, on WebGL and on WebGPU, so every stretch can go on its own.
     *
     * @param itemBytes The bytes of one item.
     */
    flush(buffer: Buffer, itemBytes: number, used: number): number {
        const { stretches } = this;
        const whole = used * itemBytes;
        let bytes = 0;

        if (!this.whole && this.count === 0) return 0;
        for (let i = 0; i < this.count; i++) {
            bytes += (Number(stretches[i * 2 + 1]) - Number(stretches[i * 2])) * itemBytes;
        }
        if (this.whole || bytes + this.count * CALL_BYTES >= whole) {
            bytes = whole;
            buffer.update(bytes);
        } else {
            for (let i = 0; i < this.count; i++) {
                const from = Number(stretches[i * 2]);

                buffer.update((Number(stretches[i * 2 + 1]) - from) * itemBytes, from * itemBytes);
            }
        }
        this.clear();

        return bytes;
    }

    /** Makes one stretch of all that are kept: from the first item that changed to the last. */
    private span(): void {
        const { stretches } = this;

        for (let i = 1; i < this.count; i++) {
            stretches[0] = Math.min(Number(stretches[0]), Number(stretches[i * 2]));
            stretches[1] = Math.max(Number(stretches[1]), Number(stretches[i * 2 + 1]));
        }
        this.count = Math.min(this.count, 1);
    }
}
