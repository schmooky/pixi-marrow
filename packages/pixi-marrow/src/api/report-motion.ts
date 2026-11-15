import type { ViewStats } from '../render/stats';
import { type PerfEntry, plural, type ReportSource, ruled } from './report-base';

/*
 * The row of `perf.report()` about motion: how much of the skeleton moved, and what the view
 * did for it. A pose at rest is not a frame without work: a display object above a batched
 * skeleton that moves or fades makes the batch write every vertex again. The row says so.
 */

/** The counters of a view at its last report, so that the next report sees what grew. */
const reported = new WeakMap<ViewStats, { replaces: number; rewrites: number }>();

/** What happened above the skeleton since the last report, with the rule that names it. Null for nothing. */
function above(stats: ViewStats, skipped: boolean): { rule: string; text: string } | null {
    const before = reported.get(stats) ?? { replaces: 0, rewrites: 0 };
    const replaces = stats.transformReplaces - before.replaces;
    const rewrites = stats.tintRewrites - before.rewrites;

    reported.set(stats, { replaces: stats.transformReplaces, rewrites: stats.tintRewrites });
    if (replaces > 0) {
        return {
            rule: 'MARROW001',
            text: `a display object above the skeleton moved, so ${plural(replaces, 'frame')} placed every vertex again (MARROW001)`,
        };
    }
    if (rewrites > 0) {
        return {
            rule: 'MARROW002',
            text: `the alpha or the tint above the skeleton changed, so ${plural(rewrites, 'frame')} wrote the static data of every vertex again (MARROW002)`,
        };
    }
    // a view that skipped its update wrote nothing itself: the bytes of the frame come from the batch
    if (skipped && stats.frameBytes > 0 && stats.renderMode === 'batched') {
        return {
            rule: 'MARROW014',
            text: 'the batch wrote the skeleton after that update, as it does when Pixi builds the instructions of the render group again (MARROW014)',
        };
    }

    return null;
}

/**
 * The row that says how much of the skeleton moved, and whether the view had anything to do.
 * It says "uploaded nothing" only when `stats.frameBytes` is 0 and nothing above the skeleton
 * moved or changed its tint since the last report.
 *
 * @example
 * const row = motionRow(source);
 * console.log(row.value, row.rule); // 'pose at rest, the batch still writes' 'MARROW001'
 */
export function motionRow({ model, stats, view }: ReportSource): PerfEntry {
    const { skipped, bones, slots } = view.motion;
    const rested = `${plural(stats.skips, 'update')} of the view found nothing to do so far`;
    const cause = above(stats, skipped);
    const data = {
        skipped,
        bones,
        slots,
        placedSlots: stats.placedSlots,
        coloredSlots: stats.coloredSlots,
        frameBytes: stats.frameBytes,
        skips: stats.skips,
        transformReplaces: stats.transformReplaces,
        tintRewrites: stats.tintRewrites,
    };

    if (skipped && cause === null) {
        return {
            feature: 'motion',
            value: 'at rest',
            reason: `the pose is the one the view drew last, so the last update placed no vertex and uploaded nothing. ${rested}`,
            data,
        };
    }
    if (skipped && cause !== null) {
        return ruled(
            {
                feature: 'motion',
                value: 'pose at rest, the batch still writes',
                reason: `the pose is the one the view drew last, but ${cause.text}. The last frame handed ${stats.frameBytes} bytes to the GPU. ${rested}`,
                data,
            },
            cause.rule,
        );
    }
    const also = cause === null ? '' : `. Also, ${cause.text}`;

    return ruled(
        {
            feature: 'motion',
            value: `${bones} of ${model.bones.count} bones, ${slots} of ${model.slots.count} slots`,
            reason: `the pose engine marked them as changed for the last update. The view placed the vertices of ${stats.placedSlots} of ${plural(view.visible.length, 'visible slot')} and wrote the colors of ${stats.coloredSlots}. ${rested}${also}`,
            data,
        },
        cause === null ? false : cause.rule,
    );
}
