/**
 * What a scene of the render check is made of, and the helpers that describe one. A scene is
 * plain data: the browser part builds it once per side, see scripts/render/scene-build.js.
 *
 * A node of a scene is one of:
 *
 *   spine     an instance of a rig: `rig` is a key of `rigs`, `x`, `y`, `scale` and `rotation`
 *             place it, `time` is where in its animation it starts. It plays the animation of
 *             its rig in a loop, once with `loop: false`, and not at all with `play: false`.
 *             `visible` and `renderable` set those flags. `mode` asks for a render mode on the
 *             batched side
 *   group     a container with `children`, and any of `alpha`, `tint`, `mask`, `filter`,
 *             `renderGroup` and a transform. With a `name` an event can move it
 *   graphics  a rectangle of one color
 *   sprite    a tinted sprite
 *
 * An event changes the stage before the update of its step:
 *
 *   add       a node at an index of the stage
 *   remove    takes an instance off the stage, `insert` puts it back at an index
 *   move      an instance to another index of the child list
 *   set       any of `visible`, `renderable`, `alpha` and `tint` of an instance
 *   play      an animation on an instance, in a loop or once with `loop: false`
 *   skin      another skin on an instance
 *   mode      asks an instance of ours for another render mode
 *   shift     moves a named group: any of `x`, `y`, `scale` and `rotation`
 *   destroy   destroys an instance
 */

/** Width and height of the picture of a scene in pixels. */
const SIZE = 512;
/** Seconds every instance advances per frame. No multiple of 1/30 second, where exports put their keys. */
export const DT = 0.0437;
/** Frames a scene plays, and the ones after which every side is captured. */
const STEPS = 16;
const CAPTURES = [0, 6, 15];

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
export const count = (length) => Array.from({ length }, (_, index) => index);
/** Where in its loop the instance with an index starts, as a share: no two start at the same pose. */
export const phase = (index) => (index * 0.618034) % 1;

/** What a scene needs of a rig of the plan, playing one animation with one skin. */
export function use(rigs, id, animation, skin = null) {
    const rig = rigs.find((entry) => entry.id === id);

    if (!rig) throw new Error(`the scenes need the rig ${id}`);
    if (rig.durations[animation] === undefined) throw new Error(`${id} has no animation ${animation}`);
    if (skin && !rig.skins.includes(skin)) throw new Error(`${id} has no skin ${skin}`);

    return {
        id,
        version: rig.version,
        skel: rig.files.skel,
        atlas: rig.files.atlas,
        skin,
        animation,
        duration: rig.durations[animation],
        frame: rig.frame,
        additive: rig.additive,
        features: rig.features,
    };
}

/**
 * An instance node. The frame of the rig is `size` pixels in its larger dimension, and its center
 * is at `cx`, `cy` whatever the rotation.
 *
 * @param key The key of the rig in `rigs` of the scene.
 * @param at Where in the loop of the animation the instance starts, from 0 to 1.
 */
export function spine(name, key, rig, { cx, cy, size, rotation = 0, at = 0, ...flags }) {
    const [x, y, width, height] = rig.frame;
    const scale = round(size / Math.max(width, height), 4);
    // the center of the frame in the units of the object. Skeletons are drawn with y down
    const ox = (x + width / 2) * scale;
    const oy = -(y + height / 2) * scale;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return {
        type: 'spine',
        name,
        rig: key,
        x: round(cx - (ox * cos - oy * sin), 2),
        y: round(cy - (ox * sin + oy * cos), 2),
        scale,
        rotation,
        time: round(at * rig.duration, 4),
        ...flags,
    };
}

/** A scene with the defaults: 16 frames, three of them captured, judged against the official runtime. */
export function scene(id, title, official, rigs, nodes, more = {}) {
    return {
        id: `scene/${id}`,
        title,
        official,
        // what ours is judged against, and why that is not the official runtime
        reference: official ? 'official' : 'mesh',
        why: '',
        size: SIZE,
        rigs,
        nodes,
        dt: DT,
        steps: STEPS,
        captures: CAPTURES,
        events: [],
        proof: null,
        // true for a scene that looks for a limit: what it finds does not fail the check
        limit: false,
        // with additive slots the alpha of a transparent target differs from the official one by design
        additive: Object.values(rigs).some((rig) => rig.additive),
        ...more,
    };
}
