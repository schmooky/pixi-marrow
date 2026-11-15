import data from '../../public/benchmarks.json';

/*
 * The numbers of the page `/benchmarks/`, from `public/benchmarks.json`. That file is one run of
 * `pnpm bench:ab`, made small by `scripts/bench-data.mjs`. The tables of the page read it while
 * the site builds, so the page and the file that it links always hold the same numbers.
 */

/** A time of a side in ms: the median over the runs, the fastest run and the slowest run. */
export type Time = [median: number, fastest: number, slowest: number];

/** One side of a block: a runtime, with what it did per frame. */
export interface BenchSide {
    side: string;
    renderMode?: string;
    updateMs: Time;
    cpuMs: Time;
    renderMs: Time;
    frameMs: Time;
    drawCalls: [least: number, most: number];
    uploadsPerFrame: number;
    uploadKBPerFrame: number;
    heapKBPerInstance: number | null;
}

/** The run as the file holds it. */
export const BENCH = data;

/** The names of the two runtimes and of the third side, as the file writes them. */
export const OURS = 'pixi-marrow';
export const OFFICIAL = 'spine-pixi-v8';
export const MESH = 'pixi-marrow, mesh mode';

/** A list of the file as a time. The file holds three numbers per time. */
const toTime = (values: readonly number[]): Time => [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];

/** A side as the file holds it. */
type RawSide = (typeof data)['renderers'][number]['rigs'][number]['blocks'][number]['sides'][number];

/** A side of the file with its times as tuples. */
function toSide(raw: RawSide): BenchSide {
    return {
        side: raw.side,
        ...('renderMode' in raw && raw.renderMode !== undefined ? { renderMode: raw.renderMode } : {}),
        updateMs: toTime(raw.updateMs),
        cpuMs: toTime(raw.cpuMs),
        renderMs: toTime(raw.renderMs),
        frameMs: toTime(raw.frameMs),
        drawCalls: [raw.drawCalls[0] ?? 0, raw.drawCalls[1] ?? 0],
        uploadsPerFrame: raw.uploadsPerFrame,
        uploadKBPerFrame: raw.uploadKBPerFrame,
        heapKBPerInstance: raw.heapKBPerInstance,
    };
}

/** One row of a table: a rig at an instance count, with the sides that ran. */
export interface BenchRow {
    rig: string;
    animation: string;
    instances: number;
    /** The share of the time before the rig in which other programs kept the GPU busy. */
    busy: number;
    sides: Map<string, BenchSide>;
}

/** The rows of one renderer and one scene, in the order of the run. */
export function benchRows(renderer: string, scene: string): BenchRow[] {
    const entry = BENCH.renderers.find((it) => it.renderer === renderer);

    return (entry?.rigs ?? [])
        .filter((rig) => rig.scene === scene)
        .flatMap((rig) =>
            rig.blocks.map((block) => ({
                rig: rig.rig,
                animation: rig.animation,
                instances: block.instances,
                busy: rig.gpuBusyBefore,
                sides: new Map(block.sides.map((side) => [side.side, toSide(side)])),
            })),
        );
}

/** A time as the tables show it: the median, and half the distance between the fastest and the slowest run. */
export function showTime(time: Time): string {
    return `${time[0].toFixed(3)} ±${((time[2] - time[1]) / 2).toFixed(3)}`;
}

/** True when the runs of two times overlap, so that their difference decides nothing. */
const overlap = (a: Time, b: Time): boolean => a[1] <= b[2] && b[1] <= a[2];

/** The first time divided by the second, with a note when the runs of the two overlap. */
export function showRatio(a: Time, b: Time): string {
    return `${(a[0] / b[0]).toFixed(2)}${overlap(a, b) ? ', not decided' : ''}`;
}

/** Draw calls per frame: one number, or the least and the most when the frames differ. */
export const showDraws = ([least, most]: [number, number]): string =>
    least === most ? String(least) : `${least} to ${most}`;

/** The day of the run, as `15 November 2026`. */
export function benchDay(): string {
    return new Date(BENCH.date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}
