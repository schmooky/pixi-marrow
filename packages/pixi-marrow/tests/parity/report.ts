import { expect, it } from 'vitest';
import { listFixtures, readFixture } from './fixtures';
import { loadOfficial } from './official';
import { checksum, pickSkin, recordReference } from './reference';

/*
 * `pnpm parity:ref`: one line per fixture with a checksum of the poses the official core gives.
 * The checksum changes when the fixture, the official core or the way the parity suite steps changes.
 */
const FRAMES = 24;
const DT = 1 / 30;

it('prints the reference of every fixture', () => {
    const rows = listFixtures().map((fixture) => {
        const rig = loadOfficial(fixture.version, readFixture(fixture));
        const options = { frames: FRAMES, dt: DT, loop: true, skin: pickSkin(rig) };
        const frames = rig.animations.flatMap(({ name }) => recordReference(rig, name, options));

        return [
            fixture.id,
            `${rig.boneNames.length} bones`,
            `${rig.slotNames.length} slots`,
            `${rig.constraintCount} constraints`,
            `${rig.animations.length} animations`,
            `${frames.length} frames`,
            checksum(frames),
        ];
    });
    const widths = rows.reduce<number[]>((max, row) => row.map((cell, i) => Math.max(max[i] ?? 0, cell.length)), []);

    for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  '));
    expect(rows.length).toBeGreaterThan(0);
});
