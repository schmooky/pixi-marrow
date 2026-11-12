/*
 * Browser part of scripts/check-render.mjs: what the buffers of pixi-marrow do while an animation
 * plays, how many draw calls a frame takes, and how much area its triangles cover. These cases
 * read `stats` of the display object and the buffers of its meshes.
 */
import { BACKGROUNDS } from './pixels.js';

/** Frames an animation plays for the buffer check. More than one loop. */
const FRAMES = 30;

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** Frames with a wrong draw count that get a line of their own. */
const LISTED = 3;

/**
 * The draw calls of every captured frame, counted on the GPU interface.
 *
 * `stats.drawCalls` must say what the GPU interface saw, in every frame. A rig with normal and
 * additive slots only is one draw call while it shows no clip. A clipping attachment that cuts a
 * visible slot adds a range for the slots it cuts and two draws of its mask: one before those
 * slots to mark the area, one after them to clear it. The slots before and after it are ranges of
 * their own. So with `m` masks such a rig takes `m` to `2m + 1` ranges and `2m` mask draws.
 */
export function drawCallCase(ctx) {
    const { plan, draws } = ctx;
    const range = (counts) => (counts.length ? [Math.min(...counts), Math.max(...counts)] : null);
    const at = (frame) => `${frame.animation}${frame.skin ? ` (${frame.skin})` : ''} step ${frame.step}`;
    const wrong = [];

    for (const frame of draws.ours) {
        const masks = frame.masks / 2;
        const ranges = frame.gpu - frame.masks;

        if (typeof frame.stat === 'number' && frame.stat !== frame.gpu) {
            wrong.push(`${at(frame)}: stats.drawCalls says ${frame.stat}, the GPU interface saw ${frame.gpu}`);
        } else if (plan.oneDraw && masks === 0 && frame.gpu !== 1) {
            wrong.push(`${at(frame)}: ${frame.gpu} draw calls without a clip mask, expected 1`);
        } else if (plan.oneDraw && (ranges < masks || ranges > masks * 2 + 1)) {
            wrong.push(
                `${at(frame)}: ${ranges} ranges with ${masks} clip masks, expected ${masks} to ${masks * 2 + 1}`,
            );
        }
    }
    const reasons = wrong.slice(0, LISTED);

    if (wrong.length > LISTED) reasons.push(`and ${wrong.length - LISTED} more frames`);

    return {
        label: 'draw calls',
        kind: 'draws',
        reasons,
        info: {
            ours: range(draws.ours.map((frame) => frame.gpu)),
            // one instance alone in the batched mode. It has no rule: what counts is many instances
            batched: range(draws.batched),
            official: range(draws.official),
            stat: range(draws.ours.map((frame) => frame.stat).filter((count) => typeof count === 'number')),
            masks: range(draws.ours.map((frame) => frame.masks)),
        },
    };
}

/**
 * Plays one animation on a fresh instance and says what the buffers did.
 *
 * Two things must hold. The vertex ranges are built once: `templateBuilds` stays where it is while
 * an animation plays, and it is 1 when no skin was set. And the index buffer is rewritten only when
 * the drawn slots change: `indexRebuilds` stays for an animation whose `info` features hold none of
 * `plan.rewriters`. With one of those keys a slot can appear, vanish or move, for example when its
 * alpha reaches 0, so there the count is information. A slider plays an animation of its own on
 * top, so what that one keys counts as well.
 *
 * A third number is counted from outside: how often Pixi built the instructions of the render
 * group again while the animation played, see `countBuilds`. The stable layout aims at zero, with
 * draw order and attachment keys too. It is information, and a failure in the batched mode when
 * `options.strictRebuilds` is set.
 *
 * @param mode The render mode the instance asks for: `mesh` or `batched`.
 */
