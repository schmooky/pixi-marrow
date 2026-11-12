import { describe, expect, it } from 'vitest';
import { SPINE_VERSIONS } from '../../src/core';
import { type BenchLoad, describeResult, timeLoad } from '../parity/clip-bench';
import type { ClipCase } from '../parity/clip-check';
import { clipFixtures, walkClips } from '../parity/clip-fixtures';
import { clusterCase, random, randomCase } from '../parity/clip-random';
import { readFixture } from '../parity/fixtures';
import { loadGeometryRig } from '../parity/geometry-check';

/*
 * The timing of the CPU clip kernel against the official clipper. It is not a check and does not
 * run with the tests. Run it alone, with nothing else busy:
 *
 *     MARROW_CLIP_BENCH=1 pnpm exec vitest run tests/geometry/clip-triangles-bench.test.ts --silent=false
 */

const ROUNDS = 7;
/** The run takes about a minute and a half. */
const TIMEOUT = 600_000;

/** The clips of the binary fixtures: the slots each clip cuts, and all other slots that draw. */
async function fixtureLoads(): Promise<BenchLoad[]> {
    const loads: BenchLoad[] = [];

    for (const fixture of (await clipFixtures()).filter((candidate) => candidate.format === 'binary')) {
        const rig = await loadGeometryRig(readFixture(fixture));
        const cut: ClipCase[] = [];
        const rest: ClipCase[] = [];

        walkClips(rig, (clip) => {
            cut.push(clip.cut);
            rest.push(clip.rest);
        });
        loads.push({ name: `${fixture.rig} cut slots`, version: fixture.version, cases: cut });
        loads.push({ name: `${fixture.rig} other slots`, version: fixture.version, cases: rest });
    }

    return loads;
}

/** The random cases of the parity tests of one seed: triangles of every kind, and slots of triangles close together. */
function randomLoads(): BenchLoad[] {
    return SPINE_VERSIONS.flatMap((version) => {
        const next = random(1);
        const mixed = Array.from({ length: 1500 }, () => randomCase(next).clipCase);
        const clusters = Array.from({ length: 1500 }, () => clusterCase(next).clipCase);

        return [
            { name: 'random cases', version, cases: mixed },
            { name: 'random clusters', version, cases: clusters },
        ];
    });
}

describe.runIf(process.env.MARROW_CLIP_BENCH === '1')('TriangleClipper against the official clipper, timed', () => {
    it(
        'prints nanoseconds per triangle for the fixtures and for the random cases',
        async () => {
            const results = [...(await fixtureLoads()), ...randomLoads()].map((load) => timeLoad(load, ROUNDS));

            for (const result of results) console.log(describeResult(result));
            expect(results.length).toBeGreaterThan(0);
        },
        TIMEOUT,
    );
});
