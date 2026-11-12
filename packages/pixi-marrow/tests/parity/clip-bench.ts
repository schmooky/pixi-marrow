import type { SpineVersion } from '../../src/core';
import { type ClippedTriangles, createClippedTriangles, TriangleClipper } from '../../src/geometry/clip-triangles';
import { Triangulator } from '../../src/geometry/triangulator';
import type { ClipCase, ClipSlot } from './clip-check';
import { type OfficialClip, officialClip } from './clip-official';

/*
 * Times the CPU clip kernel against the official `SkeletonClipping` in Node: nanoseconds per
 * triangle that goes in. Only the clipping of triangles is timed, not the shaping of the polygon.
 *
 * What is timed on the official side is the call its renderer makes. For 4.1 that call also
 * writes a color per vertex, and for 4.1 and 4.2 it leaves 64-bit numbers that the renderer
 * copies to 32-bit arrays afterwards, which is not timed. Our side stores 32-bit numbers.
 */

/** Cases to time together. */
export interface BenchLoad {
    name: string;
    version: SpineVersion;
    cases: ClipCase[];
}

/** What a load took. Times are nanoseconds per triangle, over all rounds. */
export interface BenchResult {
    name: string;
    version: SpineVersion;
    /** Triangles of all cases together. */
    triangles: number;
    /** Vertices and indices the kernel left for them. */
    vertices: number;
    indices: number;
    /** The bounds of the kernel for the same triangles. */
    vertexBound: number;
    indexBound: number;
    /** Nanoseconds per call of `start` of the kernel, which cuts the polygon into its parts. Fastest round. */
    startBest: number;
    /** Nanoseconds per call of `start` for a polygon that only moved. Fastest round. */
    movedBest: number;
    /** Slots of all cases together. */
    slots: number;
    /** Nanoseconds per slot for the verdict of the kernel and for clipping the slot. Fastest rounds. */
    verdictBest: number;
    clipBest: number;
    /** The fastest round and the median round of the official clipper. */
    officialBest: number;
    officialMedian: number;
    /** The fastest round and the median round of the kernel. */
    oursBest: number;
    oursMedian: number;
}

/** Triangles a case is repeated for, so that a timed stretch is long against the clock. */
const STRETCH = 1000;
/** How often `start` is repeated per case. */
const STARTS = 100;
const WARM_UP = 3;

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;

/** Both clippers and what a round of a load adds up. */
class Bench {
    officialTime = 0;
    oursTime = 0;
    startTime = 0;
    movedTime = 0;
    verdictTime = 0;
    /** Triangles clipped while the clock ran, per clipper. */
    work = 0;
    /** Slots clipped while the clock ran. */
    slotWork = 0;
    slots = 0;
    cases = 0;
    triangles = 0;
    vertices = 0;
    indices = 0;
    vertexBound = 0;
    indexBound = 0;
    private readonly official: OfficialClip;
    private readonly clipper: TriangleClipper = new TriangleClipper();
    private readonly triangulator: Triangulator = new Triangulator();
    private readonly out: ClippedTriangles = createClippedTriangles(1024, 4096);
    private readonly version: SpineVersion;

    constructor(version: SpineVersion) {
        this.version = version;
        this.official = officialClip(version);
    }

    /** Starts a round. */
    reset(): void {
        this.officialTime = 0;
        this.oursTime = 0;
        this.startTime = 0;
        this.movedTime = 0;
        this.verdictTime = 0;
        this.work = 0;
        this.slotWork = 0;
        this.slots = 0;
        this.cases = 0;
        this.triangles = 0;
        this.vertices = 0;
        this.indices = 0;
        this.vertexBound = 0;
        this.indexBound = 0;
    }

    /** Clips the slots of a case in the kernel, from an empty output. Returns whether all of them fit. */
    private clip(slots: readonly ClipSlot[]): boolean {
        const { clipper, out } = this;
        let fits = true;

        out.vertexCount = 0;
        out.indexCount = 0;
        for (const { positions, uvs, triangles } of slots) {
            const count = triangles.length;

            fits =
                clipper.clip(positions, 0, 2, uvs, 0, 2, triangles, 0, count, out, out.vertexCount) === count && fits;
        }

        return fits;
    }

    /** Sets the polygon of a case in both clippers, as the parity check does, and times the kernel. */
    private start({ polygon, inverse, convex }: ClipCase): void {
        const { official, clipper, triangulator, version } = this;

        official.start(polygon, inverse, convex);
        const shaped = official.shaped();
        const count = shaped.length >> 1;
        const indexCount = triangulator.triangulate(shaped, count);
        const { triangles } = triangulator;
        const start = performance.now();

        for (let repeat = 0; repeat < STARTS; repeat++) {
            clipper.start(version, shaped, count, triangles, indexCount, inverse, convex);
        }
        const middle = performance.now();

        // the same polygon again, as one that moved by nothing
        for (let repeat = 0; repeat < STARTS; repeat++) {
            clipper.start(version, shaped, count, triangles, indexCount, inverse, convex, true);
        }
        this.movedTime += performance.now() - middle;
        this.startTime += middle - start;
        this.cases++;
    }

