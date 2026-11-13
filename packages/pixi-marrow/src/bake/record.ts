import { MarrowError } from '../base/errors';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import type { PoseEngine, PoseEngineFactory } from '../pose/engine';
import { createAttachmentLookup } from '../pose/shared/lookup';
import { type PoseState, WORLD_STRIDE } from '../pose/state';
import { type BakedClip, frameCount } from './clip';
import { bakeBlocker, skinIndices } from './eligible';
import { packClip } from './pack';

/** What `bakeAnimation` takes besides the model and the animation. */
export interface BakeOptions {
    /** Frames per second. Default 60. */
    fps?: number;
    /** The skins to bake with, by name, combined in this order. Default none: the default skin shows. */
    skins?: readonly string[];
    /**
     * Where the skeleton is placed: x, y, scaleX and scaleY of the pose state. Default that of a
     * `MarrowSpine`: 0, 0, 1, -1. A clip plays only on a skeleton placed the same way.
     */
    placement?: readonly [number, number, number, number];
}

/** The placement a `MarrowSpine` gives its pose: Pixi's y axis points down. */
const DISPLAY_PLACEMENT: readonly [number, number, number, number] = [0, 0, 1, -1];

/** The pose of every frame of one playback, as 32-bit numbers and attachment objects, before only what moves is kept. */
export interface Recording {
    readonly model: SkeletonModel;
    readonly frames: number;
    /** The pose before the animation, at index 0 of each array, then one pose per frame. */
    readonly world: Float32Array;
    readonly colors: Float32Array;
    readonly darkColors: Float32Array;
    readonly sequences: Int32Array;
    readonly drawOrders: Int16Array;
    readonly attachments: (AttachmentData | null)[];
    /** Per pose and slot: the deform, or null for none. */
    readonly deforms: (Float32Array | null)[];
    /** 1 for each bone that is posed with the skins. */
    readonly active: Uint8Array;
    /** The name each attachment that a slot showed is found by, per slot. */
    readonly names: Map<AttachmentData, string>[];
}

/** Copies the pose of a state into a recording, as pose `at`: 0 before the animation, then frame by frame. */
function keep(recording: Recording, state: PoseState, at: number): void {
    const { model } = recording;
    const bones = model.bones.count;
    const slots = model.slots.count;

    recording.world.set(state.world, at * bones * WORLD_STRIDE);
    recording.colors.set(state.colors, at * slots * 4);
    recording.darkColors.set(state.darkColors, at * slots * 3);
    recording.sequences.set(state.sequenceIndices, at * slots);
    recording.drawOrders.set(state.drawOrder, at * slots);
    for (let slot = 0; slot < slots; slot++) {
        const length = Number(state.deformLengths[slot]);
        const deform = state.deform[slot];

        recording.attachments[at * slots + slot] = state.attachments[slot] ?? null;
        recording.deforms[at * slots + slot] =
            length > 0 && deform !== undefined ? Float32Array.from(deform.subarray(0, length)) : null;
    }
}

/** Notes the name each attachment of a slot is found by, as the engine finds it: in the active skin, then in the default skin. */
function nameAttachments(recording: Recording, state: PoseState): void {
    const lookup = createAttachmentLookup(recording.model);
    const slots = recording.model.slots.count;

    for (let i = 0; i < recording.attachments.length; i++) {
        const attachment = recording.attachments[i] ?? null;
        const slot = i % slots;
        const names = recording.names[slot];

        if (attachment === null || names === undefined || names.has(attachment)) continue;
        const name = lookup.nameOf(state.skin, slot, attachment) ?? lookup.nameOf(lookup.defaultSkin, slot, attachment);

        // a clip plays an attachment that is found by its name, so the name must find it again
        if (name === undefined || lookup.find(state.skin, slot, name) !== attachment) {
            throw new MarrowError(
                'unsupported-feature',
                `Slot "${recording.model.slots.names[slot]}" shows an attachment that its skins do not find by a name.`,
                { fix: 'Bake with the skins that show it, or play the animation without baking.' },
            );
        }
        names.set(attachment, name);
    }
}

