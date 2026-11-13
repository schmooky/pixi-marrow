/**
 * The numbers of the bench: what one block measured, what repeated runs of a block agree on, and
 * the tables the terminal gets.
 */

/** The value at a share of the sorted list, between two entries where the share falls between them. */
export function quantile(values, share) {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (sorted.length - 1) * share;
    const low = Math.floor(at);
    const high = Math.ceil(at);

    return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Median, 95th percentile and mean of the frames of one block, in milliseconds. */
function frames(values) {
    return { median: quantile(values, 0.5), p95: quantile(values, 0.95), mean: mean(values) };
}

/**
 * What one block measured, from the raw numbers of the page.
 *
 * @param raw `update`, `submit`, `wait` and `calls` per sample, `heapBytes` and `agentBytes` for
 * all instances.
 * @param instances How many display objects were on the stage.
 */
export function summarize(raw, instances) {
    const perInstance = (bytes) => (typeof bytes === 'number' ? bytes / instances : null);

    return {
        update: frames(raw.update),
        // what the page computes for a frame: the update and the CPU part of the render
        cpu: frames(raw.update.map((ms, i) => ms + raw.submit[i])),
        render: frames(raw.submit.map((ms, i) => ms + raw.wait[i])),
        // one frame as an application pays for it: all parts of the same frame added up
        frame: frames(raw.update.map((ms, i) => ms + raw.submit[i] + raw.wait[i])),
        draws: [Math.min(...raw.calls), Math.max(...raw.calls)],
        // the draw calls of a frame on average, for a rig whose count moves from frame to frame
        drawsMean: mean(raw.calls),
        // buffer uploads and their bytes per frame, on average. A file of an older run has none
        uploads: raw.uploads ? mean(raw.uploads) : null,
        uploadBytes: raw.uploadBytes ? mean(raw.uploadBytes) : null,
        heapPerInstance: perInstance(raw.heapBytes),
        agentPerInstance: perInstance(raw.agentBytes),
        covered: raw.covered,
        ours: raw.ours,
    };
}

/** The median of a number over repeated runs, with the smallest and the largest run. */
function overRuns(values) {
    const known = values.filter((value) => typeof value === 'number');

    if (known.length === 0) return null;

    return { median: quantile(known, 0.5), min: Math.min(...known), max: Math.max(...known) };
}

/** True when the runs of two measurements overlap, so their difference is inside the spread. */
export function overlap(a, b) {
    return a.min <= b.max && b.min <= a.max;
}

export const ms = (value) => value.toFixed(3);
/** Half the distance between the fastest and the slowest run. */
export const spread = (runs) => ms((runs.max - runs.min) / 2);
const kilobytes = (runs) => (runs ? (runs.median / 1024).toFixed(1) : 'n/a');
/** Half the distance between the smallest and the largest memory reading, in KB. */
const memorySpread = (runs) => (runs ? ((runs.max - runs.min) / 2048).toFixed(1) : '');
/**
 * Prints rows as a table.
 *
 * @param left The indices of the columns that are aligned to the left. The others hold numbers.
 */
export function print(rows, left) {
    const widths = [];

    for (const row of rows) {
        for (const [i, cell] of row.entries()) widths[i] = Math.max(widths[i] ?? 0, String(cell).length);
    }
    for (const row of rows) {
        const cells = row.map((cell, i) =>
            left.includes(i) ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i]),
        );

        console.log(`    ${cells.join('  ').trimEnd()}`);
    }
}

/** The runs of one block: every number of {@link summarize} over the runs. */
export function combine(summaries) {
    const pick = (path) => overRuns(summaries.map((summary) => path(summary)));

    return {
        runs: summaries.length,
        update: pick((s) => s.update.median),
        updateP95: pick((s) => s.update.p95),
        cpu: pick((s) => s.cpu.median),
        cpuP95: pick((s) => s.cpu.p95),
        render: pick((s) => s.render.median),
        renderP95: pick((s) => s.render.p95),
        frame: pick((s) => s.frame.median),
        frameP95: pick((s) => s.frame.p95),
        draws: [Math.min(...summaries.map((s) => s.draws[0])), Math.max(...summaries.map((s) => s.draws[1]))],
        drawsMean: pick((s) => s.drawsMean),
        uploads: pick((s) => s.uploads),
        uploadBytes: pick((s) => s.uploadBytes),
        heapPerInstance: pick((s) => s.heapPerInstance),
        agentPerInstance: pick((s) => s.agentPerInstance),
        ours: summaries[0].ours,
    };
}

