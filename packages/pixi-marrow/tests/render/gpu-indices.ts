import { Buffer, type Mesh } from 'pixi.js';

/*
 * A model of what the GPU holds of the buffers a test uploads. Tests run without a GPU, so an
 * index that stays on the GPU past the ones a mesh draws shows in no picture here. This model
 * follows every upload a buffer is told to make. Pixi uploads at once, on WebGL and on WebGPU.
 */

/** The copy of one buffer on the GPU. */
interface Held {
    gpu: Uint32Array;
    /** Items the uploads have moved so far. */
    moved: number;
}

/** What {@link watchGpu} hands out. */
export interface GpuModel {
    /** How many items of a buffer are other than zero on the GPU, from an item on. */
    past(buffer: Buffer, from: number): number;
    /** Items all uploads of a buffer have moved so far. */
    moved(buffer: Buffer): number;
    /** Gives Pixi its own `update` and `data` back. */
    stop(): void;
}

const itemsOf = (buffer: Buffer): ArrayLike<number> => buffer.data as unknown as ArrayLike<number>;

/**
 * Follows the uploads of every buffer from now on. A buffer is first seen when it uploads, and
 * the GPU is taken to hold zeros for it then, as it does for a buffer that was created with an
 * array of zeros.
 */
export function watchGpu(): GpuModel {
    const held = new Map<Buffer, Held>();
    const update = Buffer.prototype.update;
    const data = Object.getOwnPropertyDescriptor(Buffer.prototype, 'data');
    const of = (buffer: Buffer): Held => {
        let entry = held.get(buffer);

        if (entry === undefined) {
            entry = { gpu: new Uint32Array(itemsOf(buffer).length), moved: 0 };
            held.set(buffer, entry);
        }

        return entry;
    };
    const upload = (buffer: Buffer, entry: Held, items: number): void => {
        const source = itemsOf(buffer);

        // a GPU buffer grows for a longer array, and keeps its size for a shorter one
        if (source.length > entry.gpu.length) {
            const grown = new Uint32Array(source.length);

            grown.set(entry.gpu);
            entry.gpu = grown;
        }
        for (let i = 0; i < items; i++) entry.gpu[i] = Number(source[i]);
        entry.moved += items;
    };
    const tell = (buffer: Buffer, items: number): void => upload(buffer, of(buffer), items);

    Buffer.prototype.update = function watched(this: Buffer, size?: number, offset?: number): void {
        const source = itemsOf(this);
        const bytes = Reflect.get(source, 'BYTES_PER_ELEMENT') as number;

        tell(this, size === undefined ? source.length : size / bytes);
        update.call(this, size, offset);
    };
    Object.defineProperty(Buffer.prototype, 'data', {
        ...data,
        set(this: Buffer, value: Buffer['data']) {
            const before = this.data;

            data?.set?.call(this, value);
            // Pixi uploads an array the buffer did not hold, whole
            if (before !== value) tell(this, itemsOf(this).length);
        },
    });

    return {
        past(buffer: Buffer, from: number): number {
            const { gpu } = of(buffer);
            let count = 0;

            for (let i = from; i < gpu.length; i++) if (gpu[i] !== 0) count++;

            return count;
        },
        moved: (buffer: Buffer): number => of(buffer).moved,
        stop(): void {
            Buffer.prototype.update = update;
            if (data !== undefined) Object.defineProperty(Buffer.prototype, 'data', data);
        },
    };
}

/**
 * Counts the indices that the buffers of meshes hold on the GPU past the ones each mesh draws.
 *
 * @example
 * expect(drawAndCount(gpu, meshes(rig.view))).toBe(0);
 */
export function drawAndCount(gpu: GpuModel, drawn: readonly Mesh[]): number {
    let stale = 0;

    for (const mesh of drawn) {
        const { indexBuffer, indexCount } = mesh.geometry;

        stale += gpu.past(indexBuffer, indexCount);
    }

    return stale;
}
