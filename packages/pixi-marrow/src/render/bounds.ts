import type { Bounds } from 'pixi.js';
import { f32, i16, i32 } from '../geometry/read';
import { computeRegionWorldVertices } from '../geometry/region';
import type { Template } from './template';

/** The corners of the quad of an entry that is laid out as a polygon. 32-bit, as uploaded corners are. */
const corners = new Float32Array(8);

/** Grows a box by the points of an array: x, y pairs from `first` up to `end`. */
function addPoints(bounds: Bounds, points: Float32Array, first: number, end: number): void {
    for (let at = first; at < end; at += 2) {
        const x = f32(points, at);
        const y = f32(points, at + 1);

        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
    }
}

/**
 * Sets a box to the bounds of the visible entries of a template. A mesh and a quad add the
 * positions the template holds. An entry that is laid out as a polygon, or with no vertex at all,
 * adds the corners of its quad, computed from the pose. The box is therefore the same with and
 * without outlines, and the size of a skeleton does not change when its outlines arrive.
 *
 * @param world `PoseState.world` of the pose the positions were written for.
 * @param bones The bone of each slot.
 *
 * @example
 * measureEntries(bounds, template, visible, visibleCount, state.world, model.slots.bones);
 * console.log(bounds.width, bounds.height);
 */
export function measureEntries(
    bounds: Bounds,
    template: Template,
    visible: Int32Array,
    count: number,
    world: Float64Array,
    bones: Int16Array,
): void {
    bounds.clear();
    for (let i = 0; i < count; i++) {
        const entry = i32(visible, i);
        const first = i32(template.first, entry) * 2;

        if (i32(template.tightAt, entry) < 0 && template.hollow[entry] !== 1) {
            addPoints(bounds, template.positions, first, first + i32(template.counts, entry) * 2);
            continue;
        }
        // an entry with a polygon has one frame, so its quad is the first one
        computeRegionWorldVertices(
            template.offsets,
            i32(template.offsetAt, entry),
            world,
            i16(bones, i32(template.slots, entry)),
            corners,
        );
        addPoints(bounds, corners, 0, 8);
    }
}