/** A ratio of two medians. A question mark says that the runs of the two overlap. */
function ratio(a, b) {
    if (!a || !b || b.median === 0) return '';

    return `${(a.median / b.median).toFixed(2)}${overlap(a, b) ? '?' : ''}`;
}

const drawRange = ([low, high]) => (low === high ? `${low}` : `${low} to ${high}`);

/** A row of ratios between two sides of the A/B table: the times, and the memory where it is printed. */
function ratioRow(name, a, b, memoryRatio) {
    return [
        '',
        name,
        ratio(a.update, b.update),
        '',
        '',
        ratio(a.cpu, b.cpu),
        '',
        '',
        ratio(a.render, b.render),
        '',
        '',
        ratio(a.frame, b.frame),
        '',
        '',
        '',
        '',
        '',
        memoryRatio(a.heapPerInstance, b.heapPerInstance),
        '',
        memoryRatio(a.agentPerInstance, b.agentPerInstance),
    ];
}

/**
 * The table of one rig in the A/B mode: per instance count one row for each side, one row with
 * ours divided by official, one with ours divided by ours in the mesh mode, and one with the
 * skinning on the GPU divided by ours, where those ran.
 *
 * @param groups Per instance count: `instances`, and the combined runs of `ours`, `official`,
 * `mesh` and `gpu`. A side that did not run is null.
 */
export function printAb(groups) {
    const rows = [
        [
            'n',
            'side',
            'update ms',
            '',
            '',
            'cpu ms',
            '',
            '',
            'render ms',
            '',
            '',
            'frame ms',
            '',
            '',
            'draws',
            'uploads',
            '',
            'heap KB',
            '',
            'page KB',
        ],
        [
            '',
            '',
            'med',
            'p95',
            '+-',
            'med',
            'p95',
            '+-',
            'med',
            'p95',
            '+-',
            'med',
            'p95',
            '+-',
            '',
            'per frame',
            'KB',
            'per inst',
            '+-',
            'per inst',
        ],
    ];

    for (const { instances, ours, official, mesh, idle, gpu } of groups) {
        // a side without a memory reading has none to print: below 20 instances, or with --memory=off
        const memory = (runs) => kilobytes(runs);
        const memoryRatio = (a, b) => ratio(a, b);

        for (const [name, side] of [
            ['ours', ours],
            ['official', official],
            ['mesh', mesh],
            ['idle', idle],
            ['gpu', gpu],
        ]) {
            if (!side) continue;
            rows.push([
                instances,
                name,
                ms(side.update.median),
                ms(side.updateP95.median),
                spread(side.update),
                ms(side.cpu.median),
                ms(side.cpuP95.median),
                spread(side.cpu),
                ms(side.render.median),
                ms(side.renderP95.median),
                spread(side.render),
                ms(side.frame.median),
                ms(side.frameP95.median),
                spread(side.frame),
                drawRange(side.draws),
                side.uploads ? side.uploads.median.toFixed(1) : '',
                side.uploadBytes ? kilobytes(side.uploadBytes) : '',
                memory(side.heapPerInstance),
                memorySpread(side.heapPerInstance),
                memory(side.agentPerInstance),
            ]);
        }
        if (ours && official) rows.push(ratioRow('ours/official', ours, official, memoryRatio));
        if (ours && mesh) rows.push(ratioRow('ours/mesh', ours, mesh, memoryRatio));
        if (idle && ours) rows.push(ratioRow('idle/ours', idle, ours, memoryRatio));
        if (gpu && ours) rows.push(ratioRow('gpu/ours', gpu, ours, memoryRatio));
    }
    print(rows, [1]);
}

const percent = (share) => `${share > 0 ? '+' : ''}${(100 * share).toFixed(1)}%`;

/**
 * How the render time of a setting compares with `off`, run by run: the median of the changes,
 * the smallest and the largest, and whether every run agrees about the sign.
 */
