import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';

describe('MarrowError', () => {
    it('states the code, the cause and the fix in the message', () => {
        const error = new MarrowError('invalid-data', 'The file is empty.', {
            fix: 'Pass the bytes of a .skel file.',
        });

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('MarrowError');
        expect(error.code).toBe('invalid-data');
        expect(error.fix).toBe('Pass the bytes of a .skel file.');
        expect(error.message).toBe('[pixi-marrow:invalid-data] The file is empty. Pass the bytes of a .skel file.');
    });

    it('has no accepted values unless the error is about a name', () => {
        const error = new MarrowError('invalid-data', 'The file is empty.', { fix: 'Pass a file.' });

        expect(error.validNames).toEqual([]);
        expect(error.closest).toBeUndefined();
    });

    it('carries the accepted values and the closest one', () => {
        const error = new MarrowError('unsupported-version', 'Exported from Spine 4.4.', {
            fix: 'Export it again from Spine 4.3.',
            validNames: ['4.1', '4.2', '4.3'],
            closest: '4.3',
        });

        expect(error.validNames).toEqual(['4.1', '4.2', '4.3']);
        expect(error.closest).toBe('4.3');
    });

    it('carries the address of a docs page when it is given one', () => {
        const plain = new MarrowError('destroyed', 'The display object was destroyed.', { fix: 'Make a new one.' });
        const linked = new MarrowError('invalid-option', '"scale" is not an option.', {
            fix: 'Set the scale of the display object.',
            docs: 'https://pixi-marrow.schmooky.dev/migrate/',
        });

        expect(plain.docs).toBeUndefined();
        expect(plain.code).toBe('destroyed');
        expect(linked.docs).toBe('https://pixi-marrow.schmooky.dev/migrate/');
        // the message stays the cause and the fix
        expect(linked.message).toBe(
            '[pixi-marrow:invalid-option] "scale" is not an option. Set the scale of the display object.',
        );
    });
});
