import { describe, expect, it } from 'vitest';
import { ClipChecker } from '../parity/clip-check';
import { clipFixtures, walkClips } from '../parity/clip-fixtures';
import { readFixture } from '../parity/fixtures';
import { loadGeometryRig } from '../parity/geometry-check';

/*
 * The CPU clip kernel against the official `SkeletonClipping` on every fixture with a clipping
 * attachment. The official core plays the animations, so the clip polygon moves, and both
 * clippers get the official polygon and the official vertices of every frame.
 */

const fixtures = await clipFixtures();

/** Whether a fixture is an official example. What a rig of your own shows is not known here. */
const isOfficial = (id: string): boolean => !id.startsWith('local/');

describe('the official fixtures with a clipping attachment', () => {
    it('are the coin, spineboy and the tank, as JSON and binary, in each version', () => {
        const rigs = fixtures.filter((fixture) => isOfficial(fixture.id)).map((fixture) => fixture.rig);

        expect(rigs.sort()).toEqual(
            ['coin-pro', 'spineboy-pro', 'tank-pro'].flatMap((rig) => Array<string>(6).fill(rig)),
        );
    });
});

describe.each(fixtures)('clipping of $id', (fixture) => {
    it('leaves the vertices and indices of the official clipper in every frame', async () => {
        const rig = await loadGeometryRig(readFixture(fixture));
        const cut = new ClipChecker(rig.model.version);
        const rest = new ClipChecker(rig.model.version);

        walkClips(rig, (clip) => {
            if (!cut.problems.full) cut.check(clip.where, clip.cut);
            if (!rest.problems.full) rest.check(`${clip.where} other slots`, clip.rest);
        });
        expect(cut.problems.lines).toEqual([]);
        expect(rest.problems.lines).toEqual([]);
        expect(cut.tally.pastBound + rest.tally.pastBound).toBe(0);
        if (!isOfficial(fixture.id)) return;
        // a clip is shown in several frames, and it cuts triangles: some stay whole, some do not
        expect(cut.tally.cases).toBeGreaterThanOrEqual(12);
        expect(cut.tally.triangles).toBeGreaterThan(0);
        expect(cut.tally.vertices + rest.tally.vertices).toBeGreaterThan(200);
        expect(cut.tally.vertices).not.toBe(cut.tally.triangles * 3);
        // The verdict was held against both outputs for every slot. For spineboy it settles
        // nearly every slot the clip cuts without clipping, for the tank many of the other slots
        const settled = cut.verdicts.nothing + cut.verdicts.whole;

        if (fixture.rig === 'spineboy-pro') expect(settled).toBeGreaterThan(cut.verdicts.cut * 50);
        if (fixture.rig === 'tank-pro') expect(rest.verdicts.nothing + rest.verdicts.whole).toBeGreaterThan(2000);
    });
});