async function play(ctx, { animation, dt, features }, mode) {
    const { plan, studio, options } = ctx;
    const label = mode === 'batched' ? 'buffers while playing, batched' : 'buffers while playing';
    const where = { label, kind: 'steady', animation, skin: plan.steadySkin };
    const url = (file) => `/fixtures/ours/${plan.version}/${file}`;
    const instance = await ctx.ours.create({ skeleton: url(plan.files.skel), atlas: url(plan.files.atlas), mode });
    const frame = (seconds) => {
        instance.update(seconds);

        return studio.draw(instance.root, BACKGROUNDS.solid).builds;
    };

    try {
        if (plan.steadySkin) instance.setSkin(plan.steadySkin);
        instance.place(plan.placement);
        instance.play(animation);
        // the first frames fill the buffers, and a skin that was set builds the ranges for it
        frame(0);
        frame(dt);
        const before = instance.stats() ?? {};
        const counted = typeof before.indexRebuilds === 'number' && typeof before.templateBuilds === 'number';
        const named = instance.info()?.animations.find((entry) => entry.name === animation);
        const keyed = [...new Set([...(named?.features ?? features), ...plan.sliderFeatures])];
        const keys = keyed.filter((feature) => plan.rewriters.includes(feature));
        // the frames after which the index buffer had been rewritten
        const at = [];
        let count = before.indexRebuilds;
        let instructionBuilds = 0;

        for (let i = 0; i < FRAMES; i++) {
            instructionBuilds += frame(dt);
            if (instance.stats()?.indexRebuilds !== count) at.push(i);
            count = instance.stats()?.indexRebuilds;
        }
        const after = instance.stats() ?? {};
        const rewrites = after.indexRebuilds - before.indexRebuilds;
        const reasons = [];
        const info = { frames: FRAMES, keys, instructionBuilds: studio.countsBuilds ? instructionBuilds : null };

        if (options.strictRebuilds && mode === 'batched' && instructionBuilds > 0) {
            reasons.push(
                `Pixi built the instructions of the render group ${instructionBuilds} times in ${FRAMES} frames`,
            );
        }
        // the batched mode may keep other counters. What it has is checked, the rest is left out
        if (!counted) return { ...where, reasons, info: { ...info, noStats: true } };
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
                ...info,
                rewrites,
                templateBuilds: after.templateBuilds,
                positionUploads: after.positionUploads - before.positionUploads,
                colorUploads: after.colorUploads - before.colorUploads,
            },
        };
    } finally {
        instance.destroy();
    }
}

/** The buffer check of every animation in `plan.steady`, in each render mode that is drawn. */
export async function bufferCases(ctx) {
    const cases = [];

    for (const mode of ['mesh', 'batched']) {
        if (!ctx.run[mode]) continue;
        for (const entry of ctx.plan.steady) {
            try {
                cases.push(await play(ctx, entry, mode));
            } catch (error) {
                cases.push({
                    label: `buffers while playing${mode === 'batched' ? ', batched' : ''}, failed`,
                    kind: 'error',
                    animation: entry.animation,
                    reasons: [message(error)],
                });
            }
        }
    }

    return cases;
}

/** The meshes under a container that draw, without the meshes that are masks. */
function drawnMeshes(PIXI, container, out = []) {
    for (const child of container.children) {
        if (!child.visible) continue;
        if (child instanceof PIXI.Mesh) {
            if (container.mask !== child) out.push(child);
        } else drawnMeshes(PIXI, child, out);
    }

    return out;
}

/**
 * The area of the triangles a display object of ours draws in its own units: the sum over every
 * triangle of its meshes, read from the position and index buffers. Triangles of slots that lie
 * on top of each other count each time, so this is what the GPU has to fill. Times the square
 * of the scale it is the area in pixels of the picture. A clip mask cuts some of it away, by the
 * same amount with and without the cuts of overdraw.
 */
export function triangleArea(PIXI, spine) {
    let area = 0;

    for (const mesh of drawnMeshes(PIXI, spine)) {
        const { geometry } = mesh;
        const positions = geometry.getBuffer('aPosition').data;
        const indices = geometry.indexBuffer.data;
        const count = geometry.indexCount || indices.length;

        for (let i = 0; i + 2 < count; i += 3) {
            const a = indices[i] * 2;
            const b = indices[i + 1] * 2;
            const c = indices[i + 2] * 2;
            const abx = positions[b] - positions[a];
            const aby = positions[b + 1] - positions[a + 1];
            const acx = positions[c] - positions[a];
            const acy = positions[c + 1] - positions[a + 1];

            area += Math.abs(abx * acy - aby * acx) / 2;
        }
    }

    return area;
}

/**
 * What the cuts of overdraw saved over the captured frames of a rig: the triangle area, the
 * indices and the vertices with the default cuts and with polygons, each against no cuts, and
 * the slots that were skipped as covered. Areas are in pixels of the picture. Information, not a
 * pass criterion: the pictures themselves are judged by their comparisons.
 */
export function overdrawCase(ctx) {
    const { on, off, polygons } = ctx.overdraw;
    const sum = (frames, key) => frames.reduce((total, frame) => total + frame[key], 0);
    const most = (frames, key) => Math.max(0, ...frames.map((frame) => frame[key]));
    const side = (frames) => ({
        area: sum(frames, 'area'),
        indices: sum(frames, 'indices'),
        vertices: most(frames, 'vertices'),
    });

    return {
        label: 'overdraw',
        kind: 'overdraw',
        reasons: [],
        info: {
            frames: on.length,
            on: side(on),
            off: side(off),
            polygons: side(polygons),
            covered: sum(on, 'covered'),
            coveredMost: most(on, 'covered'),
            hollowMost: most(on, 'tight'),
            tightMost: most(polygons, 'tight'),
            outlines: ctx.outlines,
        },
    };
}
