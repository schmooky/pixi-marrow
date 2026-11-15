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

/** The first pixi.js 8 minor whose buffers upload at once, on WebGL too, when they are told that they changed. */
const AT_ONCE_MINOR = 23;

/**
 * Whether a WebGL buffer of a Pixi uploads at once when it is told that a stretch of it changed:
 * from pixi.js 8.23 on. Up to 8.22 a WebGL buffer waits until its geometry is bound, and keeps
 * the one stretch it was told last. A second stretch before that would replace the first. A
 * buffer of WebGPU writes at once in every pixi.js the package allows.
 *
 * @param version The version of Pixi, as its `VERSION` says.
 *
 * @example
 * const each = uploadsStretch(VERSION) || 'gpu' in renderer;
 */
export function uploadsStretch(version: string): boolean {
    const [major = 0, minor = 0] = version.split('.').map(Number);

    return major > 8 || (major === 8 && minor >= AT_ONCE_MINOR);
}

/**
 * The stretches of one buffer that changed since its last upload.
 *
 * @example
 * const pending = new PendingUpload();
 * pending.add(120, 40);
 * pending.flush(buffer, 4, used, true);
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
     * of the buffer. Returns the bytes it uploaded.
     *
     * @param itemBytes The bytes of one item.
     * @param each False where a buffer keeps one stretch until it is bound, see {@link uploadsStretch}:
     *   the upload is then one stretch from the first change to the last.
     */
    flush(buffer: Buffer, itemBytes: number, used: number, each: boolean): number {
        const { stretches } = this;
        const whole = used * itemBytes;
        let bytes = 0;

        if (!this.whole && this.count === 0) return 0;
        if (!each) this.span();
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
