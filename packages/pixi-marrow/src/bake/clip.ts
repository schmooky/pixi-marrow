/**
 * One animation of one skeleton, sampled at a fixed rate: the pose of every frame of one
 * playback on track 0 from the setup pose, as `bakeAnimation` records it. Only what moves is
 * kept. A bone whose world transform is the same in every frame is left out, and so is every
 * value of a slot that never changes.
 *
 * The numbers are 32-bit. Played back, a frame equals the pose the engine gives at its time,
 * rounded to 32 bits. Between two frames the frame before is shown.
 *
 * Frame `k` is at `k / fps` seconds into the animation, for every `k` below `duration * fps`.
 * The last frame is at `duration`.
 *
 * Plain data: typed arrays, numbers and strings. `encodeBakedClips` writes clips to bytes.
 */
export interface BakedClip {
    /** The name of the animation. */
    readonly animation: string;
    /** The skins that were active while it was baked, by name, in order. Empty for none. */
    readonly skins: readonly string[];
    /** Frames per second. */
    readonly fps: number;
    /** The duration of the animation in seconds. */
    readonly duration: number;
    /** How many frames there are. */
    readonly frames: number;
    /** The editor hash of the skeleton file, or null. A clip plays only on a model with the same hash. */
    readonly hash: string | null;
    /** How many bones and slots the skeleton has. A clip plays only on a model with the same counts. */
    readonly boneCount: number;
    readonly slotCount: number;
    /** Where the skeleton was placed while it was baked: x, y, scaleX, scaleY. A clip plays only at that placement. */
    readonly placement: Float64Array;
    /** The bones that move, by index. */
    readonly bones: Int16Array;
    /** Per frame, then per bone of {@link bones}: a, b, c, d, worldX, worldY. */
    readonly world: Float32Array;
    /** The slots whose color changes. */
    readonly colorSlots: Int16Array;
    /** Per slot of {@link colorSlots}: the channels that change, bit 0 for red to bit 3 for alpha. */
    readonly colorMasks: Uint8Array;
    /** Per frame, then per slot of {@link colorSlots}: r, g, b, a. */
    readonly colors: Float32Array;
    /** The slots whose dark color changes. */
    readonly darkSlots: Int16Array;
    /** Per slot of {@link darkSlots}: the channels that change, bit 0 for red to bit 2 for blue. */
    readonly darkMasks: Uint8Array;
    /** Per frame, then per slot of {@link darkSlots}: r, g, b. */
    readonly darkColors: Float32Array;
    /** The slots whose attachment changes, and every slot whose deform or sequence index is kept. */
    readonly attachmentSlots: Int16Array;
    /** The names the attachments are found by in the skins, as a slot shows them. Null for no attachment. */
    readonly attachmentNames: readonly (string | null)[];
    /** Per frame, then per slot of {@link attachmentSlots}: an index into {@link attachmentNames}. */
    readonly attachments: Int16Array;
    /** The slots whose sequence index changes. */
    readonly sequenceSlots: Int16Array;
    /** Per frame, then per slot of {@link sequenceSlots}: the sequence index. */
    readonly sequences: Int32Array;
    /** The slots whose deform changes. */
    readonly deformSlots: Int16Array;
    /** Per frame, then per slot of {@link deformSlots}: where its numbers start in {@link deforms}. */
    readonly deformStarts: Int32Array;
    /** Per frame, then per slot of {@link deformSlots}: how many numbers it has. 0 for no deform. */
    readonly deformLengths: Int32Array;
    /** The numbers of every deform. A frame that repeats the one before shares its numbers. */
    readonly deforms: Float32Array;
    /** Every draw order the animation shows, `slotCount` slot indices each. Empty when it never changes. */
    readonly drawOrders: Int16Array;
    /** Per frame: an index into {@link drawOrders}. Empty when the draw order never changes. */
    readonly drawOrderFrames: Uint16Array;
}

/** How far below a sample time a time may be and still show that sample, in frames. It absorbs the sum of many steps. */
export const SAMPLE_SLACK = 1e-4;

/**
 * How many frames a clip of this duration has at this rate: one per sample time below the
 * duration, and one at the duration.
 *
 * @example
 * frameCount(1, 60); // 61
 */
export function frameCount(duration: number, fps: number): number {
    return duration > 0 ? Math.ceil(duration * fps) + 1 : 1;
}

/**
 * The frame a clip shows at a time of its animation: the last frame at or after the duration,
 * else the nearest sample at or before the time. A time a little below a sample counts as that
 * sample, see {@link SAMPLE_SLACK}, so that the sum of many steps of `1 / fps` finds its frame.
 *
 * @example
 * frameAt(clip, 0.5); // 30 for a clip of 60 frames per second
 */
export function frameAt(clip: Pick<BakedClip, 'frames' | 'duration' | 'fps'>, time: number): number {
    const last = clip.frames - 1;

    if (time >= clip.duration) return last;
    const frame = Math.floor(time * clip.fps + SAMPLE_SLACK);

    return frame < 0 ? 0 : frame < last ? frame : last;
}

/**
 * The bytes the arrays of a clip take: what one more clip costs, shared by every instance.
 *
 * @example
 * console.log(bakedBytes(clip) / 1024, 'KB');
 */
export function bakedBytes(clip: BakedClip): number {
    const arrays = [
        clip.placement,
        clip.bones,
        clip.world,
        clip.colorSlots,
        clip.colorMasks,
        clip.colors,
        clip.darkSlots,
        clip.darkMasks,
        clip.darkColors,
        clip.attachmentSlots,
        clip.attachments,
        clip.sequenceSlots,
        clip.sequences,
        clip.deformSlots,
        clip.deformStarts,
        clip.deformLengths,
        clip.deforms,
        clip.drawOrders,
        clip.drawOrderFrames,
    ];

    return arrays.reduce((sum, array) => sum + array.byteLength, 0);
}
