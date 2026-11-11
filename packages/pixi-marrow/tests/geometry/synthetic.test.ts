import { beforeAll, describe, expect, it } from 'vitest';
import { SPINE_VERSIONS } from '../../src/base/version';
import {
    checkAnimations,
    checkDrawables,
    checkSetupPoses,
    type GeometryRig,
    loadGeometryRig,
} from '../parity/geometry-check';
import type { OfficialShown } from '../parity/geometry-official';
import { syntheticRig } from './synthetic';

/*
 * The parity checks on a rig made for what the official examples lack. Every rotation of an atlas
 * region, whole and trimmed, is shown by a region attachment and by a mesh. Sequences have a setup
 * index and keys past their end. Linked meshes show other regions than their sources.
 */

/** The regions of the flame sequence. */
const FLAME_COUNT = 3;

/** Names the cases of the rig that a compared attachment stands for. */
function casesOf(shown: OfficialShown): string[] {
    const { name } = shown.ref;
    const flame = name.startsWith('flame');
    const checks: [string, boolean][] = [
        ['sequence at its setup index', flame && shown.sequenceIndex === -1],
        ['sequence index past the end', flame && shown.sequenceIndex >= FLAME_COUNT],
        ['deformed linked mesh', name.includes('linked') && shown.deform.length > 0],
        ['deformed mesh linked across slots', name === 'cross-slot' && shown.deform.length > 0],
        ['weighted bounding box', name === 'box-weighted'],
        [`${shown.type}`, true],
    ];

    return checks.filter(([, reached]) => reached).map(([label]) => label);
}

describe.each(SPINE_VERSIONS)('geometry of the synthetic rig as Spine %s', (version) => {
    let rig: GeometryRig;

    beforeAll(async () => {
        rig = await loadGeometryRig(syntheticRig(version));
    });

    it('is read as the version it claims', () => {
        expect(rig.model.version).toBe(version);
        expect(rig.official.version).toBe(version);
    });

    it('computes the regions, offsets and UVs the official loader holds', () => {
        expect(checkDrawables(rig)).toEqual([]);
    });

    it('places the vertices of every animation where the official runtime places them', () => {
        const reached = new Set<string>();

        expect(checkAnimations(rig, (shown) => casesOf(shown).forEach((label) => reached.add(label)))).toEqual([]);
        expect([...reached].sort()).toEqual([
            'clipping',
            'deformed linked mesh',
            // only a 4.3 file can link a mesh to a mesh of another slot
            ...(version === '4.3' ? ['deformed mesh linked across slots'] : []),
            'mesh',
            'path',
            'region',
            'sequence at its setup index',
            'sequence index past the end',
        ]);
    });

    it('places every attachment of every skin in the setup pose where the official runtime places it', () => {
        const reached = new Set<string>();

        expect(checkSetupPoses(rig, (shown) => casesOf(shown).forEach((label) => reached.add(label)))).toEqual([]);
        expect([...reached].sort()).toEqual([
            'boundingbox',
            'clipping',
            'mesh',
            'path',
            'region',
            'sequence at its setup index',
            'weighted bounding box',
        ]);
    });
});
