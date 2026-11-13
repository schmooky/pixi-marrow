/*
 * Browser part of scripts/check-render.mjs: what the scenes of the idle cache follow, see
 * scripts/render/scene-plan-idle.mjs. Frame by frame it notes which instances of ours show the
 * image of their idle cache, on the two sides whose instances have it on. The case at the end of
 * a scene holds that against what the scene says: the steps at which an instance must show its
 * image, and the steps at which it must draw live.
 *
 * The pictures themselves are compared like the frames of any scene: each side of ours against
 * the official runtime, and against a side of ours that draws the same scene live, see
 * `SCENE_PAIRS` of scripts/render/scenes.js.
 */

/** The sides of ours whose instances have the idle cache on. */
const CACHED_SIDES = ['mesh', 'batched'];

/**
 * Notes for each side of ours with the idle cache which instances showed their image in the
 * frame of a step.
 *
 * @param idle What the scene has noted so far: per side a list of frames.
 */
export function noteIdleFrame(sides, idle, step) {
    for (const side of sides) {
        if (!CACHED_SIDES.includes(side.key) || side.wrong) continue;
        const shown = side.instances
            .filter((instance) => instance.node.idle && instance.cached?.())
            .map((instance) => instance.node.name);

        idle[side.key] ??= [];
        idle[side.key].push({ step, shown });
    }
}

/** Per instance the steps at which it showed its image, as runs of steps in a row. */
function runsByName(frames) {
    const runs = {};

    for (const { step, shown } of frames) {
        for (const name of shown) {
            runs[name] ??= [];
            const list = runs[name];
            const last = list.at(-1);

            if (last && last[1] === step - 1) last[1] = step;
            else list.push([step, step]);
        }
    }

    return runs;
}

/**
 * The case of a scene of the idle cache. `scene.idle.cached` lists the instances and steps at
 * which an instance must show its image, `scene.idle.live` the ones at which it must draw live.
 * Without an image in a frame the comparisons of its pictures would say nothing about the cache.
 */
export function idleCase(scene, idle) {
    const reasons = [];
    const info = { sides: {} };

    for (const key of CACHED_SIDES) {
        const frames = idle[key];

        if (!frames) continue;
        const shownAt = (step) => frames.find((frame) => frame.step === step)?.shown ?? [];

        for (const { name, step } of scene.idle.cached) {
            if (!shownAt(step).includes(name)) reasons.push(`${key}: ${name} did not show its image at step ${step}`);
        }
        for (const { name, step } of scene.idle.live) {
            if (shownAt(step).includes(name)) {
                reasons.push(`${key}: ${name} showed its image at step ${step}, where it must draw live`);
            }
        }
        info.sides[key] = runsByName(frames);
    }
    if (Object.keys(info.sides).length === 0) reasons.push('no side of ours with the idle cache drew');

    return { label: 'idle cache', kind: 'idleCache', reasons, info };
}
