import type { SpineVersion } from '../../src/core';
import { type ClippedTriangles, createClippedTriangles, TriangleClipper } from '../../src/geometry/clip-triangles';
import { Triangulator } from '../../src/geometry/triangulator';
import { type OfficialClip, officialClip } from './clip-official';
import { checkVerdict, type VerdictTally } from './clip-verdict';
import { Problems } from './geometry-compare';

/*
 * Compares the CPU clip kernel with the official `SkeletonClipping` of a version. Both get the
 * same input: the polygon as the official `clipStart` shaped it, in 64 bits, and positions and
 * texture coordinates in 32 bits. The parts of the polygon must be the same 64-bit numbers. The
 * clipped positions and texture coordinates must have the same bits once stored in 32-bit arrays,
 * where a number that is none equals any other that is none. The indices must be the same.
 *
 * Every slot is clipped three ways: appended to an output that is large already, into an output
 * that starts empty and grows while the kernel stops and goes on, and from input arrays with
 * offsets and strides.
 *
 * The verdict of the kernel about every slot is held against what both clippers write, see
 * clip-verdict.ts.
 */

/** The triangles of one slot, as a renderer holds them. */
export interface ClipSlot {
    /** x, y per vertex. */
    positions: Float32Array;
    /** u, v per vertex. */
    uvs: Float32Array;
    /** Three vertex numbers per triangle. */
    triangles: Uint16Array;
}

/** A clip polygon in world space with its 4.3 flags, and the slots it cuts. */
export interface ClipCase {
    /** x, y per vertex, in any winding. */
    polygon: ArrayLike<number>;
    inverse: boolean;
    convex: boolean;
    slots: ClipSlot[];
}

/** What a checker has seen, for the tests that want to know what was reached. */
export interface ClipTally {
    cases: number;
    /** Polygons the clipper cut into more than one part. */
    decomposed: number;
    /** Triangles that went into the kernel. */
    triangles: number;
    /** Vertices and indices the kernel left. */
    vertices: number;
    indices: number;
    /** The bounds of the kernel for the same slots. */
    vertexBound: number;
    indexBound: number;
    /** Triangles that left more vertices or indices than the bound for one triangle. */
    pastBound: number;
    /** The most vertices a triangle left past its bound. */
    pastBy: number;
    /** Triangles that left as many vertices as the bound for one triangle. */
    atBound: number;
    /** Times the kernel stopped for a full output and went on after it grew. */
    stops: number;
    /** Polygons of two vertices: vertices without a triangle. */
    slivers: number;
}

/** Where the spread copies of a slot start, and how far their vertices are apart. */
const POSITION_AT = 3;
const POSITION_STRIDE = 5;
const UV_AT = 1;
const UV_STRIDE = 3;
const INDEX_AT = 2;

/** A slot again with gaps: offsets, strides and indices that do not start at 0. */
function spread(slot: ClipSlot): ClipSlot {
    const vertices = slot.positions.length >> 1;
    const positions = new Float32Array(POSITION_AT + vertices * POSITION_STRIDE).fill(7e7);
    const uvs = new Float32Array(UV_AT + vertices * UV_STRIDE).fill(-7e7);
    const triangles = new Uint16Array(INDEX_AT + slot.triangles.length).fill(1);

    for (let i = 0; i < vertices; i++) {
        positions.set(slot.positions.subarray(i * 2, i * 2 + 2), POSITION_AT + i * POSITION_STRIDE);
        uvs.set(slot.uvs.subarray(i * 2, i * 2 + 2), UV_AT + i * UV_STRIDE);
    }
    triangles.set(slot.triangles, INDEX_AT);

    return { positions, uvs, triangles };
}

