import { describe, expect, it } from 'vitest';
import { MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { blankTexture, importRig } from './helpers';

/*
 * `MarrowAsset.fromData`: an asset from data in memory, its name and the label it gives.
 */

async function rejection(promise: Promise<unknown>): Promise<MarrowError> {
    const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
    );

    if (!(error instanceof MarrowError)) throw new Error(`expected a MarrowError, got ${String(error)}`);

    return error;
}

describe('MarrowAsset.fromData', () => {
    it('is MarrowAsset.fromData, which the older name from calls', async () => {
        const { model, atlas } = await importRig('4.2/spineboy-pro.skel');
        const textures = atlas.pages.map(() => blankTexture());
        const named = await MarrowAsset.fromData({ model, atlas, textures, name: 'boy' });
        const older = await MarrowAsset.from({ model, atlas, textures });
        const hero = new MarrowSpine(named, { autoUpdate: false });
        const plain = new MarrowSpine(older, { autoUpdate: false });
        const labelled = new MarrowSpine(named, { autoUpdate: false, label: 'hero' });

        expect(named).toBeInstanceOf(MarrowAsset);
        expect(older.model).toBe(model);
        // data in memory has no file name, so the name is empty unless the call gives one
        expect([named.name, older.name]).toEqual(['boy', '']);
        expect([hero.label, plain.label, labelled.label]).toEqual(['MarrowSpine:boy', 'MarrowSpine', 'hero']);
        for (const spine of [hero, plain, labelled]) spine.destroy();
    });

    it('throws invalid-option for a name that is no string and for outlines that are no object', async () => {
        const { model, atlas } = await importRig('4.2/spineboy-pro.skel');
        const textures = atlas.pages.map(() => blankTexture());
        const loose = (extra: object): Parameters<typeof MarrowAsset.fromData>[0] => ({
            model,
            atlas,
            textures,
            ...extra,
        });
        const name = await rejection(MarrowAsset.fromData(loose({ name: 7 })));
        const outlines = await rejection(MarrowAsset.fromData(loose({ outlines: 7 })));

        expect([name.code, outlines.code]).toEqual(['invalid-option', 'invalid-option']);
        expect(name.message).toContain('name got 7.');
        expect(outlines.message).toContain('outlines got 7.');
    });
});
