/*
 * Browser part of scripts/check-render.mjs: what the buffers of pixi-marrow do while an animation
 * plays, and how many draw calls a frame takes. These cases read `stats` of the display object.
 */
import { BACKGROUNDS } from './pixels.js';

/** Frames an animation plays for the buffer check. More than one loop. */
const FRAMES = 30;

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** One draw call per skeleton, counted on the GPU interface, for a rig with normal and additive slots only. */
export function drawCallCase(ctx) {
    const { plan, draws } = ctx;
    const range = (counts) => (counts.length ? [Math.min(...counts), Math.max(...counts)] : null);
    const ours = range(draws.ours);
    const stat = range(draws.stat.filter((count) => typeof count === 'number'));
    const reasons = [];

    if (plan.oneDraw && (ours[0] !== 1 || ours[1] !== 1)) {
        reasons.push(`${ours[0]} to ${ours[1]} draw calls per frame, expected 1`);
    }
    if (stat && (stat[0] !== ours[0] || stat[1] !== ours[1])) {
        reasons.push(`stats.drawCalls says ${stat[0]} to ${stat[1]}, the GPU interface saw ${ours[0]} to ${ours[1]}`);
    }

    return { label: 'draw calls', kind: 'draws', reasons, info: { ours, official: range(draws.official), stat } };
}

/**
 * Plays one animation on a fresh instance and says what the buffers did.
 *
 * Two things must hold. The vertex ranges are built once: `templateBuilds` stays where it is while
 * an animation plays, and it is 1 when no skin was set. And the index buffer is rewritten only when
 * the drawn slots change: `indexRebuilds` stays for an animation whose `info` features hold none of
 * `plan.rewriters`. With one of those keys a slot can appear, vanish or move, for example when its
 * alpha reaches 0, so there the count is information.
 */
async function play(ctx, { animation, dt, features }) {
    const { plan, studio } = ctx;
    const where = { label: 'buffers while playing', kind: 'steady', animation, skin: plan.steadySkin };
    const url = (file) => `/fixtures/ours/${plan.version}/${file}`;
    const instance = await ctx.ours.create({ skeleton: url(plan.files.skel), atlas: url(plan.files.atlas) });
    const frame = (seconds) => {
        instance.update(seconds);
        studio.draw(instance.root, BACKGROUNDS.solid);
    };

    try {
        if (plan.steadySkin) instance.setSkin(plan.steadySkin);
        instance.place(plan.placement);
        instance.play(animation);
        // the first frames fill the buffers, and a skin that was set builds the ranges for it
        frame(0);
        frame(dt);
        const before = instance.stats();

        if (typeof before?.indexRebuilds !== 'number' || typeof before?.templateBuilds !== 'number') {
            return { ...where, reasons: [], skipped: 'the display object has no stats for it' };
        }
        const named = instance.info()?.animations.find((entry) => entry.name === animation);
        const keys = (named?.features ?? features).filter((feature) => plan.rewriters.includes(feature));
        // the frames after which the index buffer had been rewritten
        const at = [];
        let count = before.indexRebuilds;

        for (let i = 0; i < FRAMES; i++) {
            frame(dt);
            if (instance.stats().indexRebuilds !== count) at.push(i);
            count = instance.stats().indexRebuilds;
        }
        const after = instance.stats();
        const rewrites = after.indexRebuilds - before.indexRebuilds;
        const reasons = [];

        if (after.templateBuilds !== before.templateBuilds) {
            reasons.push(`templateBuilds went from ${before.templateBuilds} to ${after.templateBuilds} while playing`);
        } else if (!plan.steadySkin && after.templateBuilds !== 1) {
            reasons.push(`templateBuilds is ${after.templateBuilds} without a skin change, expected 1`);
        }
        if (rewrites > 0 && keys.length === 0) {
            reasons.push(
                `${rewrites} index rewrites in ${FRAMES} frames, after frames ${at.join(' ')}, ` +
                    `and the animation keys none of ${plan.rewriters.join(', ')}`,
            );
        }

        return {
            ...where,
            reasons,
            info: {
                frames: FRAMES,
                rewrites,
                keys,
                templateBuilds: after.templateBuilds,
                positionUploads: after.positionUploads - before.positionUploads,
                colorUploads: after.colorUploads - before.colorUploads,
            },
        };
    } finally {
        instance.destroy();
    }
}

/** The buffer check of every animation in `plan.steady`. */
export async function bufferCases(ctx) {
    const cases = [];

    for (const entry of ctx.plan.steady) {
        try {
            cases.push(await play(ctx, entry));
        } catch (error) {
            cases.push({
                label: 'buffers while playing, failed',
                kind: 'error',
                animation: entry.animation,
                reasons: [message(error)],
            });
        }
    }

    return cases;
}
