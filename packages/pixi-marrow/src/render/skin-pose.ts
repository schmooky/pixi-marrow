import type { BufferImageSource } from 'pixi.js';
import { f64, i16, i32 } from '../geometry/read';
import type { SkeletonModel } from '../model/model';
import { isNewer, type PoseState, WORLD_STRIDE } from '../pose/state';
import { placeEntry } from './entry-pose';
import { bonesMoved, colorEntry, frameEntry, type PosePass } from './pose-pass';
import { u8 } from './read';
import { dataRoom, dataTexture, type SkinLayout } from './skin-layout';
import type { Template } from './template';
import { NO_CLIP, type VisibleList } from './visible';

/*
 * The pose of one instance as the vertex shader of `skinning: 'gpu'` reads it: the world
 * transform of every bone and the colors of every slot, each in a data texture of its own.
 *
 * A pass over the visible entries follows the stamps of the pose, as `poseEntries` does:
 *
 * - A bone that is newer goes to the GPU: 6 numbers in 32 bits. The vertices that hang on it
 *   move in the vertex shader, and the CPU places none of them.
 * - A slot that is newer gets its colors written to its two texels of the palette, with the flag
 *   that says whether the CPU places its vertices. It does for a mesh with a deform and for an
 *   attachment the shader cannot place.
 * - The CPU places the vertices it is in charge of, when the slot or one of their bones is newer.
 *   Only those go to the GPU as positions.
 *
 * Code that reads the positions on the CPU, the bounds and the debug overlays, asks for them with
 * `settle`. The search for covered slots needs them for every pose, so a layout with an opaque
 * rectangle has all of its vertices placed on the CPU, and uploads only the ones the CPU is in
 * charge of.
 */

/** The flag of the palette for a slot whose vertices the CPU places. */
const BY_CPU = 255;

/**
 * The bone and palette textures of one view whose vertex shader places vertices, and the pass
 * that keeps them in line with a pose.
 *
 * @example
 * const skin = new SkinPose(model);
 * skin.pose(pass, template, layout, state, seen, template.opaqueCount > 0);
 * skin.settle(template, layout, state, seen);
 */
export class SkinPose {
    /** The world transform of each bone, 6 numbers a bone. See `skin-shader.ts`. */
    readonly bones: BufferImageSource;
    /** Two texels a slot: the light color, then the dark color and the flag of the CPU. */
    readonly palette: BufferImageSource;
    private readonly boneData: Float32Array;
    private readonly colors: Uint8Array;
    private readonly model: SkeletonModel;
    /** True when the positions of the vertices the shader places are older than the pose. */
    private stale = true;
    /** The slots of the palette the pass wrote: how many, the first and the last. */
    private painted = 0;
    private low = 0;
    private high = -1;

    constructor(model: SkeletonModel) {
        const boneTexels = Math.ceil((model.bones.count * WORLD_STRIDE) / 4);

        this.model = model;
        this.boneData = new Float32Array(dataRoom(boneTexels));
        this.bones = dataTexture(this.boneData, boneTexels, 'marrow-bones');
        this.colors = new Uint8Array(dataRoom(model.slots.count * 2));
        this.palette = dataTexture(this.colors, model.slots.count * 2, 'marrow-palette');
    }

    /** The bytes of the two textures. */
    get bytes(): number {
        return this.boneData.byteLength + this.colors.byteLength;
    }

    /**
     * Brings the textures and the positions the CPU is in charge of in line with a pose. The
     * pass says what changed, as after `poseEntries`: `placed` counts the entries whose
     * positions go to the GPU, `skinned` the bones.
     *
     * @param place Whether the CPU also places the vertices the shader places, for the search of covered slots.
     */
    pose(
        pass: PosePass,
        template: Template,
        layout: SkinLayout,
        state: PoseState,
        visible: VisibleList,
        place: boolean,
    ): void {
        const { list, count, clips } = visible;
        const { slotStamps, deformLengths } = state;
        const { seen, all } = pass;
        const { bones } = this.model.slots;
        let from = template.vertexCount;
        let to = 0;
        let placed = 0;

        clearColors(pass, from);
        this.painted = 0;
        this.low = this.model.slots.count;
        this.high = -1;
        pass.cut = false;
        for (let i = 0; i < count; i++) {
            const entry = i32(list, i);
            const slot = i32(template.slots, entry);
            const start = i32(template.first, entry);
            const newer = all || isNewer(Number(slotStamps[slot]), seen);
            const gpu = u8(layout.placeable, entry) === 1 && i32(deformLengths, slot) === 0;

            // a hollow entry has no vertex to place or to color
            if (i32(template.counts, entry) === 0) continue;
            if (newer) this.refresh(pass, template, state, entry, slot, gpu);
            if (gpu && !place) continue;
            if (!newer && !bonesMoved(state, template.weights[entry] ?? null, i16(bones, slot), seen)) continue;
            placeEntry(template, state, bones, entry, slot);
            // placed for the search of covered slots alone: the shader places it from the bones
            if (gpu) continue;
            placed++;
            from = Math.min(from, start);
            to = Math.max(to, start + i32(template.counts, entry));
            if (i16(clips, i) !== NO_CLIP) pass.cut = true;
        }
        pass.placed = placed;
        pass.from = from;
        pass.to = to;
        this.upload(pass, layout, state, place);
    }

