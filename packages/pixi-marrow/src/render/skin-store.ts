import { type BufferImageSource, VERSION } from 'pixi.js';
import type { SkeletonModel } from '../model/model';
import { WORLD_STRIDE } from '../pose/state';
import { dataRoom, dataTexture, uploadTexels } from './skin-layout';
import type { Template } from './template';

/*
 * Where the pose of one view goes for the vertex shader of `skinning: 'gpu'`. A view that draws
 * alone keeps it in two data textures of its own, see `TextureStore`. A view that draws instanced
 * keeps it in a slot of the textures its instances share, see `instance-pool.ts`. `SkinPose`
 * writes into either one the same way and says what it wrote.
 */

/** The bytes of one slot in the palette of a view that draws alone: the light color, then the dark color and the flag. */
const PALETTE_STRIDE = 8;

/** Whether a data texture of this Pixi uploads a range of its texels, see `uploadTexels`: from pixi.js 8.23 on. */
const RANGED = Number(VERSION.split('.')[1]) > 22 || !VERSION.startsWith('8.');

/** The arrays a `SkinPose` writes, and what it tells about what it wrote. */
export interface SkinStore {
    /** The world transform of each bone, 6 numbers a bone packed tight. See `skin-shader.ts`. */
    readonly bones: Float32Array;
    /** Per slot {@link stride} bytes: the light color, then the dark color and the flag of the CPU. */
    readonly colors: Uint8Array;
    /** The bytes of one slot in {@link colors}. A store may keep more of a slot after the first 8. */
    readonly stride: number;
    /** The bones from `low` to `high` were written. */
    bonesWritten(low: number, high: number): void;
    /** The slots from `low` to `high` were written. */
    colorsWritten(low: number, high: number): void;
    /**
     * The vertices or the texture coordinates of an entry were written into the template. A store
     * that keeps them for the shader copies them. Null for a store that does not.
     */
    readonly wrote: ((template: Template, entry: number) => void) | null;
}

/**
 * The bone and palette textures of one view that draws alone. A write notes the stretch it
 * names, and {@link flush} uploads what was noted, once per frame and only for a view that Pixi
 * draws.
 *
 * @example
 * const store = new TextureStore(model);
 * const shader = createSkinShader(pages, dark, { bones: store.boneTexture, influences, palette: store.palette });
 */
export class TextureStore implements SkinStore {
    readonly bones: Float32Array;
    readonly colors: Uint8Array;
    readonly stride: number = PALETTE_STRIDE;
    readonly wrote: null = null;
    /** The bones as the shader reads them. */
    readonly boneTexture: BufferImageSource;
    /** Two texels a slot. */
    readonly palette: BufferImageSource;
    /** The texels of each texture that wait for {@link flush}: the first one and the one behind the last. */
    private boneLow = 0;
    private boneHigh = 0;
    private colorLow = 0;
    private colorHigh = 0;

    constructor(model: SkeletonModel) {
        const boneTexels = Math.ceil((model.bones.count * WORLD_STRIDE) / 4);
        const slots = model.slots.count;

        this.bones = new Float32Array(dataRoom(boneTexels));
        this.boneTexture = dataTexture(this.bones, boneTexels, 'marrow-bones');
        this.colors = new Uint8Array(dataRoom(slots * 2));
        this.palette = dataTexture(this.colors, slots * 2, 'marrow-palette');
    }

    /** The bytes of the two textures. */
    get bytes(): number {
        return this.bones.byteLength + this.colors.byteLength;
    }

    bonesWritten(low: number, high: number): void {
        // 6 numbers a bone are 1.5 texels: the stretch starts and ends at a whole texel
        this.boneLow = Math.min(this.boneLow, Math.floor((low * 3) / 2));
        this.boneHigh = Math.max(this.boneHigh, Math.ceil(((high + 1) * 3) / 2));
    }

    colorsWritten(low: number, high: number): void {
        this.colorLow = Math.min(this.colorLow, low * 2);
        this.colorHigh = Math.max(this.colorHigh, high * 2 + 2);
    }

    /**
     * Uploads the texels that were written since the last call: one stretch per texture. The
     * paint of the view calls it before Pixi draws the view. Returns the bytes it uploaded.
     */
    flush(): number {
        let bytes = 0;

        if (this.boneHigh > 0) {
            uploadTexels(this.boneTexture, this.boneLow, this.boneHigh);
            bytes += RANGED ? (this.boneHigh - this.boneLow) * 16 : this.bones.byteLength;
            this.boneLow = this.bones.length;
            this.boneHigh = 0;
        }
        if (this.colorHigh > 0) {
            uploadTexels(this.palette, this.colorLow, this.colorHigh);
            bytes += RANGED ? (this.colorHigh - this.colorLow) * 4 : this.colors.byteLength;
            this.colorLow = this.colors.length;
            this.colorHigh = 0;
        }

        return bytes;
    }

    /** Frees the two textures. */
    destroy(): void {
        this.boneTexture.destroy();
        this.palette.destroy();
    }
}
