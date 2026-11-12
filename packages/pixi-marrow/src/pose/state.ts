import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';

/** Numbers per bone in {@link PoseState.local}: x, y, rotation, scaleX, scaleY, shearX, shearY. */
export const LOCAL_STRIDE = 7;

/** Numbers per bone in {@link PoseState.world}: a, b, c, d, worldX, worldY. */
export const WORLD_STRIDE = 6;

/**
 * The pose of one skeleton instance, in typed arrays. A pose engine writes it. A renderer reads it.
 *
 * The numbers are 64-bit, like the numbers of the official JavaScript runtime, so a pose can equal
 * the official one exactly. A renderer copies what it needs to the GPU in 32-bit.
 */
export interface PoseState {
    readonly model: SkeletonModel;
    /** The position and scale of the skeleton, applied to its root bones. */
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    /**
     * True when the y axis of the world points down, as in Pixi: the official static
     * `Skeleton.yDown`. It does not flip the pose, a `scaleY` of -1 does that. Physics constraints
     * read it for the direction of gravity. Default false.
     */
    yDown: boolean;
    /** The index of the active skin, or -1 for none. */
    skin: number;
    /** Seconds this skeleton has been updated for. Physics constraints read it. */
    time: number;
    /**
     * The direction the wind of physics constraints blows in: the official `Skeleton.windX` and
     * `windY` of Spine 4.3. Default 1, 0. Spine 4.2 has no such fields: there they change nothing.
     */
    windX: number;
    windY: number;
    /**
     * The direction the gravity of physics constraints pulls in: the official `Skeleton.gravityX`
     * and `gravityY` of Spine 4.3. Default 0, 1. Spine 4.2 has no such fields: there they change nothing.
     */
    gravityX: number;
    gravityY: number;
    /** The animated pose of each bone, relative to its parent. See {@link LOCAL_STRIDE}. */
    readonly local: Float64Array;
    /** How each bone inherits its parent transform: an index into `INHERIT_MODES`. A timeline can change it. */
    readonly inherit: Uint8Array;
    /** 1 for each bone that is posed. A bone that needs a skin is 0 while no active skin lists it. */
    readonly active: Uint8Array;
    /** The world transform of each bone. See {@link WORLD_STRIDE}. */
    readonly world: Float64Array;
    /** The color of each slot: r, g, b, a. */
    readonly colors: Float64Array;
    /** The dark color of each slot: r, g, b. Meaningful where the model's `hasDark` is 1. */
    readonly darkColors: Float64Array;
    /** The attachment each slot shows, or null. */
    readonly attachments: (AttachmentData | null)[];
    /** The sequence index of each slot. -1 means the setup index of the attachment's sequence. */
    readonly sequenceIndices: Int32Array;
    /**
     * The deform of each slot's attachment. Only the first `deformLengths[slot]` numbers count.
     * An engine replaces an array with a longer one when a deform needs more room.
     */
    readonly deform: Float64Array[];
    /** How many numbers of each slot's deform are in use. 0 means no deform. */
    readonly deformLengths: Int32Array;
    /** The slot index at each draw order position. */
    readonly drawOrder: Int16Array;
}

/**
 * Allocates the pose arrays for a model. The values are zero, not the setup pose. A pose engine
 * sets the setup pose when it is created.
 */
export function createPoseState(model: SkeletonModel): PoseState {
    const bones = model.bones.count;
    const slots = model.slots.count;

    return {
        model,
        x: 0,
        y: 0,
        scaleX: 1,
        scaleY: 1,
        yDown: false,
        skin: -1,
        time: 0,
        windX: 1,
        windY: 0,
        gravityX: 0,
        gravityY: 1,
        local: new Float64Array(bones * LOCAL_STRIDE),
        inherit: new Uint8Array(bones),
        active: new Uint8Array(bones),
        world: new Float64Array(bones * WORLD_STRIDE),
        colors: new Float64Array(slots * 4),
        darkColors: new Float64Array(slots * 3),
        attachments: new Array<AttachmentData | null>(slots).fill(null),
        sequenceIndices: new Int32Array(slots),
        deform: Array.from({ length: slots }, () => new Float64Array(0)),
        deformLengths: new Int32Array(slots),
        drawOrder: new Int16Array(slots),
    };
}

/**
 * The bytes the typed arrays of a pose take. The memory one more instance of a skeleton costs.
 *
 * @example
 * const engine = await createPoseEngine(model);
 * console.log(poseStateBytes(engine.state));
 */
export function poseStateBytes(state: PoseState): number {
    const arrays = [
        state.local,
        state.inherit,
        state.active,
        state.world,
        state.colors,
        state.darkColors,
        state.sequenceIndices,
        state.deformLengths,
        state.drawOrder,
        ...state.deform,
    ];

    return arrays.reduce((sum, array) => sum + array.byteLength, 0);
}
