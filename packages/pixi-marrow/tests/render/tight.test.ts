import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS } from '../../src/base/version';
import { buildAtlasOutlines } from '../../src/geometry/outlines';
import type { AtlasOutlines } from '../../src/model/outlines';
import { meshSource } from '../../src/pose/shared/lookup';
import { listAtlasFixtures, loadAtlasFixture } from '../geometry/outline-checks';
import { DEGREES, regionName, syntheticRig } from '../geometry/synthetic';
import { cutView, outlineOf, PENTAGON, pageTextures, plainOutlines, pointsIn, readCutSlots, setPolygon } from './cuts';
import { createRig, type Drawable, fixtureFiles, meshes, play, type Rig, readDrawn, step, vertexData } from './rig';

/** The eight test regions of the synthetic rig: four rotations, whole and trimmed. */
const REGIONS = DEGREES.flatMap((degrees) => [regionName(degrees, false), regionName(degrees, true)]);

const pentagons = (outlines: AtlasOutlines): void => {
    for (const name of REGIONS) setPolygon(outlines, name, PENTAGON);
};

/** How many indices a slot has in a view that lays the named regions out as polygons of `corners` vertices. */
const sizesWith =
    (rig: Rig, polygons: readonly string[], corners: number) =>
    (_slot: number, attachment: Drawable): number => {
        if (attachment.type === 'mesh') return meshSource(rig.lookup, attachment).triangles.length;
        if (attachment.sequence !== null || !polygons.includes(attachment.path)) return 6;

        return (corners - 2) * 3;
    };

/** x, y of a vertex, and its texture coordinates. */
function vertex(rig: Rig, index: number): { x: number; y: number; u: number; v: number } {
    const { positions, statics } = vertexData(rig.view);

    return {
        x: positions[index * 2] ?? Number.NaN,
        y: positions[index * 2 + 1] ?? Number.NaN,
        u: statics[index * 3] ?? Number.NaN,
        v: statics[index * 3 + 1] ?? Number.NaN,
    };
}

/**
 * Where the quad of a slot puts a pair of texture coordinates: the quad maps the texture to the
 * world in an affine way, which three of its corners define. Returns the position and how far
 * along the two sides the point lies.
 */
function onQuad(quads: Rig, first: number, u: number, v: number): { x: number; y: number; a: number; b: number } {
    const origin = vertex(quads, first);
    const side = vertex(quads, first + 1);
    const base = vertex(quads, first + 3);
    const [su, sv, bu, bv] = [side.u - origin.u, side.v - origin.v, base.u - origin.u, base.v - origin.v];
    const det = su * bv - sv * bu;
    const a = ((u - origin.u) * bv - (v - origin.v) * bu) / det;
    const b = (su * (v - origin.v) - sv * (u - origin.u)) / det;

    return {
        x: origin.x + a * (side.x - origin.x) + b * (base.x - origin.x),
        y: origin.y + a * (side.y - origin.y) + b * (base.y - origin.y),
        a,
        b,
    };
}

/**
 * Checks the polygons of one rig against the quads of another rig in the same pose: every
 * polygon vertex must lie on the quad, where the quad has the texture coordinates of the vertex.
 * Returns how many polygons were checked.
 */
function expectOnQuads(tight: Rig, quads: Rig, polygons: readonly string[], corners: number): number {
    const quadSlots = readDrawn(quads);
    const tightSlots = readCutSlots(tight, sizesWith(tight, polygons, corners));
    let checked = 0;

    expect(tightSlots.map((item) => item.slot)).toEqual(quadSlots.map((item) => item.slot));
    tightSlots.forEach((item, i) => {
        const { attachment } = item;

        if (attachment.type !== 'region' || attachment.sequence !== null || !polygons.includes(attachment.path)) return;
        const name = tight.model.slots.names[item.slot];

        for (let corner = 0; corner < corners; corner++) {
            const point = vertex(tight, item.first + corner);
            const place = onQuad(quads, quadSlots[i]?.first ?? 0, point.u, point.v);

            expect(Math.hypot(point.x - place.x, point.y - place.y), `vertex ${corner} of ${name}`).toBeLessThan(1e-3);
            // inside the quad, or on its edge
            expect(Math.min(place.a, place.b, 1 - place.a, 1 - place.b), `vertex ${corner} of ${name}`).toBeGreaterThan(
                -1e-5,
            );
        }
        checked++;
    });

    return checked;
}