/** Compares the kernel with the official clipper of one version, case by case. */
export class ClipChecker {
    readonly problems: Problems = new Problems();
    readonly tally: ClipTally = {
        cases: 0,
        decomposed: 0,
        triangles: 0,
        vertices: 0,
        indices: 0,
        vertexBound: 0,
        indexBound: 0,
        pastBound: 0,
        pastBy: 0,
        atBound: 0,
        stops: 0,
        slivers: 0,
    };
    /** How often each verdict was heard. */
    readonly verdicts: VerdictTally = { nothing: 0, whole: 0, cut: 0, missedNothing: 0, missedWhole: 0 };
    readonly clipper: TriangleClipper = new TriangleClipper();
    readonly version: SpineVersion;
    private readonly official: OfficialClip;
    private readonly triangulator: Triangulator = new Triangulator();
    /** The output every slot of a case is appended to. */
    private readonly large: ClippedTriangles = createClippedTriangles(4096, 16384);
    /** The output of one triangle at a time. */
    private readonly single: ClippedTriangles = createClippedTriangles(64, 192);

    constructor(version: SpineVersion) {
        this.version = version;
        this.official = officialClip(version);
    }

    /**
     * Sets the polygon of a case in both clippers and compares the parts. Returns the triangles
     * of the ear clipping of the shaped polygon.
     */
    start(where: string, { polygon, inverse, convex }: ClipCase): Int32Array {
        const { official, clipper, triangulator, problems } = this;

        official.end();
        official.start(polygon, inverse, convex);
        const shaped = official.shaped();
        const indexCount = triangulator.triangulate(shaped, shaped.length >> 1);
        const parts = official.parts();

        clipper.start(this.version, shaped, shaped.length >> 1, triangulator.triangles, indexCount, inverse, convex);
        problems.same(`${where} parts`, clipper.parts.count, parts.length);
        parts.forEach((part, index) => {
            const from = clipper.parts.starts[index] ?? 0;
            const to = clipper.parts.starts[index + 1] ?? 0;

            problems.equal(`${where} part ${index}`, clipper.parts.vertices.slice(from, to), part);
        });
        if (parts.length > 1) this.tally.decomposed++;

        return triangulator.triangles.slice(0, indexCount);
    }

    /**
     * Sets the polygon of a case in the official clipper, and in the kernel as one that only moved
     * since the last start: with the triangles of that start. Returns whether the kernel has the
     * parts of the official clipper.
     */
    restart({ polygon, inverse, convex }: ClipCase, triangles: Int32Array): boolean {
        const { official, clipper } = this;

        official.end();
        official.start(polygon, inverse, convex);
        const shaped = official.shaped();
        const parts = official.parts();

        clipper.start(this.version, shaped, shaped.length >> 1, triangles, triangles.length, inverse, convex, true);
        const { starts, vertices } = clipper.parts;

        return (
            clipper.parts.count === parts.length &&
            parts.every((part, index) => {
                const ours = vertices.subarray(starts[index] ?? 0, starts[index + 1] ?? 0);

                return ours.length === part.length && part.every((value, i) => Object.is(ours[i], value));
            })
        );
    }

    /** Asks the kernel for its verdict about a slot, with and without gaps, and holds it against both outputs. */
    private judge(where: string, slot: ClipSlot, apart: ClipSlot, kernel: ClippedTriangles, inverse: boolean): void {
        const { clipper, problems, official } = this;
        const count = slot.triangles.length;
        const said = clipper.verdict(slot.positions, 0, 2, slot.triangles, 0, count);
        const written = {
            positions: kernel.positions.slice(0, kernel.vertexCount * 2),
            uvs: kernel.uvs.slice(0, kernel.vertexCount * 2),
            indices: kernel.indices.slice(0, kernel.indexCount),
        };

        problems.same(
            `${where} verdict with offsets and strides`,
            clipper.verdict(apart.positions, POSITION_AT, POSITION_STRIDE, apart.triangles, INDEX_AT, count),
            said,
        );
        checkVerdict(problems, this.verdicts, where, said, slot, written, official.read(), inverse);
    }

