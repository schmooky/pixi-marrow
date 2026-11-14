import type { BufferImageSource } from 'pixi.js';
import { f32, i32 } from '../geometry/read';
import { WORLD_STRIDE } from '../pose/state';
import { u8 } from './read';
import { dataRoom, dataTexture } from './skin-layout';
import type { SkinStore } from './skin-store';
import { STATIC_STRIDE, type Template } from './template';

/*
 * The data textures that the instanced views of one layout share: a pool of slots, one per view.
 *
 * - The pose texture holds 32-bit floats. A slot has the bones of its view, 6 numbers a bone as
 *   in `skin-shader.ts`, then a texel for each vertex the CPU may place: x, y, u, v.
 * - The palette holds bytes. A slot has three texels for each slot of the skeleton: the light
 *   color, the dark color with the flag of the CPU, and the entry the slot shows with its page.
 *
 * A view writes into its slot and notes the stretch it wrote. A frame uploads each texture once,
 * with the stretch from the first texel written to the last. pixi.js before 8.23 uploads a
 * texture whole. A pool grows by doubling: it takes new arrays and textures, and the old textures
 * wait in {@link InstancePool.retired} until the layout has pointed its shaders at the new ones.
 */

/** The bytes of one slot of the skeleton in the palette of a pool: three texels. */
export const POOL_STRIDE = 12;

/** The entry a slot shows when it shows none. */
export const NO_ENTRY = 0xffff;

/** The most texels a data texture of a pool holds: 2048 rows of 2048, which WebGL2 allows at least. */
const MOST_TEXELS = 2048 * 2048;

/** The slots a pool has room for at first. */
const FIRST_ROOM = 4;

/** What a pool is made for: the bones and slots of the skeleton and the texels the CPU may fill. */
export interface PoolShape {
    readonly bones: number;
    readonly slots: number;
    /** Texels a slot keeps for the vertices the CPU places. */
    readonly cpuTexels: number;
    /** Per entry: its first texel among those, or -1. */
    readonly cpuAt: Int32Array;
}

let nextPool = 1;

/**
 * The shared textures of the instanced views of one layout, and its slots.
 *
 * @example
 * const pool = new InstancePool(shape);
 * const slot = pool.alloc();
 * skin.use(slot);
 * pool.flush();
 */
export class InstancePool {
    /** A number of its own, for the key of a shader. */
    readonly id: number = nextPool++;
    readonly shape: PoolShape;
    /** Texels of the bones of one slot. */
    readonly boneTexels: number;
    /** Texels of one slot in the pose texture and in the palette. */
    readonly poseStride: number;
    readonly paletteStride: number;
    pose: BufferImageSource;
    palette: BufferImageSource;
    poseData: Float32Array;
    paletteData: Uint8Array;
    /** Slots in use. */
    used = 0;
    /** Slots the pool has room for. */
    room = 0;
    private readonly slots: (PoolSlot | undefined)[] = [];
    private readonly free: number[] = [];
    /** The stretches written since the last upload, in texels, empty when the low end is past the high one. */
    private poseLow = Number.POSITIVE_INFINITY;
    private poseHigh = 0;
    private paletteLow = Number.POSITIVE_INFINITY;
    private paletteHigh = 0;
    /** Textures of the pool before it grew. The layout destroys them once no shader binds them. */
    readonly retired: BufferImageSource[] = [];

    constructor(shape: PoolShape) {
        this.shape = shape;
        this.boneTexels = Math.ceil((shape.bones * WORLD_STRIDE) / 4);
        this.poseStride = this.boneTexels + shape.cpuTexels;
        this.paletteStride = shape.slots * 3;
        this.poseData = new Float32Array(0);
        this.paletteData = new Uint8Array(0);
        [this.pose, this.palette] = this.textures(FIRST_ROOM);
    }

    /** The most slots a pool of this shape can have. */
    get limit(): number {
        return Math.floor(MOST_TEXELS / Math.max(this.poseStride, this.paletteStride, 1));
    }

    /** The bytes of the two arrays, which the textures hold once more on the GPU. */
    get bytes(): number {
        return this.poseData.byteLength + this.paletteData.byteLength;
    }

