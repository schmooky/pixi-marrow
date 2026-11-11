import { beforeAll, describe, expect, it } from 'vitest';
import { listFixtures, readFixture } from './fixtures';
import { checkAnimations, checkDrawables, checkSetupPoses, type GeometryRig, loadGeometryRig } from './geometry-check';

/*
 * Geometry parity on every fixture: the kernels of src/geometry against the official core of the
 * fixture's version. See geometry-check.ts for what is compared and the one difference it allows.
 */
describe.each(listFixtures())('geometry of $id', (fixture) => {
    let rig: GeometryRig;

    beforeAll(async () => {
        rig = await loadGeometryRig(readFixture(fixture));
    });

    it('computes the regions, offsets and UVs the official loader holds', () => {
        expect(checkDrawables(rig)).toEqual([]);
    });

    it('places the vertices of every animation where the official runtime places them', () => {
        expect(checkAnimations(rig)).toEqual([]);
    });

    it('places every attachment of every skin in the setup pose where the official runtime places it', () => {
        expect(checkSetupPoses(rig)).toEqual([]);
    });
});
