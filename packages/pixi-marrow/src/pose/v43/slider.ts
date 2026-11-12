import { modifyLocal, validateLocal } from './bone-pose';
import { ALPHA, LAST_TIME, SHARED, TIME } from './curves';
import { SLIDER_MIX, SLIDER_TIME, type SliderPlan } from './solver-types';
import { applyTimeline } from './timelines';
import { readProperty, SOURCE, V } from './transform';
import { CURRENT, type Pose43 } from './types';

/** The official `Slider.offsets`: a slider reads the property of its bone without an offset. */
const NO_OFFSETS = new Float64Array(6);

/**
 * The first half of the official `Slider.update`, for a slider that a bone drives: the time of
 * the slider follows a property of the applied pose of the bone. It is written to the applied
 * pose of the slider. The official slider without a pose of its own writes its animated pose
 * there. Nothing can tell: a slider that a bone drives sets its time before every use.
 */
function followBone(pose: Pose43, plan: SliderPlan): void {
    const duration = Number(pose.rig.clips[plan.animation]?.duration);

    if (plan.local) validateLocal(pose, plan.bone);
    readProperty(pose, plan.bone, NO_OFFSETS, plan.property, plan.local);
    let time = plan.offset + (Number(V[SOURCE]) - plan.propertyOffset) * plan.scale;

    if (plan.loop) time = duration + (time % duration);
    else time = Math.max(0, time);
    pose.solve.applied[plan.at + SLIDER_TIME] = time;
}

/**
 * The official `Slider.update`: applies the animation of the slider to the applied pose, at the
 * time of the slider and mixed in by its mix. A slider fires no events. `pose` is the animated
 * pose of the engine.
 */
export function solveSlider(pose: Pose43, plan: SliderPlan): void {
    const { solve } = pose;
    const { applied } = solve;
    const target = solve.split?.applied;
    const clip = pose.rig.clips[plan.animation];
    const mix = Number(applied[plan.at + SLIDER_MIX]);

    if (mix === 0 || target === undefined || clip === undefined) return;
    const { duration, timelines } = clip;
    const { bones } = plan;

    if (plan.bone >= 0) {
        if (pose.state.active[plan.bone] !== 1) return;
        followBone(pose, plan);
    }
    for (let i = 0; i < bones.length; i++) modifyLocal(pose, Number(bones[i]));
    // the official Animation.apply, with the time of the slider as the time and as the last time
    let time = Number(applied[plan.at + SLIDER_TIME]);
    let lastTime = time;

    if (plan.loop && duration !== 0) {
        time %= duration;
        if (lastTime > 0) lastTime %= duration;
    }
    SHARED[LAST_TIME] = lastTime;
    SHARED[TIME] = time;
    SHARED[ALPHA] = mix;
    for (let i = 0; i < timelines.length; i++) {
        const timeline = timelines[i];

        if (timeline !== undefined) applyTimeline(target, timeline, null, CURRENT, plan.additive, false);
    }
}
