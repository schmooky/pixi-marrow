import type { Container, Rectangle } from 'pixi.js';

/*
 * Where the skeletons of a scene stand, after the bench of the repository (scripts/bench/scene.js).
 * A frame is the box of a rig in skeleton units. Skeletons are drawn with y down, so the box of
 * the setup pose is read from an instance and used as it is.
 */

/** The share of a cell that the frame of a rig fills. */
const CELL_FILL = 0.9;

/** Where in its loop the skeleton with an index starts, as a share: no two start at the same pose. */
export const phase = (index: number): number => (index * 0.618034) % 1;

/** Puts an object into a cell: its frame centred and scaled to fill most of the cell. */
export function fitCell(
    object: Container,
    frame: Rectangle,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const scale = Math.min(width / frame.width, height / frame.height) * CELL_FILL;

    object.scale.set(scale);
    object.position.set(
        x + width / 2 - (frame.x + frame.width / 2) * scale,
        y + height / 2 - (frame.y + frame.height / 2) * scale,
    );
}

/**
 * Puts objects on a grid over the canvas, as many columns as keep the cells about square.
 *
 * @param frameOf The frame of the rig of an object, by its index.
 */
export function placeGrid(
    objects: readonly Container[],
    frameOf: (index: number) => Rectangle,
    width: number,
    height: number,
): void {
    const columns = Math.max(1, Math.ceil(Math.sqrt((objects.length * width) / height)));
    const rows = Math.ceil(objects.length / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;

    for (const [index, object] of objects.entries()) {
        const x = (index % columns) * cellWidth;
        const y = Math.floor(index / columns) * cellHeight;

        fitCell(object, frameOf(index), x, y, cellWidth, cellHeight);
    }
}

/**
 * Puts every object over the whole canvas: its frame covers it, and the objects lie on top of
 * each other a few pixels apart. The GPU then fills the canvas once per object and layer.
 */
export function placeCover(objects: readonly Container[], frame: Rectangle, width: number, height: number): void {
    const scale = Math.max(width / frame.width, height / frame.height);

    for (const [index, object] of objects.entries()) {
        const shiftX = ((index % 5) - 2) * 6;
        const shiftY = ((Math.floor(index / 5) % 5) - 2) * 6;

        object.scale.set(scale);
        object.position.set(
            width / 2 + shiftX - (frame.x + frame.width / 2) * scale,
            height / 2 + shiftY - (frame.y + frame.height / 2) * scale,
        );
    }
}
