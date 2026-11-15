import { describe, expect, it } from 'vitest';
import {
    createPoseEngine,
    importSkeleton,
    MarrowError,
    type PoseEngine,
    type TrackEntry,
    type TrackFields,
} from '../../src/core';
import { listFixtures, readFixture } from '../parity/fixtures';

/*
 * `configure` follows the same rules in both engines and in every Spine version: every field is
 * checked before the first one is written, the errors have the same codes, and a field whose
 * value is undefined stays as it is.
 */

async function playing(version: string): Promise<{ engine: PoseEngine; entry: TrackEntry }> {
    const fixture = listFixtures().find((candidate) => candidate.id === `${version}/spineboy-pro.skel`);

    if (fixture === undefined) throw new Error(`no spineboy for ${version}`);
    const engine = await createPoseEngine(await importSkeleton(readFixture(fixture).skeleton));

    return { engine, entry: engine.setAnimation(0, 0, false) };
}

function errorOf(run: () => void): MarrowError {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('nothing was thrown');
}

/** Fields as JavaScript can pass them: with names and values the types do not allow. */
const loose = (fields: object): TrackFields => fields;

/** A field that only another Spine version has, per version. */
const FOREIGN: Readonly<Record<string, string>> = { '4.1': 'keepHold', '4.2': 'additive', '4.3': 'holdPrevious' };

describe.each(['4.1', '4.2', '4.3'])('configure of a Spine %s entry', (version) => {
    const foreign = FOREIGN[version] ?? '';

    it('throws unsupported-feature for a field that only another version has', async () => {
        const { engine, entry } = await playing(version);
        const error = errorOf(() => engine.configure(entry, loose({ [foreign]: true })));

        expect(error.code).toBe('unsupported-feature');
        expect(error.message).toContain(`A Spine ${version} track entry has no field "${foreign}"`);
        expect(error.validNames).toContain('trackEnd');
        expect(error.validNames).not.toContain(foreign);
    });

    it('throws unknown-name for a name that no version has, with the closest field', async () => {
        const { engine, entry } = await playing(version);
        const error = errorOf(() => engine.configure(entry, loose({ alfa: 0.5 })));

        expect(error.code).toBe('unknown-name');
        expect(error.closest).toBe('alpha');
        expect(error.validNames).toContain('alpha');
    });

    it('throws invalid-option for a value of the wrong type', async () => {
        const { engine, entry } = await playing(version);

        for (const fields of [{ alpha: '1' }, { loop: 1 }, { delay: true }, { reverse: null }, { trackEnd: null }]) {
            expect(errorOf(() => engine.configure(entry, loose(fields))).code).toBe('invalid-option');
        }
        expect(errorOf(() => engine.configure(entry, loose({ alpha: '1' }))).message).toContain('takes a number');
        expect(errorOf(() => engine.configure(entry, loose({ loop: 1 }))).message).toContain('takes true or false');
    });

    it('checks every field before it writes one', async () => {
        const { engine, entry } = await playing(version);
        const before = { alpha: entry.alpha, timeScale: entry.timeScale, loop: entry.loop, delay: entry.delay };

        for (const bad of [{ loop: 1 }, { [foreign]: true }, { alfa: 1 }]) {
            // the valid fields come first: an engine that wrote as it went would have set them
            expect(() => engine.configure(entry, loose({ alpha: 0.25, timeScale: 3, delay: 2, ...bad }))).toThrow(
                MarrowError,
            );
            expect(entry).toMatchObject(before);
        }
    });

    it('leaves a field whose value is undefined as it is', async () => {
        const { engine, entry } = await playing(version);

        engine.configure(entry, loose({ alpha: undefined, timeScale: 2, loop: undefined }));
        expect(entry).toMatchObject({ alpha: 1, timeScale: 2, loop: false });
        // the name is still checked
        expect(errorOf(() => engine.configure(entry, loose({ alfa: undefined }))).code).toBe('unknown-name');
        expect(errorOf(() => engine.configure(entry, loose({ [foreign]: undefined }))).code).toBe(
            'unsupported-feature',
        );
    });

    it('sets the fields of its version', async () => {
        const { engine, entry } = await playing(version);

        engine.configure(entry, { alpha: 0.5, trackEnd: 4, reverse: true, animationLast: 0.25 });
        expect(entry).toMatchObject({ alpha: 0.5, trackEnd: 4, reverse: true });
    });
});