/**
 * Plays an animation once on a new engine of a model and keeps every frame. That is the official
 * `setAnimation` on track 0 from the setup pose, and an update of no time for frame 0. Then
 * comes one update of `1 / fps` seconds per frame, and one to the end for the last frame.
 */
function record(
    createEngine: PoseEngineFactory,
    model: SkeletonModel,
    animation: number,
    fps: number,
    options: BakeOptions,
): Recording {
    const engine = createEngine();

    try {
        return recordOn(engine, model, animation, fps, options);
    } finally {
        // a combined skin stays while an engine shows it
        if (engine.skins.length > 1) engine.setSkin(-1);
    }
}

/** See {@link record}: the recording on an engine of its own. */
function recordOn(
    engine: PoseEngine,
    model: SkeletonModel,
    animation: number,
    fps: number,
    options: BakeOptions,
): Recording {
    const { state } = engine;
    const [x, y, scaleX, scaleY] = options.placement ?? DISPLAY_PLACEMENT;
    const skins = skinIndices(model, options.skins ?? []);

    Object.assign(state, { x, y, scaleX, scaleY, yDown: scaleY < 0 });
    if (skins.length > 0) engine.setSkins(skins);
    const reason = bakeBlocker(model, createAttachmentLookup(model).skin(state.skin));

    if (reason !== null) {
        throw new MarrowError(
            'unsupported-feature',
            `"${model.animations[animation]?.name}" cannot be baked: ${reason}.`,
            {
                fix: 'Play it without baking, or bake it with skins that leave the constraint out.',
            },
        );
    }
    // the setup pose as a display object first shows it
    engine.physics = 'none';
    engine.update(0);
    engine.physics = 'update';
    const duration = model.animations[animation]?.duration ?? 0;
    const frames = frameCount(duration, fps);
    const poses = frames + 1;
    const bones = model.bones.count;
    const slots = model.slots.count;
    const recording: Recording = {
        model,
        frames,
        world: new Float32Array(poses * bones * WORLD_STRIDE),
        colors: new Float32Array(poses * slots * 4),
        darkColors: new Float32Array(poses * slots * 3),
        sequences: new Int32Array(poses * slots),
        drawOrders: new Int16Array(poses * slots),
        attachments: new Array<AttachmentData | null>(poses * slots).fill(null),
        deforms: new Array<Float32Array | null>(poses * slots).fill(null),
        active: Uint8Array.from(state.active),
        names: Array.from({ length: slots }, () => new Map<AttachmentData, string>()),
    };

    keep(recording, state, 0);
    engine.setAnimation(0, animation, false);
    engine.update(0);
    for (let frame = 0; frame < frames; frame++) {
        // the last frame is at the end of the animation, however far the steps before got
        if (frame === frames - 1 && frame > 0) engine.update(duration + 1);
        else if (frame > 0) engine.update(1 / fps);
        engine.takeEvents();
        keep(recording, state, frame + 1);
    }
    nameAttachments(recording, state);

    return recording;
}

/**
 * Samples an animation at a fixed rate with an engine of the factory and keeps what moves.
 * Synchronous: the pose engine code is there. `bakeAnimation` loads it and calls this.
 */
export function bakeWith(
    createEngine: PoseEngineFactory,
    model: SkeletonModel,
    animation: number,
    options: BakeOptions = {},
): BakedClip {
    const fps = options.fps ?? 60;

    if (!Number.isFinite(fps) || fps <= 0) {
        throw new MarrowError('invalid-data', `fps ${fps} is not a rate.`, {
            fix: 'Pass a number of frames a second above 0.',
        });
    }
    const recording = record(createEngine, model, animation, fps, options);
    const [x, y, scaleX, scaleY] = options.placement ?? DISPLAY_PLACEMENT;

    return packClip(recording, {
        animation: model.animations[animation]?.name ?? '',
        skins: [...(options.skins ?? [])],
        fps,
        duration: model.animations[animation]?.duration ?? 0,
        placement: Float64Array.of(x, y, scaleX, scaleY),
    });
}
