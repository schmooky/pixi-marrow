import { MarrowError } from '../base/errors';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import { onSkinFreed } from '../pose/shared/combine-skins';
import { createAttachmentLookup } from '../pose/shared/lookup';
import { type BakedClip, bakedBytes, frameCount } from './clip';
import { animationIndex, bakeBlocker, skinIndices } from './eligible';

/** A clip made ready for one skin of its model: its attachments found, and what playback checks. */
export interface PreparedClip {
    readonly clip: BakedClip;
    /** The duration, the rate and the last frame of the clip, kept here, where every prepared clip has one shape. */
    readonly duration: number;
    readonly fps: number;
    readonly last: number;
    /** The index of the skin it is ready for, as `PoseState.skin` holds it. */
    readonly skin: number;
    /** Per slot of `clip.attachmentSlots`, then per name of `clip.attachmentNames`: the attachment. */
    readonly attachments: readonly (AttachmentData | null)[];
    /**
     * The bones whose animated pose the clip takes to be the setup pose where it keys nothing:
     * the bones that move and the bones they hang on. Undefined for every bone, which is what a
     * skin with an IK, transform or path constraint needs.
     */
    readonly needs: Uint8Array | undefined;
}

/** Bakes an animation of the model with these skins, by name. */
export type Baker = (animation: number, skins: readonly string[]) => BakedClip;

/** True when two lists of names are the same. */
const sameNames = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((name, i) => name === b[i]);

/** The bones a clip needs at their setup pose with this skin, see {@link PreparedClip.needs}. */
function needsOf(model: SkeletonModel, clip: BakedClip, skin: number): Uint8Array | undefined {
    const skinData = createAttachmentLookup(model).skin(skin);
    const constrained = model.constraints.some(
        (constraint, i) => !constraint.skinRequired || (skinData?.constraints.includes(i) ?? false),
    );

    if (constrained) return undefined;
    const needs = new Uint8Array(model.bones.count);

    for (const bone of clip.bones) {
        for (let at = bone; at >= 0 && needs[at] === 0; at = Number(model.bones.parents[at])) needs[at] = 1;
    }

    return needs;
}

/** Finds the attachments of a clip in a skin. Returns undefined when a name that a frame shows finds none. */
function attachmentsOf(model: SkeletonModel, clip: BakedClip, skin: number): (AttachmentData | null)[] | undefined {
    const lookup = createAttachmentLookup(model);
    const { attachmentSlots, attachmentNames, attachments, frames } = clip;
    const found: (AttachmentData | null)[] = [];

    for (const slot of attachmentSlots) {
        // a name of another slot finds nothing here, and no frame of this slot shows it
        for (const name of attachmentNames) found.push((name === null ? null : lookup.find(skin, slot, name)) ?? null);
    }
    for (let frame = 0; frame < frames; frame++) {
        for (let j = 0; j < attachmentSlots.length; j++) {
            const name = Number(attachments[frame * attachmentSlots.length + j]);

            if (attachmentNames[name] == null) continue;
            if (found[j * attachmentNames.length + name] === null) return undefined;
        }
    }

    return found;
}

/**
 * The baked clips of one model: those a game handed over, and those baked while it plays. They
 * are shared by every instance of the model, per skin and animation.
 */
export class ModelBakes {
    readonly model: SkeletonModel;
    /** The clips a game handed over with `addBakedClips`. */
    private readonly given: BakedClip[] = [];
    /** Per skin index, per animation: the prepared clip, null when it cannot play baked, undefined before the first look. */
    private readonly bySkin = new Map<number, (PreparedClip | null | undefined)[]>();
    /** Per skin index, per animation: why it cannot play baked, when it cannot. */
    private readonly reasons = new Map<number, string[]>();

    constructor(model: SkeletonModel) {
        this.model = model;
        // the index of a freed combined skin goes to the next one, which has clips of its own
        onSkinFreed(createAttachmentLookup(model), (index) => {
            this.bySkin.delete(index);
            this.reasons.delete(index);
        });
    }

    /** The bytes of every clip held, prepared or handed over. Each clip counts once. */
    get bytes(): number {
        const clips = new Set<BakedClip>(this.given);

        for (const row of this.bySkin.values()) for (const prepared of row) if (prepared) clips.add(prepared.clip);

        return [...clips].reduce((sum, clip) => sum + bakedBytes(clip), 0);
    }

    /** Why an animation of a skin does not play baked, or undefined when it does or was not looked at. */
    reason(skin: number, animation: number): string | undefined {
        return this.reasons.get(skin)?.[animation];
    }

    /** Takes clips a game baked before. A clip of the same animation and skins as one held replaces it. */
    add(clips: readonly BakedClip[]): void {
        for (const clip of clips) {
            checkFits(this.model, clip);
            const same = this.given.findIndex(
                (held) => held.animation === clip.animation && sameNames(held.skins, clip.skins),
            );

            if (same >= 0) this.given.splice(same, 1);
            this.given.push(clip);
        }
        // the next look finds the clips that were handed over
        this.bySkin.clear();
        this.reasons.clear();
    }

    /**
     * The clip of an animation for a skin, ready to play, or null. A clip that was handed over
     * comes first. Without one `bake` bakes it, and without `bake` there is none. The answer is
     * kept, except a null for want of a baker: another instance may bake it.
     */
    find(skin: number, animation: number, bake: Baker | null): PreparedClip | null {
        let row = this.bySkin.get(skin);

        if (row === undefined) {
            row = [];
            this.bySkin.set(skin, row);
        }
        const known = row[animation];

        if (known !== undefined) return known;
        const prepared = this.prepare(skin, animation, bake);

        if (prepared !== undefined) row[animation] = prepared;

        return prepared ?? null;
    }

