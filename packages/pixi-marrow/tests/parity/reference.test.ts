import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS, sniffSkeleton } from '../../src/core';
import { type Fixture, listFixtures, readFixture } from './fixtures';
import { loadOfficial } from './official';
import { allFinite, checksum, pickSkin, recordReference } from './reference';

const fixtures = listFixtures();
/** Every animation is recorded for this many steps of this length. */
const FRAMES = 24;
const DT = 1 / 30;

describe('fixtures', () => {
    it('cover every supported version in both formats', () => {
        for (const version of SPINE_VERSIONS) {
            for (const format of ['json', 'binary']) {
                const found = fixtures.some((fixture) => fixture.version === version && fixture.format === format);

                expect(found, `${version} ${format}`).toBe(true);
            }
        }
    });
});

describe.each(fixtures)('$id', (fixture) => {
    it('is sniffed as its version and format', () => {
        const { skeleton } = readFixture(fixture);

        expect(sniffSkeleton(skeleton)).toMatchObject({ version: fixture.version, format: fixture.format });
    });

    it('gives a finite, repeatable reference for every animation', () => {
        const rig = loadOfficial(fixture.version, readFixture(fixture));
        const options = { frames: FRAMES, dt: DT, loop: true, skin: pickSkin(rig) };

        expect(rig.boneNames.length).toBeGreaterThan(0);
        expect(rig.animations.length).toBeGreaterThan(0);
        for (const { name } of rig.animations) {
            const first = recordReference(rig, name, options);

            expect(allFinite(first), name).toBe(true);
            expect(checksum(recordReference(rig, name, options)), name).toBe(checksum(first));
        }
    });
});

describe('the JSON and the binary export of one rig', () => {
    const pairs = fixtures
        .filter((fixture) => fixture.format === 'json')
        .flatMap((json) => {
            const binary = fixtures.find(
                (other) => other.format === 'binary' && other.version === json.version && other.rig === json.rig,
            );

            return binary ? [{ label: `${json.version}/${json.rig}`, json, binary }] : [];
        });
    const structure = (fixture: Fixture) => {
        const rig = loadOfficial(fixture.version, readFixture(fixture));

        return {
            bones: rig.boneNames,
            slots: rig.slotNames,
            skins: rig.skinNames,
            animations: rig.animations.map((animation) => animation.name),
            constraints: rig.constraintCount,
        };
    };

    it.each(pairs)('$label have the same structure', ({ json, binary }) => {
        expect(structure(binary)).toEqual(structure(json));
    });
});
