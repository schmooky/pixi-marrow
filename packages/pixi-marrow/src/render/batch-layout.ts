import { i32 } from '../geometry/read';
import type { Template } from './template';

/*
 * Where a skeleton keeps its vertices inside a batch. The positions of a batch are uploaded whole
 * in every frame, so a batch holds what can be visible at once and no more: every slot has room
 * for the largest attachment it can show, and the attachment it shows now is written there. The
 * layout of the mesh mode gives every attachment a range of its own, which a batch would upload
 * too.
 *
 * The room of a slot does not depend on the cuts of overdraw. A region attachment has room for
 * its quad, also when it is laid out with fewer vertices or with none. So the vertex ranges can be
 * laid out again as quads while Pixi draws, without a change of size.
 */

/** 32-bit words per vertex in the position buffer of a batch: x, y. A pose rewrites them. */
export const POSITION_WORDS = 2;

/**
 * 32-bit words per vertex in the static buffer of a batch without dark colors: u, v, the light
 * color, the tint of the display object, the flags. With dark colors there is one more.
 */
export const STATIC_WORDS = 5;

/** Indices that every draw of a skeleton ends with: one triangle without area, so that no draw is empty. */
export const RUN_PAD = 3;

/**
 * The atlas pages one run of a skeleton samples: a group of 16 pages that follow each other.
 * `page >> PAGE_SHIFT` is the group of a page. A batch of Pixi samples 16 textures where the
 * GPU allows it, which WebGL2 and WebGPU both ask of a GPU. So an atlas of up to 16 pages never
 * splits a skeleton. A view that meets a renderer with a lower limit draws with meshes.
 */
export const PAGE_SHIFT = 4;
export const GROUP_PAGES = 16;

/** The vertices and the indices of the quad of a region attachment. */
const QUAD_VERTICES = 4;
const QUAD_INDICES = 6;

/** Where the slots of one template keep their vertices in a batch, and how much room the skeleton takes. */
export interface SlotLayout {
    /** Per slot, and one more: its first vertex, counted from the first vertex of the skeleton. */
    readonly at: Int32Array;
    /** The vertices of all slots: the largest attachment of each. */
    readonly vertices: number;
    /** The indices of all slots: the largest attachment of each. */
    readonly indices: number;
    /**
     * The vertices of all slots when every region attachment is its quad. The cuts of overdraw
     * do not change this number, so a rule can rest on it.
     */
    readonly plain: number;
}

/**
 * Gives every slot of a template room for the largest attachment it can show. A region
 * attachment counts as its quad at least.
 *
 * @example
 * const layout = layoutSlots(template, model.slots.count);
 * console.log(layout.vertices, layout.indices);
 */
export function layoutSlots(template: Template, slots: number): SlotLayout {
    const at = new Int32Array(slots + 1);
    let vertices = 0;
    let indices = 0;
    let plain = 0;

    for (let slot = 0; slot < slots; slot++) {
        const end = i32(template.slotEntries, slot + 1);
        let room = 0;
        let triangles = 0;
        let quads = 0;

        for (let entry = i32(template.slotEntries, slot); entry < end; entry++) {
            const region = template.sources[entry] == null;

            room = Math.max(room, i32(template.counts, entry), region ? QUAD_VERTICES : 0);
            triangles = Math.max(triangles, template.triangles[entry]?.length ?? 0, region ? QUAD_INDICES : 0);
            quads = Math.max(quads, region ? QUAD_VERTICES : i32(template.counts, entry));
        }
        at[slot] = vertices;
        vertices += room;
        indices += triangles;
        plain += quads;
    }
    at[slots] = vertices;

    return { at, vertices, indices, plain };
}

/**
 * Whether a layout has room for what another one asks: no slot needs more vertices, and the
 * skeleton needs no more indices. The data of the skeleton can then be written again into the
 * room it has.
 *
 * @example
 * if (!holdsLayout(room, layoutSlots(template, model.slots.count))) console.log('the batch must be built again');
 */
export function holdsLayout(room: SlotLayout, wanted: SlotLayout): boolean {
    const slots = wanted.at.length - 1;

    if (room.at.length !== wanted.at.length || wanted.indices > room.indices) return false;
    for (let slot = 0; slot < slots; slot++) {
        const needed = i32(wanted.at, slot + 1) - i32(wanted.at, slot);

        if (needed > i32(room.at, slot + 1) - i32(room.at, slot)) return false;
    }

    return true;
}