describe('polygons in place of quads', () => {
    it.each(SPINE_VERSIONS)(
        'lays the regions of a %s rig out as polygons on the map of their quads',
        async (version) => {
            const quads = await createRig(syntheticRig(version));
            const tight = await createRig(syntheticRig(version), undefined, cutView(pentagons, { tightMesh: 'on' }));

            play(quads, 'deform');
            play(tight, 'deform');
            for (let frame = 0; frame < 6; frame++) {
                step(quads, 0.15);
                step(tight, 0.15);
                expect(expectOnQuads(tight, quads, REGIONS, 5)).toBe(8);
            }
            // a pentagon has one vertex and one triangle more than a quad, and meshes stay as they are
            expect(tight.view.stats.vertices).toBe(quads.view.stats.vertices + 8);
            expect(tight.view.stats.indices).toBe(quads.view.stats.indices + 8 * 3);
            expect(tight.view.stats).toMatchObject({ tightRanges: 8, coveredSlots: 0, templateBuilds: 1 });
            expect(tight.view.stats.drawCalls).toBe(quads.view.stats.drawCalls);
            expect(quads.view.stats.tightRanges).toBe(0);
        },
    );

    it('gives a polygon vertex the texture coordinates of its point on the page', async () => {
        const tight = await createRig(syntheticRig('4.2'), undefined, cutView(pentagons, { tightMesh: 'on' }));
        const outlines = plainOutlines(tight.atlas);

        step(tight, 0);
        for (const item of readCutSlots(tight, sizesWith(tight, REGIONS, 5))) {
            const { attachment } = item;

            if (attachment.type !== 'region' || !REGIONS.includes(attachment.path)) continue;
            const points = pointsIn(outlineOf(outlines, attachment.path).rect, PENTAGON);

            for (let corner = 0; corner < 5; corner++) {
                const { u, v } = vertex(tight, item.first + corner);

                // page-a is 256 by 128 pixels
                expect(u).toBeCloseTo((points[corner * 2] ?? 0) / 256, 6);
                expect(v).toBeCloseTo((points[corner * 2 + 1] ?? 0) / 128, 6);
            }
            expect(item.triangles).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4]);
        }
    });

    it('keeps the quads by default, without outlines and with tightMesh off', async () => {
        const files = syntheticRig('4.2');
        const quads = await createRig(files);

        step(quads, 0);
        for (const options of [{}, { tightMesh: 'auto' }, { tightMesh: 'off' }] as const) {
            const rig = await createRig(files, undefined, cutView(pentagons, options));

            step(rig, 0);
            expect(rig.view.stats).toMatchObject({ vertices: quads.view.stats.vertices, tightRanges: 0 });
            readDrawn(rig);
        }
        // the option alone lays nothing out
        const bare = await createRig(files, undefined, {
            textures: pageTextures,
            options: () => ({ tightMesh: 'on' }),
        });

        step(bare, 0);
        expect(bare.view.stats.vertices).toBe(quads.view.stats.vertices);
    });

    it('keeps the quad of an attachment with a sequence', async () => {
        const flames = ['flame_08', 'flame_09', 'flame_10'];
        const quads = await createRig(syntheticRig('4.2'));
        const tight = await createRig(
            syntheticRig('4.2'),
            undefined,
            cutView(
                (outlines) => {
                    for (const name of flames) setPolygon(outlines, name, PENTAGON);
                },
                { tightMesh: 'on' },
            ),
        );

        play(tight, 'sequence');
        for (let frame = 0; frame < 8; frame++) step(tight, 0.15);
        expect(tight.view.stats).toMatchObject({ vertices: quads.view.stats.vertices, tightRanges: 0 });
        expect(tight.view.stats.uvUploads).toBeGreaterThan(1);
        readDrawn(tight);
    });

    it('draws nothing for a region without a visible pixel, and keeps its place in the draw order', async () => {
        const empty = (outlines: AtlasOutlines): void => {
            outlineOf(outlines, regionName(0, false)).polygon = [];
        };
        const quads = await createRig(syntheticRig('4.2'));

        step(quads, 0);
        // by default and with polygons. A mesh on the same region stays.
        for (const options of [{}, { tightMesh: 'on' }] as const) {
            const rig = await createRig(syntheticRig('4.2'), undefined, cutView(empty, options));

            step(rig, 0);
            expect(rig.view.stats.vertices).toBe(quads.view.stats.vertices - 4);
            expect(rig.view.stats.indices).toBe(quads.view.stats.indices - 6);
            expect(rig.view.stats).toMatchObject({ tightRanges: 1, drawCalls: quads.view.stats.drawCalls });
            const slots = readCutSlots(rig, (_slot, attachment) =>
                attachment.type === 'region' && attachment.path === regionName(0, false)
                    ? 0
                    : sizesWith(rig, [], 4)(_slot, attachment),
            );

            expect(
                slots.filter((item) => item.triangles.length === 0).map((item) => rig.model.slots.names[item.slot]),
            ).toEqual([`quad-${regionName(0, false)}`]);
        }
        const off = await createRig(syntheticRig('4.2'), undefined, cutView(empty, { tightMesh: 'off' }));

        step(off, 0);
        expect(off.view.stats).toMatchObject({ vertices: quads.view.stats.vertices, tightRanges: 0 });
    });

    it('measures the same bounds with polygons, with an empty region and with quads', async () => {
        const quads = await createRig(syntheticRig('4.3'));
        const tight = await createRig(
            syntheticRig('4.3'),
            undefined,
            cutView(
                (outlines) => {
                    pentagons(outlines);
                    outlineOf(outlines, regionName(180, true)).polygon = [];
                    // a polygon far inside its region: the box of its vertices is smaller than the quad
                    setPolygon(outlines, regionName(90, false), [0.4, 0.4, 0.6, 0.4, 0.5, 0.6]);
                },
                { tightMesh: 'on' },
            ),
        );

        play(quads, 'deform');
        play(tight, 'deform');
        for (let frame = 0; frame < 4; frame++) {
            step(quads, 0.2);
            step(tight, 0.2);
            const a = meshes(quads.view)[0]?.bounds;
            const b = meshes(tight.view)[0]?.bounds;

            expect([b?.minX, b?.minY, b?.maxX, b?.maxY]).toEqual([a?.minX, a?.minY, a?.maxX, a?.maxY]);
        }
    });

    it('needs outlines that keep the margin bilinear filtering takes', async () => {
        const quads = await createRig(syntheticRig('4.2'));
        const thin = await createRig(
            syntheticRig('4.2'),
            undefined,
            cutView(
                (outlines) => {
                    pentagons(outlines);
                    outlines.margin = 0.25;
                },
                { tightMesh: 'on' },
            ),
        );

        step(thin, 0);
        expect(thin.view.stats).toMatchObject({ vertices: quads.view.stats.vertices, tightRanges: 0 });
    });

    it('lays the regions of a real atlas out as the polygons of its pixels', async () => {
        const fixture = listAtlasFixtures().find((candidate) => candidate.id === '4.2/spineboy.atlas');

        if (fixture === undefined) throw new Error('no fixture 4.2/spineboy.atlas. Run: pnpm fixtures');
        const { atlas, pages } = await loadAtlasFixture(fixture);
        const outlines = buildAtlasOutlines(atlas, pages);
        const files = fixtureFiles('4.2/spineboy-pro.skel');
        const quads = await createRig(files);
        const tight = await createRig(files, undefined, {
            textures: pageTextures,
            options: () => ({ outlines, tightMesh: 'on' }),
        });
        const polygons = outlines.regions.flatMap((region) => (region?.polygon ? [region.name] : []));
        const corners = (path: string): number => (outlineOf(outlines, path).polygon?.length ?? 8) / 2;
        let checked = 0;

        play(quads, 'run');
        play(tight, 'run');
        for (let frame = 0; frame < 3; frame++) {
            step(quads, 0.1);
            step(tight, 0.1);
            const quadSlots = readDrawn(quads);
            const tightSlots = readCutSlots(tight, (_slot, attachment) =>
                attachment.type === 'region' && polygons.includes(attachment.path)
                    ? (corners(attachment.path) - 2) * 3
                    : sizesWith(tight, [], 4)(_slot, attachment),
            );

            tightSlots.forEach((item, i) => {
                const { attachment } = item;

                if (attachment.type !== 'region' || !polygons.includes(attachment.path)) return;
                for (let corner = 0; corner < corners(attachment.path); corner++) {
                    const point = vertex(tight, item.first + corner);
                    const place = onQuad(quads, quadSlots[i]?.first ?? 0, point.u, point.v);

                    expect(Math.hypot(point.x - place.x, point.y - place.y)).toBeLessThan(1e-3);
                    expect(Math.min(place.a, place.b, 1 - place.a, 1 - place.b)).toBeGreaterThan(-1e-5);
                }
                checked++;
            });
        }
        expect(checked).toBeGreaterThan(20);
        expect(tight.view.stats.tightRanges).toBeGreaterThan(5);
        expect(tight.view.stats.drawCalls).toBe(quads.view.stats.drawCalls);
    });
});
