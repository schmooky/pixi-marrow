import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { SPINE_VERSIONS } from '../../src/base/version';
import { sniffSkeleton } from '../../src/formats/sniff';

/** The start of a `.skel` file: 8 bytes of hash, then `text` as a length-prefixed string. */
function binaryHeader(text: string, lengthBytes: number[] = [text.length + 1]): Uint8Array {
    return Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, ...lengthBytes, ...text.split('').map((c) => c.charCodeAt(0))]);
}

/** The error code `run` throws, or `none`. */
function codeOf(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error.code;
        throw error;
    }

    return 'none';
}

describe('sniffSkeleton', () => {
    it('reads the version from JSON text', () => {
        expect(sniffSkeleton('{"skeleton":{"hash":"x","spine":"4.2.22","width":10}}')).toEqual({
            format: 'json',
            version: '4.2',
            editorVersion: '4.2.22',
        });
        expect(sniffSkeleton('{ "skeleton": { "spine" : "4.1.17" } }').version).toBe('4.1');
    });

    it('reads the version from parsed JSON', () => {
        expect(sniffSkeleton({ skeleton: { spine: '4.3.75-beta' }, bones: [] })).toEqual({
            format: 'json',
            version: '4.3',
            editorVersion: '4.3.75-beta',
        });
    });

    it('reads the version from binary data', () => {
        expect(sniffSkeleton(binaryHeader('4.3.75-beta'))).toEqual({
            format: 'binary',
            version: '4.3',
            editorVersion: '4.3.75-beta',
        });
        expect(sniffSkeleton(binaryHeader('4.1.17').buffer).version).toBe('4.1');
        expect(sniffSkeleton(Buffer.from(binaryHeader('4.2.22'))).version).toBe('4.2');
    });

    it('reads a length stored in more than one byte', () => {
        // 7 as a two-byte variable-length integer: low 7 bits with the continue flag, then 0
        expect(sniffSkeleton(binaryHeader('4.2.22', [0x87, 0x00])).editorVersion).toBe('4.2.22');
    });

    it('rejects versions outside 4.1 to 4.3 and lists the supported ones', () => {
        for (const version of ['3.8.99', '4.0.64', '5.0.1']) {
            expect(codeOf(() => sniffSkeleton({ skeleton: { spine: version } }))).toBe('unsupported-version');
            expect(codeOf(() => sniffSkeleton(binaryHeader(version)))).toBe('unsupported-version');
        }
        try {
            sniffSkeleton('{"skeleton":{"spine":"3.8.99"}}');
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(MarrowError);
            if (!(error instanceof MarrowError)) return;
            expect(error.message).toContain('3.8.99');
            expect(error.validNames).toEqual(SPINE_VERSIONS);
        }
    });

    it('rejects JSON without a version', () => {
        const sources = ['{}', '{"skeleton":{}}', {}, { skeleton: null }, { skeleton: {} }, { skeleton: { spine: 4 } }];

        for (const source of sources) expect(codeOf(() => sniffSkeleton(source))).toBe('invalid-data');
    });

    it('rejects binary data that is not a Spine 4 skeleton', () => {
        const sources = [
            new Uint8Array(0),
            new Uint8Array(8),
            // no string, then an empty string
            binaryHeader('', [0]),
            binaryHeader('', [1]),
            // the length points past the end of the data
            binaryHeader('4.2', [20]),
            // a length that never ends
            binaryHeader('', [0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
            binaryHeader('hello'),
            binaryHeader('4.2.22-with-a-suffix-that-is-far-too-long'),
        ];

        for (const source of sources) expect(codeOf(() => sniffSkeleton(source))).toBe('invalid-data');
    });
});