    /** The bytes of one slot in the two arrays. */
    get slotBytes(): number {
        return this.poseStride * 16 + this.paletteStride * 4;
    }

    /** A slot for one more view, or undefined when the pool is as large as it can be. */
    alloc(): PoolSlot | undefined {
        let index = this.free.pop();

        if (index === undefined) {
            if (this.used >= this.limit) return undefined;
            index = this.used;
            if (index >= this.room) this.grow(Math.min(this.room * 2, this.limit));
        }
        const slot = new PoolSlot(this, index);

        this.slots[index] = slot;
        this.used++;

        return slot;
    }

    /** Gives a slot back. Its texels keep what they hold until the next view takes it. */
    release(slot: PoolSlot): void {
        if (this.slots[slot.index] !== slot) return;
        this.slots[slot.index] = undefined;
        this.free.push(slot.index);
        this.used--;
    }

    /** Notes texels of the pose texture that were written, from `low` up to `high`, which is left out. */
    markPose(low: number, high: number): void {
        this.poseLow = Math.min(this.poseLow, low);
        this.poseHigh = Math.max(this.poseHigh, high);
    }

    /** Notes texels of the palette that were written, from `low` up to `high`, which is left out. */
    markPalette(low: number, high: number): void {
        this.paletteLow = Math.min(this.paletteLow, low);
        this.paletteHigh = Math.max(this.paletteHigh, high);
    }

    /** Uploads what was written since the last call: one stretch per texture. Returns the uploads. */
    flush(): number {
        let uploads = 0;

        if (this.poseLow < this.poseHigh) {
            this.pose.update(this.poseLow, this.poseHigh);
            uploads++;
        }
        if (this.paletteLow < this.paletteHigh) {
            this.palette.update(this.paletteLow, this.paletteHigh);
            uploads++;
        }
        this.poseLow = this.paletteLow = Number.POSITIVE_INFINITY;
        this.poseHigh = this.paletteHigh = 0;

        return uploads;
    }

    /** Frees the textures. No shader may bind them any more. */
    destroy(): void {
        for (const texture of this.retired) texture.destroy();
        this.retired.length = 0;
        this.pose.destroy();
        this.palette.destroy();
        this.slots.length = 0;
        this.free.length = 0;
    }

    /** Takes room for more slots: new arrays with the old data, and new textures on them. */
    private grow(room: number): void {
        const [pose, palette] = this.textures(room);

        this.retired.push(this.pose, this.palette);
        this.pose = pose;
        this.palette = palette;
        for (const slot of this.slots) slot?.map();
        // the new textures upload whole when they are first drawn
        this.poseLow = this.paletteLow = Number.POSITIVE_INFINITY;
        this.poseHigh = this.paletteHigh = 0;
    }

    /** Arrays and textures with room for a number of slots, holding what the old arrays hold. */
    private textures(room: number): [BufferImageSource, BufferImageSource] {
        const poseTexels = Math.max(1, room * this.poseStride);
        const paletteTexels = Math.max(1, room * this.paletteStride);
        const poseData = new Float32Array(dataRoom(poseTexels));
        const paletteData = new Uint8Array(dataRoom(paletteTexels));

        poseData.set(this.poseData);
        paletteData.set(this.paletteData);
        this.poseData = poseData;
        this.paletteData = paletteData;
        this.room = room;

        return [
            dataTexture(poseData, poseTexels, 'marrow-instance-pose'),
            dataTexture(paletteData, paletteTexels, 'marrow-instance-palette'),
        ];
    }
}

/**
 * The slot of one instanced view in a pool: where `SkinPose` writes its bones and colors, and
 * where the vertices the CPU places go for the shader. A view writes the entry each slot of the
 * skeleton shows with {@link show}.
 *
 * @example
 * const slot = pool.alloc();
 * skin.use(slot);
 * slot.show(template, seen.list, seen.count, cover.skipped);
 */
export class PoolSlot implements SkinStore {
    readonly pool: InstancePool;
    readonly index: number;
    readonly stride: number = POOL_STRIDE;
    bones: Float32Array = new Float32Array(0);
    colors: Uint8Array = new Uint8Array(0);
    /** x, y, u, v of every vertex the CPU may place, see {@link PoolShape.cpuAt}. */
    private cpu: Float32Array = new Float32Array(0);

