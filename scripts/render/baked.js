/*
 * Baked playback in the pixel check: the sequence that plays at the sample times of a clip, the
 * wait for the bake, and the case that says how many updates played baked.
 */

/** The longest the check waits for the bake of one clip, in milliseconds. */
const BAKE_WAIT = 20000;

/**
 * Waits until the clip of every instance with `bake: 'auto'` is there. The runtime bakes a clip
 * in idle time: the first update that finds none starts the bake and plays live. A game yields
 * to the browser after each frame, and this check does not, so it yields here. An update of
 * zero seconds starts the bake and moves no time, so the captures stay at the sample times.
 */
export async function bakedClipsReady(live, fail) {
    for (const [key, instance] of live) {
        if (!instance.baked?.()) continue;
        const start = performance.now();

        try {
            instance.update(0);
            while (/being baked in idle time/.test(instance.baked().last)) {
                if (performance.now() - start > BAKE_WAIT) throw new Error('the bake of the clip did not end');
                await new Promise((next) => setTimeout(next, 4));
                instance.update(0);
            }
        } catch (error) {
            fail(key, 'failed while its clip was baked', error);
        }
    }
}

/**
 * A sequence once more for baked playback: one update of 1 / 60 seconds per step, the rate the
 * clips are baked at, so that every capture is at a sample time. The captures stay in the first
 * loop: after the loop point the time of a looped entry falls between two samples.
 */
export function bakedSequence(sequence) {
    const last = Math.max(0, Math.ceil(sequence.duration * 60) - 1);
    const captures = [...new Set([0, 7, 15, 26, last])].filter((step) => step <= last).sort((a, b) => a - b);

    return { ...sequence, dt: 1 / 60, captures };
}

/**
 * What baked playback did on a rig. A rig whose skins turn on no physics constraint and no
 * slider must play baked, else the comparisons of baked playback prove nothing.
 */
export function bakedCase(ctx) {
    const baked = ctx.baked.reduce((sum, each) => sum + each.baked, 0);
    const unbaked = ctx.baked.reduce((sum, each) => sum + each.unbaked, 0);
    const blocked = ctx.baked.find((each) => /physics constraint|slider/.test(each.last));
    const reasons = baked === 0 && !blocked && ctx.baked.length > 0 ? ['no update played baked'] : [];

    return { label: 'baked updates', kind: 'baked', reasons, info: { baked, unbaked, blocked: blocked?.last ?? null } };
}
