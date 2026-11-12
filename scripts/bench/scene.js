/*
 * Browser part of scripts/bench/ab.mjs: the scenes of the A/B mode. A scene says what the
 * instances of a block do while their frames are timed, and where they are on the canvas.
 *
 *   play     every instance plays one animation in a loop, each at another place of the loop
 *   little   the same with an animation that moves few bones while the rest stands still. The
 *            Node side names the animation, so the page plays it like any other
 *   rest     every instance played an animation that does not loop and stands past its end
 *   setup    nothing was ever played: every instance shows its setup pose
 *   moved    the instances rest as in `rest` while their parent container moves in every frame,
 *            so that transforms change and poses do not
 *   mixed    what a slot game looks like: some instances of each of a few small rigs. All rest,
 *            and one after the other plays a short animation once
 */

/** The share of a grid cell the frame of a rig fills. */
const CELL_FILL = 0.9;
/** Seconds an instance of a scene at rest is past the end of its animation, at least. */
const PAST_END = 0.25;
/** Frames between two starts of an animation in the scene `mixed`. */
export const MIXED_START_EVERY = 12;

/**
 * Puts the objects on a grid over the canvas. The frame of the rig fills most of a cell.
 *
 * @param frameOf The frame of the rig of an object, by its index: x, y, width and height in
 * skeleton units.
 * @returns The scale of the first object.
 */
export function layoutGrid(objects, frameOf, width, height) {
    const columns = Math.ceil(Math.sqrt((objects.length * width) / height));
    const rows = Math.ceil(objects.length / columns);
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    let first = 1;

    for (const [index, object] of objects.entries()) {
        const [x, y, frameWidth, frameHeight] = frameOf(index);
        const scale = Math.min(cellWidth / frameWidth, cellHeight / frameHeight) * CELL_FILL;
        const centerX = ((index % columns) + 0.5) * cellWidth;
        const centerY = (Math.floor(index / columns) + 0.5) * cellHeight;

        if (index === 0) first = scale;
        object.scale.set(scale);
        // skeletons are drawn with y down, so the top of the frame is at -(y + height)
        object.position.set(centerX - (x + frameWidth / 2) * scale, centerY + (y + frameHeight / 2) * scale);
    }

    return first;
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

/** Where in its loop the instance with an index starts, as a share: no two start at the same pose. */
const phase = (index) => (index * 0.618034) % 1;

/**
 * Creates the instances of a block and starts what its scene has them do.
 *
 * @param job.scene The name of the scene, see the head of this file. Default `play`.
 * @param job.runtime `ours` or `official`, `job.instances` how many display objects there are
 * and `job.options` the options of a display object of ours.
 * @returns `objects` are the display objects, `scale` the scale of the first one, and `tick` is
 * what the scene does before the update of every frame, or null. `dispose` takes the scene off
 * the stage.
 */
export function buildScene(env, job) {
    const { renderer, stage, loaded } = env;
    const scene = job.scene ?? 'play';
    const side = env.sides[job.runtime];
    // the scene `moved` moves the parent of its instances. Every other scene puts them on the stage
    const parent = scene === 'moved' ? stage.addChild(new env.PIXI.Container()) : stage;
    const objects = [];
    const rigs = [];
    // the rig of an instance: the scene `mixed` takes the loaded rigs in turns, the others have one
    const rigOf = (index) => (scene === 'mixed' ? loaded[index % loaded.length] : loaded[0]);
    let frame = 0;
    let tick = null;

    for (let i = 0; i < job.instances; i++) {
        const rig = rigOf(i);
        const [sequence] = rig.plan.sequences;
        const object = rig.factories[job.runtime](job.options);

        objects.push(object);
        rigs.push(rig);
        parent.addChild(object);
        if (sequence.skin) side.setSkin(object, sequence.skin);
        if (scene === 'play' || scene === 'little') {
            side.play(object, sequence.animation, true);
            // every instance at another place of the loop, so no two of them hold the same pose
            object.update(phase(i) * sequence.duration);
        } else if (scene === 'rest' || scene === 'moved') {
            side.play(object, sequence.animation, false);
            object.update(sequence.duration + PAST_END + phase(i));
        } else object.update(0);
    }
    if (scene === 'moved') {
        tick = () => {
            frame++;
            parent.position.set(12 * Math.sin(frame * 0.21), 9 * Math.cos(frame * 0.13));
        };
    }
    if (scene === 'mixed') {
        // one instance after the other plays its animation once. After a round every one has played
        tick = () => {
            if (frame % MIXED_START_EVERY === 0) {
                const index = (frame / MIXED_START_EVERY) % objects.length;

                side.play(objects[index], rigs[index].plan.sequences[0].animation, false);
            }
            frame++;
        };
    }
    const scale = layoutGrid(objects, (index) => rigs[index].plan.frame, renderer.width, renderer.height);

    return {
        objects,
        scale,
        tick,
        dispose() {
            for (const object of objects) {
                parent.removeChild(object);
                object.destroy();
            }
            if (parent !== stage) parent.destroy();
        },
    };
}