    private prepare(skin: number, animation: number, bake: Baker | null): PreparedClip | null | undefined {
        const { model } = this;
        const lookup = createAttachmentLookup(model);
        const name = model.animations[animation]?.name ?? '';
        const skins = lookup.parts(skin).map((index) => model.skins[index]?.name ?? '');
        const blocked = bakeBlocker(model, lookup.skin(skin));
        const cannot = (reason: string): null => {
            const reasons = this.reasons.get(skin) ?? [];

            reasons[animation] = reason;
            this.reasons.set(skin, reasons);

            return null;
        };

        if (blocked !== null) return cannot(blocked);
        let clip = this.given.find((held) => held.animation === name && sameNames(held.skins, skins));

        if (clip === undefined) {
            if (bake === null) return undefined;
            try {
                clip = bake(animation, skins);
            } catch (error) {
                return cannot(error instanceof Error ? error.message : String(error));
            }
        }
        const attachments = attachmentsOf(model, clip, skin);

        if (attachments === undefined) return cannot('an attachment of the clip is not in the skins');

        return {
            clip,
            duration: clip.duration,
            fps: clip.fps,
            last: clip.frames - 1,
            skin,
            attachments,
            needs: needsOf(model, clip, skin),
        };
    }
}

/** Throws a `MarrowError` when a clip was not baked from this skeleton, or its arrays do not fit its counts. */
function checkFits(model: SkeletonModel, clip: BakedClip): void {
    animationIndex(model, clip.animation);
    skinIndices(model, clip.skins);
    const fail = (why: string): never => {
        throw new MarrowError('invalid-data', `The baked clip "${clip.animation}" ${why}.`, {
            fix: 'Bake the clips again from the skeleton file the asset loads.',
        });
    };

    if (clip.boneCount !== model.bones.count || clip.slotCount !== model.slots.count) {
        fail(
            `is of a skeleton with ${clip.boneCount} bones and ${clip.slotCount} slots, not ${model.bones.count} and ${model.slots.count}`,
        );
    }
    if (clip.hash !== null && model.hash !== null && clip.hash !== model.hash)
        fail('is of another export of the skeleton');
    if (clip.frames !== frameCount(clip.duration, clip.fps)) fail('has the wrong number of frames for its duration');
    const frames = clip.frames;
    const sizes: [ArrayLike<number>, number][] = [
        [clip.world, clip.bones.length * 6],
        [clip.colors, clip.colorSlots.length * 4],
        [clip.darkColors, clip.darkSlots.length * 3],
        [clip.attachments, clip.attachmentSlots.length],
        [clip.sequences, clip.sequenceSlots.length],
        [clip.deformStarts, clip.deformSlots.length],
        [clip.deformLengths, clip.deformSlots.length],
    ];

    if (sizes.some(([array, perFrame]) => array.length !== frames * perFrame)) fail('has arrays of the wrong length');
    if (clip.drawOrderFrames.length !== 0 && clip.drawOrderFrames.length !== frames)
        fail('has a draw order per frame of the wrong length');
    const reason = misfit(clip);

    if (reason !== null) fail(reason);
}

/** True when every value is a whole number from `low` to below `high`. */
const within = (values: ArrayLike<number>, low: number, high: number): boolean =>
    Array.prototype.every.call(values, (value: number) => Number.isInteger(value) && value >= low && value < high);

/** Why the arrays of a clip do not fit together, or null when they do. */
function misfit(clip: BakedClip): string | null {
    const { boneCount, slotCount, deformStarts, deformLengths, deforms, drawOrders } = clip;
    const slotLists = [clip.colorSlots, clip.darkSlots, clip.attachmentSlots, clip.sequenceSlots, clip.deformSlots];

    if (clip.placement.length !== 4) return 'has no placement of 4 numbers';
    if (!within(clip.bones, 0, boneCount) || !slotLists.every((slots) => within(slots, 0, slotCount))) {
        return 'names a bone or a slot the skeleton lacks';
    }
    if (clip.colorMasks.length !== clip.colorSlots.length || clip.darkMasks.length !== clip.darkSlots.length) {
        return 'has masks of the wrong length';
    }
    if (!within(clip.attachments, 0, clip.attachmentNames.length)) return 'shows an attachment it does not name';
    if (!within(clip.sequences, -1, 2 ** 31 - 1)) return 'has a sequence index below -1';
    for (let i = 0; i < deformStarts.length; i++) {
        const start = Number(deformStarts[i]);
        const length = Number(deformLengths[i]);

        if (start < 0 || length < 0 || start + length > deforms.length) return 'has a deform past its numbers';
    }
    if (slotCount > 0 && drawOrders.length % slotCount !== 0) return 'has draw orders of the wrong length';
    if (!within(drawOrders, 0, slotCount)) return 'has a draw order with a slot the skeleton lacks';
    if (!within(clip.drawOrderFrames, 0, slotCount > 0 ? drawOrders.length / slotCount : 0)) {
        return 'shows a draw order it does not hold';
    }

    return null;
}

/** The baked clips of each model that has some. */
const STORES = new WeakMap<SkeletonModel, ModelBakes>();

/**
 * The baked clips of a model, shared by every instance of it.
 *
 * @example
 * const clip = bakesOf(model).find(-1, 0, null);
 */
export function bakesOf(model: SkeletonModel): ModelBakes {
    let store = STORES.get(model);

    if (store === undefined) {
        store = new ModelBakes(model);
        STORES.set(model, store);
    }

    return store;
}