    /** Times the verdict of the kernel about every slot of a case. */
    private judge(slots: readonly ClipSlot[], repeats: number): void {
        const { clipper } = this;
        const start = performance.now();
        let said = 0;

        for (let repeat = 0; repeat < repeats; repeat++) {
            for (const { positions, triangles } of slots) {
                said += clipper.verdict(positions, 0, 2, triangles, 0, triangles.length);
            }
        }
        this.verdictTime += performance.now() - start;
        // the verdicts are used, so that the calls are not optimized away
        this.slots += slots.length + (said < 0 ? 1 : 0);
        this.slotWork += slots.length * repeats;
    }

    /** Times one case in both clippers and adds it to the round. */
    time(clipCase: ClipCase): void {
        const { official, clipper, out } = this;
        const { slots } = clipCase;
        const count = slots.reduce((sum, slot) => sum + slot.triangles.length / 3, 0);
        const repeats = Math.max(1, Math.ceil(STRETCH / Math.max(count, 1)));
        // the official renderers hand the triangles over as plain arrays
        const plain = slots.map((slot) => Array.from(slot.triangles));

        this.start(clipCase);
        // the output must hold a whole case before the clock runs
        while (!this.clip(slots)) clipper.grow(out);
        this.vertices += out.vertexCount;
        this.indices += out.indexCount;
        this.vertexBound += clipper.vertexBound(count);
        this.indexBound += clipper.indexBound(count);
        this.triangles += count;
        this.work += count * repeats;
        this.judge(slots, repeats);
        const start = performance.now();

        for (let repeat = 0; repeat < repeats; repeat++) this.clip(slots);
        const middle = performance.now();

        for (let repeat = 0; repeat < repeats; repeat++) {
            slots.forEach(({ positions, uvs }, index) => {
                official.run(positions, uvs, plain[index] ?? []);
            });
        }
        this.officialTime += performance.now() - middle;
        this.oursTime += middle - start;
        official.end();
    }
}

/** Times every case of a load in both clippers, `rounds` times, after a warm-up. */
export function timeLoad(load: BenchLoad, rounds: number): BenchResult {
    const bench = new Bench(load.version);
    const officialRounds: number[] = [];
    const oursRounds: number[] = [];
    const startRounds: number[] = [];
    const movedRounds: number[] = [];
    const verdictRounds: number[] = [];
    const clipRounds: number[] = [];

    for (let round = -WARM_UP; round < rounds; round++) {
        bench.reset();
        for (const clipCase of load.cases) bench.time(clipCase);
        if (round < 0) continue;
        officialRounds.push((bench.officialTime * 1e6) / bench.work);
        oursRounds.push((bench.oursTime * 1e6) / bench.work);
        startRounds.push((bench.startTime * 1e6) / (bench.cases * STARTS));
        movedRounds.push((bench.movedTime * 1e6) / (bench.cases * STARTS));
        verdictRounds.push((bench.verdictTime * 1e6) / Math.max(bench.slotWork, 1));
        clipRounds.push((bench.oursTime * 1e6) / Math.max(bench.slotWork, 1));
    }

    return {
        name: load.name,
        version: load.version,
        triangles: bench.triangles,
        vertices: bench.vertices,
        indices: bench.indices,
        vertexBound: bench.vertexBound,
        indexBound: bench.indexBound,
        startBest: Math.min(...startRounds),
        movedBest: Math.min(...movedRounds),
        slots: bench.slots,
        verdictBest: Math.min(...verdictRounds),
        clipBest: Math.min(...clipRounds),
        officialBest: Math.min(...officialRounds),
        officialMedian: median(officialRounds),
        oursBest: Math.min(...oursRounds),
        oursMedian: median(oursRounds),
    };
}

/** One line of a result for the report. */
export function describeResult(result: BenchResult): string {
    const { name, version, triangles, vertices, indices, officialBest, officialMedian, oursBest, oursMedian } = result;
    const ns = (value: number): string => value.toFixed(1).padStart(7);
    const share = (used: number, bound: number): string => `${bound === 0 ? 0 : Math.round((used * 100) / bound)}%`;

    return [
        `${version} ${name.padEnd(24)}`,
        `${String(triangles).padStart(6)} triangles to ${String(vertices).padStart(6)} vertices`,
        `official ${ns(officialBest)} ns (median ${ns(officialMedian)})`,
        `ours ${ns(oursBest)} ns (median ${ns(oursMedian)})`,
        `${(officialBest / oursBest).toFixed(2)} times`,
        `bound used ${share(vertices, result.vertexBound)} of vertices ${share(indices, result.indexBound)} of indices`,
        `start ${result.startBest.toFixed(0)} ns, moved ${result.movedBest.toFixed(0)} ns`,
        `${result.slots} slots: verdict ${result.verdictBest.toFixed(1)} ns, clip ${result.clipBest.toFixed(1)} ns per slot`,
    ].join('  ');
}
