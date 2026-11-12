import { SkeletonClipping as Clipping42, Triangulator as Triangulator42 } from 'spine-core-4.2';
import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS } from '../../src/base/version';
import { ClipShape } from '../../src/render/clip-shape';
import { clipAttachment, expectArea } from './clip-check';
import { officialClipper } from './clip-official';
import { around, bone, NO_DEFORM, placed, random, trianglesOf, WORLD, weighted } from './clip-shape-rig';

/*
 * The triangles `ClipShape` cuts once for a polygon that only moves with its bone, against the
 * triangles it cuts for every pose and against the official clipper. The helpers are in
 * `clip-shape-rig.ts`.
 */

describe.each(SPINE_VERSIONS)('the triangles ClipShape cuts once, as Spine %s', (version) => {
    it('are the triangles it cuts for the pose with reuse off, for every bone', () => {
        const next = random(11);
        const on = new ClipShape();
        const off = new ClipShape();
        let reversed = 0;
        let cut = 0;

        off.reuse = false;
        for (let i = 0; i < 80; i++) {
            const corners = 4 + Math.floor(next() * 30);
            const flags = { inverse: i % 8 === 1, convex: i % 8 === 2 };
            const attachment = clipAttachment('clip', -1, around(corners, next, i % 5 === 0, i % 3 !== 0), flags);

            for (let pose = 0; pose < 6; pose++) {
                const world = bone(next, pose % 2 === 1);
                const before = on.fixedIndices;

                on.compute(version, attachment, world, 0, NO_DEFORM, 0);
                off.compute(version, attachment, world, 0, NO_DEFORM, 0);
                expect(on.vertexCount).toBe(off.vertexCount);
                expect(on.inverse).toBe(off.inverse);
                expect(Array.from(on.polygon.subarray(0, on.vertexCount * 2))).toEqual(
                    Array.from(off.polygon.subarray(0, off.vertexCount * 2)),
                );
                expect(trianglesOf(on)).toEqual(trianglesOf(off));
                expect(off.fixedIndices).toBeNull();
                if (on.fixedIndices !== before) reversed++;
                if (off.triangles !== on.triangles) cut++;
            }
        }
        // a mirrored bone turns the vertex order around, which is another list of triangles
        expect(reversed).toBeGreaterThan(200);
        // most polygons are concave: ear clipping cut them. The others are fans, the same with reuse on and off
        expect(cut).toBeGreaterThan(version === '4.3' ? 150 : 400);
    });

    it('cover the area the official clipper keeps, under a bone that turns, shears and mirrors', () => {
        const next = random(12);
        const shape = new ClipShape();
        let kept = 0;
        let removed = 0;

        for (let i = 0; i < 60; i++) {
            const polygon = around(4 + Math.floor(next() * 30), next, false, i % 3 !== 0);
            const attachment = clipAttachment('clip', -1, polygon);

            for (let pose = 0; pose < 4; pose++) {
                const world = bone(next, pose % 2 === 1);
                const moved = placed(polygon, world);
                const clipper = officialClipper(version, 1);

                shape.compute(version, attachment, world, 0, NO_DEFORM, 0);
                expect(clipper.start(0, attachment, moved)).toBe(true);
                const samples = expectArea(
                    {
                        positions: shape.polygon.subarray(0, shape.vertexCount * 2),
                        triangles: trianglesOf(shape),
                        inverse: shape.inverse,
                    },
                    moved,
                    clipper,
                );

                clipper.end();
                kept += samples.kept;
                removed += samples.removed;
            }
        }
        expect(kept).toBeGreaterThan(10000);
        expect(removed).toBeGreaterThan(10000);
    });

    it('are one array per attachment and vertex order, for every shape object and every pose', () => {
        const next = random(13);
        const [first, second] = [new ClipShape(), new ClipShape()];
        const attachment = clipAttachment('clip', -1, around(19, next, false));
        const upright = bone(next, false);
        const mirrored = bone(next, true);

        first.compute(version, attachment, upright, 0, NO_DEFORM, 0);
        const { fixedIndices, triangles } = first;

        if (fixedIndices === null) throw new Error('a polygon without weights and deform has fixed indices');
        // 17 triangles are 51 numbers, and one 0 makes the count even
        expect(first.indexCount).toBe(51);
        expect(fixedIndices.length).toBe(52);
        expect(Array.from(fixedIndices)).toEqual([...trianglesOf(first), 0]);
        const copy = Array.from(fixedIndices);

        // another pose, and another shape object: the same arrays
        first.compute(version, attachment, bone(next, false), 0, NO_DEFORM, 0);
        second.compute(version, attachment, bone(next, false), 0, NO_DEFORM, 0);
        expect(first.fixedIndices).toBe(fixedIndices);
        expect(first.triangles).toBe(triangles);
        expect(second.fixedIndices).toBe(fixedIndices);
        // mirrored: the vertex order turns around, which has its own array
        first.compute(version, attachment, mirrored, 0, NO_DEFORM, 0);
        const turned = first.fixedIndices;

        expect(turned).not.toBe(fixedIndices);
        expect(turned?.length).toBe(52);
        // and back
        second.compute(version, attachment, upright, 0, NO_DEFORM, 0);
        first.compute(version, attachment, upright, 0, NO_DEFORM, 0);
        expect(first.fixedIndices).toBe(fixedIndices);
        first.compute(version, attachment, mirrored, 0, NO_DEFORM, 0);
        expect(first.fixedIndices).toBe(turned);
        // nothing wrote to the first array in between
        expect(Array.from(fixedIndices)).toEqual(copy);
        // an attachment with the same vertices is another attachment
        second.compute(version, clipAttachment('twin', -1, Array.from(attachment.vertices)), upright, 0, NO_DEFORM, 0);
        expect(second.fixedIndices).not.toBe(fixedIndices);
        expect(Array.from(second.fixedIndices ?? [])).toEqual(copy);
    });

    it('are cut for the pose where a deform or weights shape the polygon', () => {
        const next = random(14);
        const shape = new ClipShape();
        const polygon = around(12, next, false);
        const attachment = clipAttachment('clip', -1, polygon);
        const world = bone(next, false);
        const moved = placed(polygon, world);
        const clockwise = [...moved];

        Clipping42.makeClockwise(clockwise);
        const official = [...new Triangulator42().triangulate(clockwise)];

        shape.compute(version, attachment, world, 0, NO_DEFORM, 0);
        expect(shape.fixedIndices).not.toBeNull();
        expect(trianglesOf(shape)).toEqual(official);
        // a deform of the same vertices: the same polygon, cut anew
        shape.compute(version, attachment, world, 0, Float64Array.from(polygon), polygon.length);
        expect(shape.fixedIndices).toBeNull();
        expect(trianglesOf(shape)).toEqual(official);
        expect(Array.from(shape.polygon.subarray(0, polygon.length))).toEqual(clockwise);
        // weights: every vertex on bone 0 with weight 1
        shape.compute(version, weighted(polygon), world, 0, NO_DEFORM, 0);
        expect(shape.fixedIndices).toBeNull();
        expect(trianglesOf(shape)).toEqual(official);
        // and with reuse off
        shape.reuse = false;
        shape.compute(version, attachment, world, 0, NO_DEFORM, 0);
        expect(shape.fixedIndices).toBeNull();
        expect(trianglesOf(shape)).toEqual(official);
    });

    it('cover no area for a bone that flattens the polygon', () => {
        const next = random(15);
        const shape = new ClipShape();
        const polygon = around(15, next, false);
        const attachment = clipAttachment('clip', -1, polygon);

        // a coin that turns shows its edge: the scale along x is 0, then a number too small to matter
        for (const scale of [0, 1e-300, -1e-300]) {
            shape.compute(version, attachment, Float64Array.of(scale, 0, 0, 1, 5, 5), 0, NO_DEFORM, 0);
            expect(shape.indexCount).toBe(39);
            const xs = Array.from(shape.polygon.subarray(0, 30)).filter((_, at) => at % 2 === 0);

            expect(new Set(xs)).toEqual(new Set([5]));
        }
    });

    it(
        version === '4.3'
            ? 'are one fan per vertex count for convex polygons'
            : 'are cut by ear clipping for convex polygons',
        () => {
            const next = random(16);
            const shape = new ClipShape();
            const [seven, other] = [around(7, next, true), around(7, next, true)].map((polygon) =>
                clipAttachment('clip', -1, polygon),
            );

            if (seven === undefined || other === undefined) throw new Error('there are two polygons');
            shape.compute(version, seven, WORLD, 0, NO_DEFORM, 0);
            const fan = shape.fixedIndices;

            expect(Array.from(fan ?? [])).toEqual([...trianglesOf(shape), 0]);
            shape.compute(version, other, WORLD, 0, Float64Array.from(other.vertices), 14);
            // a fan does not depend on where the vertices are: a deformed polygon shares it too
            if (version === '4.3') expect(shape.fixedIndices).toBe(fan);
            else expect(shape.fixedIndices).toBeNull();
            shape.compute(version, clipAttachment('clip', -1, around(9, next, true)), WORLD, 0, NO_DEFORM, 0);
            expect(shape.fixedIndices).not.toBe(fan);
            expect(shape.fixedIndices?.length).toBe(22);
        },
    );
});
