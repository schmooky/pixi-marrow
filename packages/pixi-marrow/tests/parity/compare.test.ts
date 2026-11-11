import { describe, expect, it } from 'vitest';
import { differences } from './compare';

/*
 * The comparison decides every parity test, so it gets tests of its own.
 */
describe('differences', () => {
    const model = () => ({
        name: 'rig',
        bones: { count: 2, setup: Float32Array.of(1, 2, 3), parents: Int16Array.of(-1, 0) },
        skins: [{ name: 'default', attachments: [{ slot: 0, color: Float32Array.of(1, 1, 1, 1) }] }],
        hash: null,
    });

    it('finds nothing in equal values', () => {
        expect(differences(model(), model())).toEqual([]);
        expect(differences(Number.NaN, Number.NaN)).toEqual([]);
        expect(differences(0, -0)).toEqual([]);
    });

    it('reports one changed number in a typed array, with its path', () => {
        const changed = model();

        changed.bones.setup[1] = 2.0000002;
        expect(differences(changed, model())).toEqual(['bones.setup[1]: 2.000000238418579, expected 2']);
    });

    it('reports a changed value deep inside lists of objects', () => {
        const changed = model();
        const color = changed.skins[0]?.attachments[0]?.color;

        if (color) color[3] = 0.5;
        expect(differences(changed, model())).toEqual(['skins[0].attachments[0].color[3]: 0.5, expected 1']);
    });

    it('reports a different length without listing the elements', () => {
        const changed = { ...model(), skins: [] };

        expect(differences(changed, model())).toEqual(['skins: length 0, expected 1']);
    });

    it('tells typed array kinds apart, and typed arrays from plain arrays', () => {
        expect(differences(Int16Array.of(1), Uint16Array.of(1))).toEqual([': Int16Array(1), expected Uint16Array(1)']);
        expect(differences([1], Float32Array.of(1))).toEqual([': Array(1), expected Float32Array(1)']);
    });

    it('treats a missing key and an undefined value as the same', () => {
        expect(differences({ a: 1 }, { a: 1, b: undefined })).toEqual([]);
        expect(differences({ a: 1 }, { a: 1, b: null })).toEqual(['b: undefined, expected null']);
        expect(differences({ a: 1, extra: 2 }, { a: 1 })).toEqual(['extra: 2, expected undefined']);
    });

    it('tells values of different kinds apart', () => {
        expect(differences('1', 1)).toEqual([': "1", expected 1']);
        expect(differences(null, {})).toEqual([': null, expected object']);
        expect(differences(true, false)).toEqual([': true, expected false']);
    });

    it('stops after 25 differences', () => {
        const a = Float32Array.from({ length: 100 }, () => 1);
        const b = new Float32Array(100);

        expect(differences(a, b)).toHaveLength(25);
    });
});
