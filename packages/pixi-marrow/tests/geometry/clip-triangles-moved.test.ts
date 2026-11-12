import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS } from '../../src/core';
import { type ClipCase, ClipChecker } from '../parity/clip-check';
import { clipFixtures, walkClips } from '../parity/clip-fixtures';
import { movedPolygon, random, randomCase } from '../parity/clip-random';
import { readFixture } from '../parity/fixtures';
import { loadGeometryRig } from '../parity/geometry-check';

/*
 * `TriangleClipper.start` for a polygon that only moved: the parts are placed again and not cut
 * again. The reference is the official `clipStart` for the moved polygon, which cuts it anew.
 *
 * The official code decides on positions, not on the triangles alone: it merges triangles where
 * the winding of three vertices agrees. A move keeps those windings, except where three vertices
 * are on a line and rounding decides. So the parts of a moved polygon are the official ones for
 * a polygon without such vertices, and can be others for one with them.
 */

const sameNumbers = (a: Int32Array, b: Int32Array): boolean =>
    a.length === b.length && a.every((value, i) => value === b[i]);

/** Moves of one kind of polygon: all of them, those that changed the triangles, those that only changed the parts. */
interface Moves {
    all: number;
    otherTriangles: number;
    otherParts: number;
}

const caseOf = (polygon: number[], inverse = false): ClipCase => ({ polygon, inverse, convex: false, slots: [] });

/** Clockwise with y up, as the official clipper shapes a polygon. */
const SQUARE = [0, 0, 0, 10, 10, 10, 10, 0];
const ARROW = [0, 0, 10, 20, 20, 0, 10, 5];
const L_SHAPE = [0, 0, 0, 20, 10, 20, 10, 10, 20, 10, 20, 0];

describe.each(SPINE_VERSIONS)('TriangleClipper.start for a moved polygon in %s', (version) => {
    it('places the official parts again for polygons without three vertices on a line', () => {
        const checker = new ClipChecker(version);
        const next = random(21);
        const kinds = new Map<string, Moves>();

        for (let i = 0; i < 1500; i++) {
            const { label, clipCase } = randomCase(next);
            const kind = label.split(' ')[0] ?? '';
            const moves = kinds.get(kind) ?? { all: 0, otherTriangles: 0, otherParts: 0 };

            kinds.set(kind, moves);
            // a number that is none has no place to move to
            if (!Array.from(clipCase.polygon).every(Number.isFinite)) continue;
            for (let move = 0; move < 3; move++) {
                const triangles = checker.start(`case ${i}`, clipCase);
                const moved = { ...clipCase, polygon: movedPolygon(next, clipCase.polygon) };
                const same = checker.restart(moved, triangles);

                moves.all++;
                // the caller may only say moved when the triangles are the same
                if (!sameNumbers(checker.start(`case ${i} moved`, moved), triangles)) moves.otherTriangles++;
                else if (!same) moves.otherParts++;
            }
        }
        expect(checker.problems.lines).toEqual([]);
        for (const kind of ['star', 'convex', 'rectangle']) {
            expect(kinds.get(kind)?.all, kind).toBeGreaterThan(500);
            expect(kinds.get(kind), kind).toMatchObject({ otherTriangles: 0, otherParts: 0 });
        }
        // an L and a comb have vertices on a line: the same triangles, and still other parts
        expect(kinds.get('fixed')?.otherParts).toBeGreaterThan(20);
    });

    it('cuts again when the polygon has another vertex count or another flag than the last one', () => {
        const checker = new ClipChecker(version);
        const arrow = checker.start('arrow', caseOf(ARROW));
        const shape = checker.start('L', caseOf(L_SHAPE));

        expect(checker.problems.lines).toEqual([]);
        // the last polygon has six vertices: the arrow is no move of it
        expect(checker.restart(caseOf(ARROW), arrow)).toBe(true);
        // the same count with another flag is no move either
        expect(checker.restart(caseOf(ARROW, true), arrow)).toBe(true);
        expect(checker.restart({ ...caseOf(ARROW, true), convex: true }, arrow)).toBe(true);
        expect(checker.restart(caseOf(ARROW), arrow)).toBe(true);
        expect(checker.restart(caseOf(movedPolygon(random(3), ARROW)), arrow)).toBe(true);
        expect(checker.restart(caseOf(L_SHAPE), shape)).toBe(true);
        expect(checker.restart(caseOf(SQUARE), Int32Array.of(3, 0, 1, 3, 1, 2))).toBe(true);
        expect(checker.restart(caseOf(movedPolygon(random(4), SQUARE)), new Int32Array(6))).toBe(true);
    });
});

const fixtures = await clipFixtures();

describe.each(fixtures)('the moved clip polygons of $id', (fixture) => {
    it('get the official parts in every frame that keeps the triangles of the frame before', async () => {
        const rig = await loadGeometryRig(readFixture(fixture));
        const checkers = new Map<string, ClipChecker>();
        const last = new Map<string, Int32Array>();
        let moves = 0;
        let otherParts = 0;

        walkClips(rig, ({ key, rigid, where, cut }) => {
            if (!rigid) return;
            const checker = checkers.get(key) ?? new ClipChecker(rig.model.version);
            const before = last.get(key);
            // the kernel still holds the polygon of the frame before
            const same = before !== undefined && checker.restart(cut, before);
            const triangles = checker.start(where, cut);

            checkers.set(key, checker);
            last.set(key, triangles);
            if (before === undefined || !sameNumbers(triangles, before)) return;
            moves++;
            if (!same) otherParts++;
        });
        for (const checker of checkers.values()) expect(checker.problems.lines).toEqual([]);
        expect(otherParts).toBe(0);
        if (fixture.id.startsWith('local/')) return;
        // the polygon of the tank has weights. The coin and spineboy move theirs with one bone
        expect(moves > 5).toBe(fixture.rig !== 'tank-pro');
    });
});
