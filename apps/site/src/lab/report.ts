import type { DeviceInfo } from './device';
import type { RunSettings } from './lab';
import { type BlockTimes, median, quantile } from './measure';

/*
 * The result of a run: the numbers of every side, a verdict against the first side, and a text
 * that holds all of it for a chat or an issue. The last line of the text is the same result as
 * JSON, so a script can read it back.
 */

/** The numbers of one side over all of its blocks, in milliseconds per frame. */
export interface SideResult {
    name: string;
    /** The median of update plus submit plus wait, and its 95th percentile. */
    frame: number;
    p95: number;
    update: number;
    submit: number;
    wait: number;
    draws: number;
    /** The median frame of each round. */
    rounds: number[];
    /** How far the rounds lie apart, as a share of the median frame. */
    spread: number;
}

/** A whole run. */
export interface LabResult {
    /** The name of the test in the address, and its title. */
    test: string;
    title: string;
    question: string;
    scene: string;
    settings: RunSettings;
    count: number;
    device: DeviceInfo;
    /** The median frame of an empty stage. Every frame of a block holds about that much. */
    empty: number;
    /** Seconds the run took. */
    seconds: number;
    sides: SideResult[];
}

/** A share that the noise of a run never falls below, so that small steps do not count as a change. */
const LEAST_NOISE = 0.03;

/**
 * The numbers of a side from its blocks, one block per round.
 *
 * @example
 * const side = summarize('CPU batched', blocks);
 */
export function summarize(name: string, blocks: readonly BlockTimes[]): SideResult {
    const totals = (block: BlockTimes): number[] =>
        block.update.map((update, i) => update + (block.submit[i] ?? 0) + (block.wait[i] ?? 0));
    const frames = blocks.flatMap(totals);
    const rounds = blocks.map((block) => median(totals(block)));
    const frame = median(frames);
    const spread =
        rounds.length > 1
            ? (Math.max(...rounds) - Math.min(...rounds)) / frame
            : (quantile(frames, 0.75) - quantile(frames, 0.25)) / frame;

    return {
        name,
        frame,
        p95: quantile(frames, 0.95),
        update: median(blocks.flatMap((block) => block.update)),
        submit: median(blocks.flatMap((block) => block.submit)),
        wait: median(blocks.flatMap((block) => block.wait)),
        draws: Math.max(...blocks.map((block) => block.draws)),
        rounds,
        spread,
    };
}

/** A number of milliseconds with two decimals. */
const ms = (value: number): string => value.toFixed(2);

/** A count with its noun, as in 1 round and 3 rounds. */
export const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** A share as whole percent. */
const percent = (share: number): string => `${Math.round(share * 100)} percent`;

/** One sentence per side after the first: its frame against the frame of the first side. */
export function verdicts(result: LabResult): string[] {
    const [base, ...others] = result.sides;

    if (base === undefined) return [];

    return others.map((side) => {
        const ratio = side.frame / base.frame;
        const noise = Math.max(base.spread, side.spread, LEAST_NOISE);
        const word = ratio < 1 - noise ? 'Faster' : ratio > 1 + noise ? 'Slower' : 'About the same';

        return `${side.name}: ${ratio.toFixed(2)}x the frame time of ${base.name}. ${word}, with a spread of ${percent(noise)}.`;
    });
}

/** The result as text: what ran, where, the table of the sides, the verdicts and the JSON. */
export function resultText(result: LabResult): string {
    const { device } = result;
    const width = Math.max(4, ...result.sides.map((side) => side.name.length)) + 2;
    const head = ['side'.padEnd(width), 'frame', '  p95', 'update', 'submit', '  wait', 'draws', 'spread'];
    const rows = result.sides.map((side) =>
        [
            side.name.padEnd(width),
            ms(side.frame).padStart(5),
            ms(side.p95).padStart(5),
            ms(side.update).padStart(6),
            ms(side.submit).padStart(6),
            ms(side.wait).padStart(6),
            String(side.draws).padStart(5),
            `${Math.round(side.spread * 100)}%`.padStart(6),
        ].join(' '),
    );

    return [
        `pixi-marrow lab: ${result.test}`,
        result.question,
        result.scene,
        `Device: ${device.name}. ${device.gpu}.`,
        `Canvas ${device.canvas} at density ${device.canvasDensity} (screen ${device.screenDensity}), ${device.refresh} Hz.`,
        `Cores ${device.cores ?? 'unknown'}, memory ${device.memory === null ? 'unknown' : `${device.memory} GB`}, battery ${device.battery ?? 'unknown'}.`,
        `pixi.js ${device.pixi}, ${result.settings.renderer}. ${plural(result.settings.rounds, 'round')}, ${Math.round(result.seconds)} s. Empty frame ${ms(result.empty)} ms.`,
        '',
        'Milliseconds per frame, without vsync:',
        head.join(' '),
        ...rows,
        '',
        ...verdicts(result),
        '',
        JSON.stringify(result),
    ].join('\n');
}