    /** Clips a slot in the kernel until every triangle is taken. Returns how often the output was full. */
    private clip(slot: ClipSlot, out: ClippedTriangles, spreadOut: boolean): number {
        const { clipper } = this;
        const base = out.vertexCount;
        const count = slot.triangles.length - (spreadOut ? INDEX_AT : 0);
        let done = 0;
        let stops = 0;

        for (;;) {
            done += spreadOut
                ? clipper.clip(
                      slot.positions,
                      POSITION_AT,
                      POSITION_STRIDE,
                      slot.uvs,
                      UV_AT,
                      UV_STRIDE,
                      slot.triangles,
                      INDEX_AT + done,
                      count - done,
                      out,
                      base,
                  )
                : clipper.clip(slot.positions, 0, 2, slot.uvs, 0, 2, slot.triangles, done, count - done, out, base);
            if (done >= count) return stops;
            clipper.grow(out);
            stops++;
        }
    }

    /** What one run of the kernel appended to an output, against the official result. */
    private compare(where: string, out: ClippedTriangles, vertexAt: number, indexAt: number): void {
        const { problems, official } = this;
        const expected = official.read();
        const positions = out.positions.slice(vertexAt * 2, out.vertexCount * 2);
        const uvs = out.uvs.slice(vertexAt * 2, out.vertexCount * 2);
        const indices = Uint16Array.from(out.indices.subarray(indexAt, out.indexCount));

        problems.equal(`${where} positions`, positions, expected.positions);
        problems.equal(`${where} uvs`, uvs, expected.uvs);
        problems.equal(`${where} indices`, indices, expected.indices);
    }

    /** Clips every triangle of a slot alone and holds what it leaves against the bounds for one triangle. */
    private bound(slot: ClipSlot): void {
        const { tally, clipper, single } = this;
        const { positions, uvs, triangles } = slot;

        for (let at = 0; at + 3 <= triangles.length; at += 3) {
            single.vertexCount = 0;
            single.indexCount = 0;
            while (clipper.clip(positions, 0, 2, uvs, 0, 2, triangles, at, 3, single, 0) < 3) clipper.grow(single);
            if (single.vertexCount > clipper.vertexBound(1) || single.indexCount > clipper.indexBound(1)) {
                tally.pastBound++;
                tally.pastBy = Math.max(tally.pastBy, single.vertexCount - clipper.vertexBound(1));
            }
            if (single.vertexCount === clipper.vertexBound(1)) tally.atBound++;
        }
    }

    /** Counts what the kernel left for a slot. */
    private count(slot: ClipSlot, out: ClippedTriangles): void {
        const { tally, clipper } = this;
        const triangles = Math.ceil(slot.triangles.length / 3);
        const used = new Uint8Array(out.vertexCount);

        for (const index of out.indices.subarray(0, out.indexCount)) used[index] = 1;
        tally.triangles += triangles;
        tally.vertices += out.vertexCount;
        tally.indices += out.indexCount;
        tally.vertexBound += clipper.vertexBound(triangles);
        tally.indexBound += clipper.indexBound(triangles);
        // only a polygon of two vertices leaves vertices that no triangle uses
        tally.slivers += used.reduce((sum, mark) => sum + 1 - mark, 0) / 2;
        this.bound(slot);
    }

    /**
     * Clips every slot of a case in both clippers and compares. Returns whether the case added
     * no problem.
     */
    check(where: string, clipCase: ClipCase): boolean {
        const { problems, official, large, tally } = this;
        const before = problems.lines.length;

        this.start(where, clipCase);
        tally.cases++;
        large.vertexCount = 0;
        large.indexCount = 0;
        clipCase.slots.forEach((slot, index) => {
            const at = `${where} slot ${index}`;
            const vertexAt = large.vertexCount;
            const indexAt = large.indexCount;
            const small = createClippedTriangles(0, 0);
            const apart = createClippedTriangles(1, 3);
            const gapped = spread(slot);

            official.run(slot.positions, slot.uvs, Array.from(slot.triangles));
            tally.stops += this.clip(slot, large, false);
            this.compare(at, large, vertexAt, indexAt);
            tally.stops += this.clip(slot, small, false);
            this.compare(`${at} from an empty output`, small, 0, 0);
            tally.stops += this.clip(gapped, apart, true);
            this.compare(`${at} with offsets and strides`, apart, 0, 0);
            this.judge(at, slot, gapped, small, this.clipper.parts.inverse);
            this.count(slot, small);
        });
        official.end();

        return problems.lines.length === before;
    }
}
