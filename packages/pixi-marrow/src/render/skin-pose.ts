import { f64, i16, i32 } from '../geometry/read';
import type { SkeletonModel } from '../model/model';
import { isNewer, type PoseState, WORLD_STRIDE } from '../pose/state';
import { placeEntry } from './entry-pose';
import { bonesMoved, colorEntry, frameEntry, type PosePass } from './pose-pass';
import { u8 } from './read';
import type { SkinLayout } from './skin-layout';
import type { SkinStore } from './skin-store';
import type { Template } from './template';
import { NO_CLIP, type VisibleList } from './visible';

/*
 * The pose of one instance as the vertex shader of `skinning: 'gpu'` reads it: the world
 * transform of every bone and the colors of every slot, in the arrays of a store. A view that
 * draws alone has data textures of its own, one that draws instanced a slot of shared ones.
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
 * The pass that keeps the bones and the palette of one view whose vertex shader places vertices
 * in line with a pose. It writes into a store: see `skin-store.ts`.
 *
 * @example
 * const skin = new SkinPose(model, new TextureStore(model));
 * skin.pose(pass, template, layout, state, seen, template.opaqueCount > 0);
 * skin.settle(template, layout, state, seen);
 */
export class SkinPose {
    /** Where the bones and the colors go. A new store holds nothing of the pose: see {@link use}. */
    store: SkinStore;
    private readonly model: SkeletonModel;
    /** True when the positions of the vertices the shader places are older than the pose. */
    private stale = true;
    /** The slots of the palette the pass wrote: how many, the first and the last. */
    private painted = 0;
    private low = 0;
    private high = -1;

    constructor(model: SkeletonModel, store: SkinStore) {
        this.model = model;
        this.store = store;
    }

    /**
     * Writes from now on into another store. The next pass must write everything, with
     * `pass.all`: the store holds nothing of the pose. Its flags of the CPU read as unknown.
     */
    use(store: SkinStore): void {
        this.store = store;
        // a flag no pass writes: the next pass finds every slot changed
        for (let at = 7; at < store.colors.length; at += store.stride) store.colors[at] = 1;
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
            this.store.wrote?.(template, entry);
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

    /** Uploads the palette and the bones a pass changed, and notes them in the pass. */
    private upload(pass: PosePass, layout: SkinLayout, state: PoseState, place: boolean): void {
        // the palette is what goes to the GPU of the colors
        pass.colored = this.painted;
        pass.skinned = layout.count > 0 ? this.poseBones(state, pass.seen, pass.all) : 0;
        if (!place) this.stale = true;
        if (this.high >= 0) this.store.colorsWritten(this.low, this.high);
    }

    /** Writes the newer bones to their texture and uploads them. Returns how many there were. */
    private poseBones(state: PoseState, seen: number, all: boolean): number {
        const { boneStamps, world } = state;
        const data = this.store.bones;
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
        if (moved > 0) this.store.bonesWritten(low, high);

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
        if (u8(this.store.colors, slot * this.store.stride + 7) !== (gpu ? 0 : BY_CPU)) pass.reshaped = true;
        this.store.wrote?.(template, entry);
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
        const { colors, stride } = this.store;
        const { light, dark } = template;
        const at = slot * stride;
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