    /**
     * Places the visible vertices that the shader places on the CPU too, for code that reads the
     * positions: the bounds and the debug overlays. Does nothing when they show the pose already.
     */
    settle(template: Template, layout: SkinLayout, state: PoseState, visible: VisibleList): void {
        const { bones } = this.model.slots;

        if (!this.stale) return;
        this.stale = false;
        for (let i = 0; i < visible.count; i++) {
            const entry = i32(visible.list, i);
            const slot = i32(template.slots, entry);

            if (i32(template.counts, entry) === 0 || u8(layout.placeable, entry) === 0) continue;
            if (i32(state.deformLengths, slot) === 0) placeEntry(template, state, bones, entry, slot);
        }
    }

    /** Frees the two textures. */
    destroy(): void {
        this.bones.destroy();
        this.palette.destroy();
    }

    /** Uploads the palette and the bones a pass changed, and notes them in the pass. */
    private upload(pass: PosePass, layout: SkinLayout, state: PoseState, place: boolean): void {
        // the palette is what goes to the GPU of the colors
        pass.colored = this.painted;
        pass.skinned = layout.count > 0 ? this.poseBones(state, pass.seen, pass.all) : 0;
        if (!place) this.stale = true;
        if (this.high >= 0) this.palette.update(this.low * 2, this.high * 2 + 2);
    }

    /** Writes the newer bones to their texture and uploads them. Returns how many there were. */
    private poseBones(state: PoseState, seen: number, all: boolean): number {
        const { boneStamps, world } = state;
        const data = this.boneData;
        const count = this.model.bones.count;
        let low = count;
        let high = -1;
        let moved = 0;

        for (let bone = 0; bone < count; bone++) {
            if (!all && !isNewer(Number(boneStamps[bone]), seen)) continue;
            const at = bone * WORLD_STRIDE;

            for (let k = at; k < at + WORLD_STRIDE; k++) data[k] = f64(world, k);
            low = Math.min(low, bone);
            high = bone;
            moved++;
        }
        // 6 numbers a bone are 1.5 texels: the stretch starts and ends at a whole texel
        if (moved > 0) this.bones.update(Math.floor((low * 3) / 2), Math.ceil(((high + 1) * 3) / 2));

        return moved;
    }

    /** Shows the frame of a newer slot, writes its colors and brings its texels of the palette in line. */
    private refresh(
        pass: PosePass,
        template: Template,
        state: PoseState,
        entry: number,
        slot: number,
        gpu: boolean,
    ): void {
        frameEntry(pass, template, state, entry, slot, undefined);
        colorEntry(pass, template, state, this.model.slots.hasDark, entry, slot, undefined);
        // a deform that starts or stops moves the vertices although no bone moved
        if (u8(this.colors, slot * 8 + 7) !== (gpu ? 0 : BY_CPU)) pass.reshaped = true;
        if (!this.paint(template, entry, slot, gpu)) return;
        this.painted++;
        this.low = Math.min(this.low, slot);
        this.high = Math.max(this.high, slot);
    }

    /**
     * Brings the two texels of a slot in line with the colors of the entry it shows, and with who
     * places its vertices. Returns whether a byte changed.
     */
    private paint(template: Template, entry: number, slot: number, gpu: boolean): boolean {
        const { colors } = this;
        const { light, dark } = template;
        const at = slot * 8;
        const t = entry * 4;
        const flag = gpu ? 0 : BY_CPU;
        let changed = u8(colors, at + 7) !== flag;

        for (let k = 0; k < 4; k++) changed ||= u8(colors, at + k) !== u8(light, t + k);
        for (let k = 0; k < 3; k++) changed ||= u8(colors, at + 4 + k) !== u8(dark, t + k);
        if (!changed) return false;
        for (let k = 0; k < 4; k++) colors[at + k] = u8(light, t + k);
        for (let k = 0; k < 3; k++) colors[at + 4 + k] = u8(dark, t + k);
        colors[at + 7] = flag;

        return true;
    }
}

/** Starts the notes of a pass about colors and texture coordinates, as `poseEntries` does. */
function clearColors(pass: PosePass, vertices: number): void {
    pass.colored = 0;
    pass.colorFrom = vertices;
    pass.colorTo = 0;
    pass.framed = 0;
    pass.regrouped = false;
    pass.recolored = false;
    pass.reshaped = false;
}