function againstOff(setting) {
    const { changes } = setting;

    if (setting.name === 'off' || changes.length === 0) return '';
    const agree = changes.every((change) => change < 0) || changes.every((change) => change > 0);

    return (
        `${percent(quantile(changes, 0.5))} (${percent(Math.min(...changes))} to ${percent(Math.max(...changes))}), ` +
        `${agree ? 'the same sign in every run' : 'not the same sign in every run'}`
    );
}

/**
 * The table of one rig and instance count in the overdraw mode: one row per setting of
 * `tightMesh`, with the render time of the runs side by side.
 *
 * @param settings The combined runs of each setting, `off` first, each with its `name` and its
 * `changes` against `off`, one per run.
 */
export function printOverdraw(settings) {
    const [off] = settings;
    const rows = [
        ['tightMesh', 'render ms', '', '', '', 'cpu ms', 'vertices', 'area', 'draws', 'render against off, run by run'],
        ['', 'med', 'fastest run', 'slowest run', 'p95', 'med', 'per inst', 'of off', '', ''],
    ];

    for (const setting of settings) {
        // a render mode that draws through no mesh of its own has no area to read
        const area =
            off.ours?.area > 0 && setting.ours?.area > 0
                ? `${((100 * setting.ours.area) / off.ours.area).toFixed(1)}%`
                : 'n/a';

        rows.push([
            setting.name,
            ms(setting.render.median),
            ms(setting.render.min),
            ms(setting.render.max),
            ms(setting.renderP95.median),
            ms(setting.cpu.median),
            setting.ours?.vertices ?? '',
            area,
            drawRange(setting.draws),
            againstOff(setting),
        ]);
    }
    print(rows, [0, 9]);
}

/**
 * Per run, how the median render time of a setting differs from that of `off` in the same run,
 * as a share: -0.1 is a tenth faster. The two were timed in turns, in the same seconds.
 *
 * @param blocks The blocks of one rig and instance count that measured something.
 * @param runs How many runs there were.
 */
export function changesAgainstOff(blocks, name, runs) {
    const median = (setting, run) => {
        const block = blocks.find((b) => b.run === run && b.setting === setting);

        return block ? summarize(block, block.instances).render.median : null;
    };
    const changes = [];

    for (let run = 0; run < runs; run++) {
        const [off, own] = [median('off', run), median(name, run)];

        if (off && own) changes.push(own / off - 1);
    }

    return changes;
}

/** What the page of a renderer says about its clock and its memory readings, as lines. */
export function describePage(state) {
    const { memory } = state;
    const megabytes = (bytes) => `${(bytes / 2 ** 20).toFixed(1)} MB`;
    const lines = [
        `the clock of the page steps by ${state.timerStep.toFixed(4)} ms` +
            `${state.isolated ? '' : ', the page is not cross-origin isolated'}`,
    ];

    lines.push(
        `an empty stage renders and waits for the GPU in ${state.emptyFrame.median.toFixed(3)} ms: every render time holds about that much`,
    );
    if (typeof state.emptyFrame.uploads === 'number') {
        lines.push(
            `an empty stage uploads ${state.emptyFrame.uploads.toFixed(1)} buffers and ${(state.emptyFrame.uploadBytes / 1024).toFixed(1)} KB per frame: ` +
                'every count of uploads holds that much',
        );
    }
    if (!memory.gc) lines.push('the page cannot call gc(), so the memory numbers include garbage');
    if (memory.heap) {
        lines.push(
            `heap KB: usedJSHeapSize grew by ${megabytes(memory.heapDelta)} for a typed array of ${megabytes(memory.probeBytes)}, ` +
                `so it ${memory.heapCountsTypedArrays ? 'counts' : 'does not count'} typed array memory`,
        );
    } else lines.push('heap KB: the browser gives no usedJSHeapSize');
    if (memory.agent) {
        lines.push(
            `page KB: measureUserAgentSpecificMemory grew by ${megabytes(memory.agentDelta)}, ` +
                `so it ${memory.agentCountsTypedArrays ? 'counts' : 'does not count'} typed array memory`,
        );
    } else lines.push('page KB: measureUserAgentSpecificMemory gave no answer');

    return lines;
}