    constructor(pool: InstancePool, index: number) {
        this.pool = pool;
        this.index = index;
        this.map();
    }

    /** The first texel of the slot in the pose texture: its bones. */
    get poseBase(): number {
        return this.index * this.pool.poseStride;
    }

    /** The first texel of the slot in the palette. */
    get paletteBase(): number {
        return this.index * this.pool.paletteStride;
    }

    /** The first texel of the vertices the CPU places. */
    get cpuBase(): number {
        return this.poseBase + this.pool.boneTexels;
    }

    /** Takes the views into the arrays of the pool, which are new ones after it grew. */
    map(): void {
        const { pool } = this;
        const pose = this.poseBase * 4;
        const palette = this.paletteBase * 4;

        this.bones = pool.poseData.subarray(pose, pose + pool.boneTexels * 4);
        this.cpu = pool.poseData.subarray(pose + pool.boneTexels * 4, pose + pool.poseStride * 4);
        this.colors = pool.paletteData.subarray(palette, palette + pool.paletteStride * 4);
    }

    bonesWritten(low: number, high: number): void {
        const base = this.poseBase;

        // 6 numbers a bone are 1.5 texels: the stretch starts and ends at a whole texel
        this.pool.markPose(base + Math.floor((low * 3) / 2), base + Math.ceil(((high + 1) * 3) / 2));
    }

    colorsWritten(low: number, high: number): void {
        const base = this.paletteBase;

        this.pool.markPalette(base + low * 3, base + high * 3 + 2);
    }

    /** Copies the positions and texture coordinates of an entry the CPU may place into its texels. */
    readonly wrote = (template: Template, entry: number): void => {
        const at = i32(this.pool.shape.cpuAt, entry);

        if (at < 0) return;
        const { positions, statics } = template;
        const { cpu } = this;
        const first = i32(template.first, entry);
        const count = i32(template.counts, entry);

        for (let v = 0; v < count; v++) {
            const out = (at + v) * 4;
            const vertex = first + v;

            cpu[out] = f32(positions, vertex * 2);
            cpu[out + 1] = f32(positions, vertex * 2 + 1);
            cpu[out + 2] = f32(statics, vertex * STATIC_STRIDE);
            cpu[out + 3] = f32(statics, vertex * STATIC_STRIDE + 1);
        }
        this.pool.markPose(this.cpuBase + at, this.cpuBase + at + count);
    };

    /**
     * Writes the entry every slot of the skeleton shows and its page: an entry of the visible
     * list that is not skipped as covered, else none.
     *
     * @param skipped Per visible entry: 1 when a later slot covers it.
     */
    show(template: Template, list: Int32Array, count: number, skipped: Uint8Array): void {
        const { colors } = this;
        const slots = this.pool.shape.slots;

        for (let slot = 0; slot < slots; slot++) {
            colors[slot * POOL_STRIDE + 8] = NO_ENTRY & 255;
            colors[slot * POOL_STRIDE + 9] = NO_ENTRY >> 8;
        }
        for (let i = 0; i < count; i++) {
            if (u8(skipped, i) === 1) continue;
            const entry = i32(list, i);
            const at = i32(template.slots, entry) * POOL_STRIDE;

            colors[at + 8] = entry & 255;
            colors[at + 9] = entry >> 8;
            // the page of the frame the entry shows: a sequence can show a region of another page
            colors[at + 10] = i32(template.pages, entry);
        }
        this.pool.markPalette(this.paletteBase, this.paletteBase + this.pool.paletteStride);
    }

    /** Writes the page an entry shows into the texel of its slot. */
    page(template: Template, entry: number): void {
        const at = i32(template.slots, entry) * POOL_STRIDE + 10;
        const page = i32(template.pages, entry);

        if (this.colors[at] === page) return;
        this.colors[at] = page;
        this.pool.markPalette(this.paletteBase + Math.floor(at / 4), this.paletteBase + Math.floor(at / 4) + 1);
    }

    /** Gives the slot back to its pool. */
    release(): void {
        this.pool.release(this);
    }
}
