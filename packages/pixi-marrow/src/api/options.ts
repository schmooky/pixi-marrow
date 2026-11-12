import type { TrackFields } from '../pose/engine';

/**
 * The names of one skeleton as string unions. `pixi-marrow typegen` writes a type of this shape.
 * Passed to the display object, it turns a misspelled name into a compile error.
 */
export interface MarrowNames {
    animations: string;
    skins: string;
    bones: string;
    slots: string;
    events: string;
}

/** Options for creating a display object. */
export interface MarrowSpineOptions {
    /**
     * True when the object updates itself from Pixi's shared ticker. Default true. Pass false
     * where there are no animation frames, as in Node, and call `update` yourself.
     */
    autoUpdate?: boolean;
    /**
     * How the skeleton reaches the GPU.
     *
     * - `mesh` gives it meshes of its own: one draw call per instance, more where slots multiply,
     *   screen or are clipped. The GPU places the vertices, and a clip is a stencil mask.
     * - `batched` writes it into the batch of its render group: skeletons that follow each other
     *   in the display list share one draw call, as sprites do. The CPU places the vertices and
     *   copies them in every frame, and it cuts the triangles of clipped slots.
     * - `auto` (the default) batches a skeleton of up to 1024 vertices and gives a larger one
     *   meshes.
     *
     * `stats.renderMode` names the mode in use, and `perf.report()` says why. The picture is the
     * same in both modes to the eye and not to the bit: the vertices are placed by other code.
     */
    renderMode?: 'auto' | 'mesh' | 'batched';
    /**
     * What a region attachment is drawn as, once the asset has outlines.
     *
     * - `auto` (the default) keeps the quad. A region without a visible pixel is not drawn at all.
     *   The picture stays the same.
     * - `on` draws a region as the polygon around its visible pixels: fewer pixels are shaded. The
     *   picture is the same to the eye and not to the bit. A GPU interpolates texture coordinates
     *   per triangle, so other triangles round some pixels to the next of 255 steps. A pixel on
     *   the edge of a region can also fall to the other side of that edge.
     * - `off` keeps every quad.
     */
    tightMesh?: 'auto' | 'on' | 'off';
    /**
     * `auto` (the default) skips a slot that lies behind the opaque part of a later slot, once
     * the asset has outlines. The picture stays the same. A slot that goes behind is found
     * within about a second and is drawn until then. A slot that comes out again is drawn in
     * the same frame. `off` draws every slot.
     */
    occlusion?: 'auto' | 'off';
}

/** Options for playing an animation now. */
export interface PlayOptions {
    /** The index of the track to play on. Default 0. */
    track?: number;
    /** True to repeat the animation until the track changes. Default false. */
    loop?: boolean;
    /** Seconds to mix from what the track holds. Default: the mix of the two animations, else `defaultMix`. */
    mix?: number;
    /** Multiplies how fast this animation plays. Default 1. */
    speed?: number;
    /** How much of the animation is applied, from 0 to 1. Default 1. */
    alpha?: number;
    /** True to play the animation backwards. Default false. */
    reverse?: boolean;
    /**
     * True to add the animation to the pose that lower tracks gave, where its timelines can add.
     * False replaces that pose. Default false.
     *
     * In Spine 4.1 and 4.2 this is the official `mixBlend` with the value `add`, and track 0
     * never adds. In Spine 4.3 it is the official entry field `additive`. The official runtime
     * takes it for a new animation only, so it is an option here and read-only on the `Track`.
     */
    additive?: boolean;
    /**
     * Seconds into the animation where playback starts, and where a loop starts again: the
     * official `animationStart`. Default 0.
     *
     * Events keyed before it fire in the first update, as in the official runtime. To leave
     * them out, also pass `entry: { animationLast: start }`.
     */
    start?: number;
    /**
     * Seconds into the animation where playback ends, and where a loop turns back to `start`:
     * the official `animationEnd`. Default: the duration of the animation.
     */
    end?: number;
    /**
     * True to turn the shortest way in every update while this animation mixes rotations. False
     * keeps the direction of the first update for the whole mix, so a bone cannot flip to the
     * other side. The official `shortestRotation`. Default false.
     */
    shortestRotation?: boolean;
    /**
     * While this animation mixes out, its events fire as long as the mix has gone less far than
     * this share, from 0 to 1. The official `eventThreshold`. Default 0: an animation that mixes
     * out fires no event.
     */
    eventThreshold?: number;
    /**
     * Any other field of the official `TrackEntry`, by its official name: `holdPrevious`,
     * `keepHold`, `trackEnd`, `trackTime`, `animationLast`, `mixAttachmentThreshold` and so on.
     * It is set after the options above. Default: no field.
     *
     * A field the Spine version of the skeleton lacks throws a `MarrowError` that names the
     * fields of that version. The animation plays then, without the fields of this option.
     */
    entry?: TrackFields;
}

/** Options for playing an animation after what a track holds. */
export interface QueueOptions extends PlayOptions {
    /**
     * Above 0: seconds after the start of the animation before it. At 0 or below: the animation
     * before it plays to its end, less the mix and plus this value. Default 0.
     */
    delay?: number;
}

/** Options for stopping tracks. */
export interface StopOptions {
    /** The index of the track to stop. Default: every track. */
    track?: number;
    /**
     * Seconds to mix out to the setup pose. At 0 the track is cleared at once and the pose keeps
     * what the track did to it. Default 0.
     */
    mix?: number;
}

/**
 * Takes the time each update of a display object spent. Set it as `updateProbe` of a
 * `MarrowSpine`. `createProbe` of `pixi-marrow/perf` makes one that adds the times up.
 */
export interface UpdateProbe {
    /**
     * Called at the end of every update, with milliseconds of `performance.now()`. The pose
     * engine runs animations, constraints and world transforms. The view writes vertices,
     * colors, draw ranges and buffers.
     *
     * @param pose The time in the pose engine.
     * @param geometry The time in the view.
     * @param events The time for matching events to their tracks and emitting them to listeners.
     */
    record(pose: number, geometry: number, events: number): void;
}

/** An event key that an animation fired, as plain data. */
export interface MarrowEvent<N extends MarrowNames = MarrowNames> {
    /** The name of the event. */
    name: N['events'];
    int: number;
    float: number;
    string: string;
    /** The volume of the event's audio, from 0 to 1. */
    volume: number;
    /** The balance of the event's audio, from -1 for left to 1 for right. */
    balance: number;
    /** The time of the event key in its animation, in seconds. */
    time: number;
}
