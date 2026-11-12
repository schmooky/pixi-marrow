import type { SliderConstraintData } from '../../model/constraints';
import type { AnimationData, SkeletonModel } from '../../model/model';
import type { TimelineData, TimelineKind } from '../../model/timelines';
import type { AttachmentLookup } from '../shared/lookup';
import { checkIndices, constraintError, PROPERTY_KINDS } from './plan-checks';
import type { SliderRig43 } from './slider-types';
import type { Plan43, SliderPlan } from './solver-types';

/*
 * What the official `Slider.sort` reads from the animation of a slider, worked out once per model:
 * the bones, the slots and the constraints its timelines animate.
 */

/** The timelines the official `isBoneTimeline` is true for. */
const BONE_TIMELINES: readonly TimelineKind[] = [
    'rotate',
    'translate',
    'translateX',
    'translateY',
    'scale',
    'scaleX',
    'scaleY',
    'shear',
    'shearX',
    'shearY',
    'inherit',
];
/** The timelines the official `isSlotTimeline` is true for. */
const SLOT_TIMELINES: readonly TimelineKind[] = [
    'rgba',
    'rgb',
    'alpha',
    'rgba2',
    'rgb2',
    'attachment',
    'deform',
    'sequence',
];
/**
 * The timelines that write the pose of a constraint. `Slider.sort` gives the constraint of each a
 * pose of its own. The physics reset timeline is not among them: it writes no pose.
 */
const CONSTRAINT_TIMELINES: readonly TimelineKind[] = [
    'ikConstraint',
    'transformConstraint',
    'pathConstraintPosition',
    'pathConstraintSpacing',
    'pathConstraintMix',
    'physicsConstraintInertia',
    'physicsConstraintStrength',
    'physicsConstraintDamping',
    'physicsConstraintMass',
    'physicsConstraintWind',
    'physicsConstraintGravity',
    'physicsConstraintMix',
    'slider',
    'sliderMix',
];

/** The targets of the timelines of the given kinds, each once, in timeline order. */
function targets(animation: AnimationData, kinds: readonly TimelineKind[]): Set<number> {
    const found = new Set<number>();

    for (const timeline of animation.timelines) if (kinds.includes(timeline.kind)) found.add(timeline.target);

    return found;
}

/** The official `Slider` of the model. `at` is where its pose starts among the constraint poses. */
export function planSlider(model: SkeletonModel, data: SliderConstraintData, index: number, at: number): SliderPlan {
    const animation = model.animations[data.animation];

    if (animation === undefined) {
        throw constraintError(
            'slider',
            data.name,
            `plays animation ${data.animation}, which the skeleton does not have.`,
        );
    }
    const bones = targets(animation, BONE_TIMELINES);
    const slots = targets(animation, SLOT_TIMELINES);

    if (data.bone !== -1) {
        checkIndices(data, [data.bone], model.bones.count, 'bone');
        // the official code fails here with a TypeError
        if (data.property === null) throw constraintError('slider', data.name, 'has a bone and no property of it.');
    }
    checkIndices(data, bones, model.bones.count, 'bone', 'an animation for bone');
    checkIndices(data, slots, model.slots.count, 'slot', 'an animation for slot');

    return {
        type: 'slider',
        index,
        name: data.name,
        skinRequired: data.skinRequired,
        at,
        animation: data.animation,
        additive: data.additive,
        loop: data.loop,
        bone: data.bone,
        property: data.property === null ? -1 : PROPERTY_KINDS[data.property],
        propertyOffset: data.propertyOffset,
        offset: data.offset,
        scale: data.scale,
        local: data.local,
        bones: Int32Array.from(bones),
        slots: Int16Array.from(slots),
        drawOrder: animation.timelines.some(({ kind }) => kind === 'drawOrder' || kind === 'drawOrderFolder'),
    };
}

/** The official `timelineSlots` of the attachment a deform or sequence timeline animates. */
function timelineSlots(lookup: AttachmentLookup, timeline: TimelineData): Iterable<number> {
    if ((timeline.kind !== 'deform' && timeline.kind !== 'sequence') || timeline.attachment === undefined) return [];
    const attachment = lookup.resolve(timeline.attachment);

    return attachment?.type === 'mesh' ? (attachment.timelineSlots ?? []) : [];
}

/**
 * What the sliders of a model need: which slots and which other parts of the pose their
 * animations animate. Null for a model without sliders.
 */
export function planSliders(
    model: SkeletonModel,
    lookup: AttachmentLookup,
    plans: readonly Plan43[],
): SliderRig43 | null {
    const sliders = plans.filter((plan) => plan.type === 'slider');

    if (sliders.length === 0) return null;
    const slots = new Set<number>();
    const leaks = new Set<number>();
    let inherit = false;
    let constraints = false;

    for (const slider of sliders) {
        for (const slot of slider.slots) slots.add(slot);
        for (const timeline of model.animations[slider.animation]?.timelines ?? []) {
            if (timeline.kind === 'inherit') inherit = true;
            if (CONSTRAINT_TIMELINES.includes(timeline.kind)) constraints = true;
            for (const slot of timelineSlots(lookup, timeline)) {
                if (slot >= 0 && slot < model.slots.count) leaks.add(slot);
            }
        }
    }
    const ordinals = new Int16Array(slots.size > 0 ? model.slots.count : 0).fill(-1);

    Array.from(slots).forEach((slot, ordinal) => {
        ordinals[slot] = ordinal;
    });

    return {
        slots: Int16Array.from(slots),
        ordinals,
        leaks: Int16Array.from(leaks),
        drawOrder: sliders.some((slider) => slider.drawOrder),
        inherit,
        constraints,
        previous: new Uint8Array(ordinals.length),
    };
}
