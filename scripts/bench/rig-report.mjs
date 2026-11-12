/**
 * The tables of one rig of the bench, from the blocks its page measured and from its memory
 * readings. What a function here prints it also returns as data, for the JSON file of the run.
 */
import { addMemory, describeEmpty, describeSplit } from './heap.mjs';
import { changesAgainstOff, combine, printAb, printOverdraw, quantile, summarize } from './table.mjs';

/** A frame is bound by fill when a quarter of the pixels takes less than this share of the time. */
const FILL_BOUND = 0.6;

/** Why a block does not count, or an empty string. */
export function blockFailure(block) {
    if (block.error) return block.error;
    if (block.covered === 0) return 'drew nothing';
    if (Math.max(...block.calls) === 0) return 'issued no draw call';

    return '';
}

/** The runs of the blocks that share a side, a setting and an instance count. */
function combined(blocks, match) {
    const runs = blocks.filter((block) => !blockFailure(block) && match(block));

    return runs.length ? combine(runs.map((block) => summarize(block, block.instances))) : null;
}

/** The render mode the blocks of ours drew in per instance count, as the runtime reports it, as one line. */
function describeRenderMode(blocks, counts, renderMode) {
    const modes = counts.map((instances) => {
        const block = blocks.find((b) => b.side === 'ours' && b.instances === instances && b.ours);

        return `${instances} instances ${block?.ours.renderMode ?? 'not reported'}`;
    });
    const told = modes.some((text) => !text.endsWith('not reported'));

    return told
        ? `render mode of ours, asked for as ${renderMode}: ${modes.join(', ')}`
        : `render mode of ours, asked for as ${renderMode}: the runtime reports none, so it has one render path`;
}

/**
 * Prints the tables of one rig in the A/B mode: the times of every side per instance count, the
 * render mode ours drew in, and the memory with its split.
 *
 * @param memory The memory readings of the rig, see `measureSides` of scripts/bench/heap.mjs.
 * @param config `counts` are the instance counts of the run and `renderMode` what ours was asked for.
 * @returns Per instance count the combined runs of `ours`, `official` and `mesh`.
 */
export function reportAb(blocks, memory, { counts, renderMode }) {
    const groups = counts.map((instances) => ({
        instances,
        ours: combined(blocks, (b) => b.side === 'ours' && b.instances === instances),
        official: combined(blocks, (b) => b.side === 'official' && b.instances === instances),
        mesh: combined(blocks, (b) => b.side === 'mesh' && b.instances === instances),
    }));
    const largest = Math.max(...counts);
    const covered = (side, instances) =>
        blocks.find((b) => b.side === side && b.instances === instances && b.run === 0)?.covered;

    addMemory(groups, memory);
    printAb(groups);
    console.log(`    ${describeRenderMode(blocks, counts, renderMode)}`);
    const split = describeSplit(memory.filter((reading) => reading.instances === largest));

    if (split.length > 0) console.log(`    heap of an instance among ${largest}, in KB:`);
    for (const line of split) console.log(`      ${line}`);
    if (describeEmpty(memory)) console.log(`    ${describeEmpty(memory)}`);
    for (const instances of counts) {
        const [a, b] = [covered('ours', instances), covered('official', instances)];

        // the two sides should draw the same picture. A gap is a hint, not a pixel check
        if (a && b && Math.abs(a - b) / Math.max(a, b) > 0.1) {
            console.log(
                `    note: with ${instances} instances ours covers ${a} px of the proof picture and official ${b} px`,
            );
        }
    }

    return groups;
}

/**
 * Prints the tables of one rig in the overdraw mode: per instance count the settings of
 * `tightMesh` side by side, and whether the frame is bound by fill.
 *
 * @param config `counts` are the instance counts, `runs` the runs of the bench and `names` the
 * names of the settings, `off` first.
 */
export function reportOverdraw(blocks, { counts, runs, names }) {
    return counts.map((instances) => {
        const good = (block) => block.instances === instances && !blockFailure(block);
        const rows = names
            .map((name) => ({
                name,
                ...combined(blocks, (b) => b.setting === name && b.instances === instances),
                changes: changesAgainstOff(blocks.filter(good), name, runs),
            }))
            .filter((row) => row.render);
        const shares = changesAgainstOff(blocks.filter(good), 'quarter', runs).map((change) => change + 1);
        const fill = { instances, settings: rows, quarter: null };

        if (rows.length === 0) return fill;
        if (counts.length > 1) console.log(`    ${instances} instances`);
        printOverdraw(rows);
        if (shares.length > 0) {
            const share = quantile(shares, 0.5);
            const percent = (value) => `${(100 * value).toFixed(0)}%`;

            fill.quarter = { share, shares, fillBound: share < FILL_BOUND };
            console.log(
                `    off at half the size, a quarter of the pixels: ${percent(share)} of the render time of off ` +
                    `(${percent(Math.min(...shares))} to ${percent(Math.max(...shares))}). ` +
                    `The frame is ${fill.quarter.fillBound ? '' : 'not '}bound by fill`,
            );
        }

        return fill;
    });
}
