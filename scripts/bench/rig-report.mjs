/**
 * The tables of one rig of the bench, from the blocks its page measured and from its memory
 * readings. What a function here prints it also returns as data, for the JSON file of the run.
 */
import { addMemory, describeEmpty, describeSplit } from './heap.mjs';
import { changesAgainstOff, combine, ms, print, printAb, printOverdraw, quantile, summarize } from './table.mjs';

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
 * @returns Per instance count the combined runs of `ours`, `official`, `mesh` and `baked`.
 */
export function reportAb(blocks, memory, { counts, renderMode }) {
    const groups = counts.map((instances) => ({
        instances,
        ours: combined(blocks, (b) => b.side === 'ours' && b.instances === instances),
        official: combined(blocks, (b) => b.side === 'official' && b.instances === instances),
        mesh: combined(blocks, (b) => b.side === 'mesh' && b.instances === instances),
        idle: combined(blocks, (b) => b.side === 'idle' && b.instances === instances),
        gpu: combined(blocks, (b) => b.side === 'gpu' && b.instances === instances),
        alone: combined(blocks, (b) => b.side === 'alone' && b.instances === instances),
        baked: combined(blocks, (b) => b.side === 'baked' && b.instances === instances),
    }));
    const largest = Math.max(...counts);
    const covered = (side, instances) =>
        blocks.find((b) => b.side === side && b.instances === instances && b.run === 0)?.covered;

    addMemory(groups, memory);
    printAb(groups);
    console.log(`    ${describeRenderMode(blocks, counts, renderMode)}`);
    for (const instances of counts) {
        const block = blocks.find((b) => b.side === 'idle' && b.instances === instances && b.ours);

        if (!block) continue;
        const { shown = 0, bytes = 0 } = block.ours.idle ?? {};
        const each = shown > 0 ? `, ${(bytes / shown / 1024).toFixed(1)} KB of texture per image` : '';

        console.log(`    idle cache, ${instances} instances: ${shown} show an image after the warm-up${each}`);
    }
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

/**
 * The line that says what a subject of a run is: its rigs, what they play and what they are
 * measured against.
 *
 * @param versions The versions of the runtimes, as the JSON file of a run holds them.
 * @param mode `ab` or `overdraw`.
 */
export function describeSubject(subject, versions, mode) {
    const plays = [subject.plans]
        .flat()
        .map((plan) => {
            const [sequence] = plan.sequences;
            const { bones, slots, meshVertices } = plan.counts;
            const what = `${sequence.animation}${sequence.skin ? ` (${sequence.skin})` : ''}`;

            return `${plan.id} plays ${what}, ${bones} bones, ${slots} slots, ${meshVertices} mesh vertices`;
        })
        .join('. ');
    const { rig } = subject;
    const solves = [rig.physics && 'physics', rig.slider && 'a slider'].filter(Boolean).join(' and ');
    const against =
        mode === 'ab'
            ? `against spine-pixi-v8 ${versions[`spine-pixi-v8 for ${subject.official}`]}`
            : `${subject.counts.join(' and ')} instances cover the canvas`;

    return (
        `${mode === 'ab' ? `scene ${subject.scene}. ` : ''}${plays}, ${against}` +
        `${solves ? `. Has ${solves}: like for like only when both sides solve it` : ''}` +
        `${subject.note ? `. In this scene it ${subject.note}` : ''}`
    );
}

/**
 * Prints the scenes of a run side by side: per renderer and rig one row per scene, with the
 * update, the CPU time and the frame of ours and of the official runtime, and the uploads.
 * The last column is the update of ours as a share of its update in the scene `play`.
 *
 * @param result What the bench writes to its JSON file.
 */
export function reportScenes(result) {
    const pair = (a, b, text) => `${a ? text(a) : 'n/a'} and ${b ? text(b) : 'n/a'}`;

    console.log('bench: the scenes side by side, medians over the runs, ours and official');
    for (const { renderer, rigs } of result.renderers) {
        const rows = [
            [
                'rig',
                'scene',
                'n',
                'update ms',
                'cpu ms',
                'frame ms',
                'uploads per frame',
                'KB per frame',
                'update of play',
            ],
        ];

        for (const rig of rigs) {
            const group = rig.summary?.at(-1);
            const play = rigs.find((it) => it.id === rig.id && it.scene === 'play')?.summary?.at(-1);

            if (!group?.ours) continue;
            const { ours, official } = group;
            const share =
                play?.ours && rig.scene !== 'play'
                    ? `${((100 * ours.update.median) / play.ours.update.median).toFixed(1)}%`
                    : '';

            rows.push([
                rig.id.length > 28 ? `${rig.id.slice(0, 25)}...` : rig.id,
                rig.scene,
                group.instances,
                pair(ours, official, (side) => ms(side.update.median)),
                pair(ours, official, (side) => ms(side.cpu.median)),
                pair(ours, official, (side) => ms(side.frame.median)),
                pair(ours.uploads, official?.uploads, (runs) => runs.median.toFixed(1)),
                pair(ours.uploadBytes, official?.uploadBytes, (runs) => (runs.median / 1024).toFixed(1)),
                share,
            ]);
        }
        console.log(`  ${renderer}`);
        print(rows, [0, 1]);
    }
}
