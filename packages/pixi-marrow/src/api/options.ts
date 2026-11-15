import type { TrackFields } from '../pose/engine';
import type { PerfOptions, PerfPreset, PerfSettings } from './presets';

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

/**
 * A Pixi `Ticker`, as far as a display object uses it: `app.ticker` and `Ticker.shared` are one.
 * The callback gets the ticker, and reads the milliseconds since the last frame from `deltaMS`.
 */
export interface SpineTicker {
    add(callback: (ticker: { deltaMS: number }) => void, context?: unknown): unknown;
    remove(callback: (ticker: { deltaMS: number }) => void, context?: unknown): unknown;
}

/** How a container that is attached to a slot follows that slot. See `MarrowSpine.attach`. */
export interface AttachOptions {
    /**
     * True to show the container only while the slot shows an attachment, so that an animation
     * that hides the attachment hides the container. Default false: the container shows on an
     * empty slot too, as on a placeholder.
     */
    followAttachment?: boolean;
    /** True to tint the container with the color of the slot. Default false. The alpha always follows. */
    followColor?: boolean;
}

/**
 * Options for creating a display object. A key that is no option throws a `MarrowError` with the
 * code `invalid-option` and the closest option.
 */
export interface MarrowSpineOptions {
    /**
     * True when the object updates itself from a Pixi ticker. Default true. Pass false where
     * there are no animation frames, as in Node, and call `update` yourself.
     *
     * An update from the ticker does not pose or draw an object that Pixi does not draw. That is
     * an object without a parent, and one with `visible` or `renderable` false or an alpha of 0,
     * on itself or on a parent. Its tracks, its events and `Track.finished` go on. The render
     * that shows it again poses it first. `bone(name)` reads the pose of its last posed update
     * until then. An update you call yourself always poses.
     */
    autoUpdate?: boolean;
    /**
     * The ticker that updates the object while `autoUpdate` is true. Default `Ticker.shared`.
     * Pass `app.ticker` so that its `speed`, `maxFPS` and `stop()` reach the skeleton.
     */
    ticker?: SpineTicker;
    /**
     * The Pixi `label` of the object. Default `MarrowSpine`, so that a dump of the scene tree
     * names the skeletons in a minified build.
     */
    label?: string;
    /**
     * How the skeleton reaches the GPU.
     *
     * - `mesh` gives it meshes of its own: one draw call per instance, more where slots multiply,
     *   screen or are clipped. The CPU places the vertices, or the vertex shader with
     *   `skinning: 'gpu'`. A clip is a stencil mask.
     * - `batched` writes it into the batch of its render group: skeletons that follow each other
     *   in the display list share one draw call, as sprites do. The CPU places the vertices that
     *   moved and copies them, and it cuts the triangles of clipped slots.
     * - `auto` (the default) batches a skeleton of up to 1024 vertices and gives a larger one
     *   meshes.
     *
     * The code of the mesh mode is not in the root import. An asset loads it when `auto` picks
     * the mesh mode for its skeleton, and when its load is asked with `renderMode: 'mesh'`. A
     * display object that asks for the mesh mode without that draws in a batch until the code
     * has loaded, and then changes over.
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
     *   the edge of a region can also fall to the other side of that edge. It adds vertices, 13 to
     *   94 percent on the rigs of the bench, which a phone whose CPU is the limit pays for. No
     *   preset sets it.
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
    /**
     * A preset of the settings below, or a `PerfOptions` object that starts from one. An option
     * given by its own name wins over the preset.
     *
     * - `exact` (the default): nothing that changes timing, memory or the picture to the bit.
     * - `balanced`: `offscreen: 'throttle'`.
     * - `fast`: `offscreen: 'pause'`, and `updateRate: 30` for a skeleton that the batched mode draws.
     *
     * The presets set when a skeleton updates, and nothing else. `tightMesh: 'on'`, `bake`,
     * `idleCache`, `lod` and `instancing` each cost memory, vertices or draw calls. What they cost
     * depends on the device and the scene, so each one is set by its own name.
     */
    perf?: PerfPreset | PerfOptions;
    /**
     * Where the vertices of the mesh mode are placed. `gpu` places them in the vertex shader from
     * the bone matrices, meshes with weights too. `cpu` and `auto` (the default) place them on
     * the CPU.
     *
     * With `gpu` the CPU still places a mesh while a deform is on it, and a region with a
     * sequence. The batched mode always places on the CPU: the option has no effect there, and
     * the object warns once. See {@link PerfSettings.skinning}.
     */
    skinning?: PerfSettings['skinning'];
    /**
     * `auto` and `on` draw instances of one rig that follow each other as one instanced draw.
     * Default `off`. See {@link PerfSettings.instancing} for when `auto` leaves a rig alone.
     *
     * It acts on a skeleton in the mesh mode with `skinning: 'gpu'`. On any other skeleton it
     * has no effect, and the object warns once. A run ends where Pixi draws anything
     * else, and where the next instance has another skin, cuts, draw order, pages or blend mode.
     * An instance whose clipping attachment cuts a visible slot, or with an attached container in
     * view, draws alone while that lasts. `perf.report()` says which it is, and why.
     */
    instancing?: PerfSettings['instancing'];
    /**
     * Which animations play from baked frames: `off` (the default), `auto` or a list of names.
     * With `auto` an animation is baked the first time it plays alone on track 0, at 60 frames
     * per second. The bake runs in idle time, a frame of the
     * animation or more per slice, and the object plays live until the clip is there. A list
     * bakes the animations it names, and a name the skeleton lacks throws a `MarrowError`. Clips
     * from `addBakedClips` of `pixi-marrow/bake` play in place of baking.
     *
     * The clips are shared by the instances of the asset, per skin. They grow with the duration
     * of the animations and with the number of skins that play them. Clips baked in the game hold
     * at most 4 MB per skeleton: the clip that played longest ago goes first. `setBakeBudget` of
     * `pixi-marrow/bake` sets another limit, and `perf.memory()` reports both numbers.
     *
     * An update plays baked when one entry plays alone on track 0 at alpha 1, with no mix, and
     * the update before it played that entry too. An entry with another one queued after it, as
     * `queue` adds one, plays live until it is the last. Nothing may have written the pose since. The
     * skin, the place of the skeleton and the physics mode must be the same. Any other update is
     * posed as without baking. A skin that turns on a physics constraint or a slider bakes nothing.
     *
     * Events, loops, time scales, reverse and the `start` and `end` options stay as without
     * baking. At a sample time the pose equals the played one, rounded to 32 bits. Between two
     * samples the nearer frame is shown, so a display of 60 Hz shows each frame once whatever the
     * jitter of its ticks. While baked frames play, `bone(name)` reads the local
     * values of the last update the engine posed. Its world values are those of the frame.
     */
    bake?: PerfSettings['bake'];
    /**
     * `auto` draws a skeleton that rests as one image until it changes. Default `off`. Each
     * image is a texture of its own, so many images take memory and can split a batch. At most 4
     * images are drawn per frame. See {@link PerfSettings.idleCache}.
     */
    idleCache?: PerfSettings['idleCache'];
    /**
     * What a skeleton does while it is off the screen or hidden. `update` (the default) updates
     * it as one on the screen. `throttle` updates it 4 times a second. `pause` does not pose or
     * draw it, and its tracks, events and `Track.finished` go on. See {@link PerfSettings.offscreen}.
     */
    offscreen?: PerfSettings['offscreen'];
    /**
     * How often the pose is updated. `display` (the default) is every frame. A number is that
     * many updates a second, in an even rhythm, with the time that passed. See
     * {@link PerfSettings.updateRate}.
     */
    updateRate?: PerfSettings['updateRate'];
    /**
     * `auto` leaves physics and deform out while the skeleton is drawn smaller than 96 pixels
     * across. Default `off`. Both come back at 120 pixels. See {@link PerfSettings.lod}.
     */
    lod?: PerfSettings['lod'];
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
    /** The integer of the event key: the Integer field of the event in the Spine editor. */
    int: number;
    /** The float of the event key: the Float field of the event in the Spine editor. */
    float: number;
    /** The string of the event key: the String field of the event in the Spine editor. */
    string: string;
    /** The volume of the event's audio, from 0 to 1. */
    volume: number;
    /** The balance of the event's audio, from -1 for left to 1 for right. */
    balance: number;
    /** The time of the event key in its animation, in seconds. */
    time: number;
}
