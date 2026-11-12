/*
 * Browser part of scripts/bench/ab.mjs: the instances of a block and where they are on the canvas.
 */

/** The share of a grid cell the frame of a rig fills. */
const CELL_FILL = 0.9;

/** Puts the objects on a grid over the canvas. The frame of the rig fills most of a cell. */
export function layoutGrid(objects, [x, y, frameWidth, frameHeight], width, height) {
    const columns = Math.ceil(Math.sqrt((objects.length * width) / height));
    const rows = Math.ceil(objects.length / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    const scale = Math.min(cellWidth / frameWidth, cellHeight / frameHeight) * CELL_FILL;

    for (const [index, object] of objects.entries()) {
        const centerX = ((index % columns) + 0.5) * cellWidth;
        const centerY = (Math.floor(index / columns) + 0.5) * cellHeight;

        object.scale.set(scale);
        // skeletons are drawn with y down, so the top of the frame is at -(y + height)
        object.position.set(centerX - (x + frameWidth / 2) * scale, centerY + (y + frameHeight / 2) * scale);
    }

    return scale;
}

/**
 * Puts every object over the whole canvas: the frame of the rig covers it, and the objects lie
 * on top of each other, a few pixels apart. The GPU then fills the canvas once per object and
 * layer.
 */
export function layoutCover(objects, [x, y, frameWidth, frameHeight], width, height) {
    const scale = Math.max(width / frameWidth, height / frameHeight);

    for (const [index, object] of objects.entries()) {
        const shiftX = ((index % 5) - 2) * 6;
        const shiftY = ((Math.floor(index / 5) % 5) - 2) * 6;

        object.scale.set(scale);
        object.position.set(
            width / 2 + shiftX - (x + frameWidth / 2) * scale,
            height / 2 + shiftY + (y + frameHeight / 2) * scale,
        );
    }

    return scale;
}

/** Creates instances of one side, puts them on the stage and plays the animation of the plan on each. */
export function populate(env, side, create, count, options) {
    const [sequence] = env.plan.sequences;
    const objects = [];

    for (let i = 0; i < count; i++) {
        const object = create(options);

        objects.push(object);
        env.stage.addChild(object);
        if (sequence.skin) side.setSkin(object, sequence.skin);
        side.play(object, sequence.animation);
        // every instance at another place of the loop, so no two of them hold the same pose
        object.update(((i * 0.618034) % 1) * sequence.duration);
    }

    return objects;
}
