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
