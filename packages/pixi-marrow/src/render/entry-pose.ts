import { i16, i32 } from '../geometry/read';
import { computeRegionWorldVertices } from '../geometry/region';
import { computeWorldVertices, transformPoints } from '../geometry/vertices';
import type { PoseState } from '../pose/state';
import { writeDark, writeLight } from './colors';
import { u8 } from './read';
import type { Template } from './template';

/** The deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

/**
 * Writes the world positions of one entry of a template with the geometry kernel. An entry is a
 * mesh with its vertices, a quad with its corners, or the polygon of a region.
 *
 * @param bones The bone of each slot.
 *
 * @example
 * placeEntry(template, state, model.slots.bones, entry, template.slots[entry] ?? 0);
 */
export function placeEntry(template: Template, state: PoseState, bones: Int16Array, entry: number, slot: number): void {
    const source = template.sources[entry];
    const bone = i16(bones, slot);
    const at = i32(template.first, entry) * 2;
    const tight = i32(template.tightAt, entry);

    if (tight >= 0) {
        const end = at + i32(template.counts, entry) * 2;

        transformPoints(template.tightOffsets, tight, state.world, bone, template.positions, at, end, 2);
    } else if (source == null) {
        const offsets = i32(template.offsetAt, entry) + i32(template.frames, entry) * 8;

        computeRegionWorldVertices(template.offsets, offsets, state.world, bone, template.positions, at);
    } else {
        const deform = state.deform[slot] ?? NO_DEFORM;

        computeWorldVertices(source, state.world, bone, deform, i32(state.deformLengths, slot), template.positions, at);
    }
}

/**
 * Writes the colors of one entry when they differ from what its vertices hold. Returns whether
 * it wrote.
 *
 * @param hasDark Per slot: 1 when the slot has a dark color.
 *
 * @example
 * if (tintEntry(template, state, model.slots.hasDark, entry, slot)) colorBuffer.update();
 */
export function tintEntry(
    template: Template,
    state: PoseState,
    hasDark: Uint8Array,
    entry: number,
    slot: number,
): boolean {
    const light = writeLight(template, entry, state.colors, slot);

    if (!template.hasDark) return light;
    const dark = writeDark(template, entry, state.darkColors, slot, u8(hasDark, slot) === 1);

    return light || dark;
}
