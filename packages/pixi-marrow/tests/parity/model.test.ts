import { describe, expect, it } from 'vitest';
import { importSkeleton } from '../../src/core';
import { differences } from './compare';
import { listFixtures, readFixture } from './fixtures';
import { officialModel } from './model-official';

/*
 * Model parity: what our importer reads from a file equals what the official core of that
 * version holds after loading the same file.
 */
describe.each(listFixtures())('$id', (fixture) => {
    it('imports the same model the official core holds', async () => {
        const files = readFixture(fixture);
        const model = await importSkeleton(files.skeleton);

        expect(model.version).toBe(fixture.version);
        expect(differences(model, officialModel(fixture.version, files))).toEqual([]);
    });
});
