import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPoseEngine, importSkeleton } from '../../src/core';
import { listFixtures, readFixture } from '../parity/fixtures';

/** Where the accepted bytes per instance are kept, next to the size baseline. */
export const BASELINE_PATH: string = fileURLToPath(new URL('../../../../ci/memory-baseline.json', import.meta.url));

/** How far over the baseline a fixture may go before the check fails. */
export const TOLERANCE = 0.1;

/**
 * The bytes one more instance of each official fixture costs: the typed arrays of its pose and of
 * its constraints, after every animation has played for a few updates so that deform arrays have
 * their size.
 * Rigs under fixtures/local are left out, because the baseline is committed and they are not.
 */
export async function measureInstanceBytes(): Promise<Record<string, number>> {
    const bytes: Record<string, number> = {};

    for (const fixture of listFixtures()) {
        if (fixture.id.startsWith('local/')) continue;
        const model = await importSkeleton(readFixture(fixture).skeleton);
        const engine = await createPoseEngine(model);

        for (let animation = 0; animation < model.animations.length; animation++) {
            engine.setAnimation(0, animation, true);
            for (let step = 0; step < 3; step++) engine.update(1 / 30);
        }
        bytes[fixture.id] = engine.bytes;
    }

    return bytes;
}

/** The committed baseline. Empty when the file does not exist yet. */
export function readBaseline(): Record<string, number> {
    try {
        return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    } catch {
        return {};
    }
}
