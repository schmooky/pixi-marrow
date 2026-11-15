/*
 * The editor writes one hash of 8 bytes into every export. A binary file holds the bytes. A JSON
 * file holds them as base64 text without padding. The official readers keep two different
 * strings for them. The model keeps one form for both, so that what was made for a skeleton,
 * such as baked clips, also fits the other export of it: 16 hex digits, in the byte order of the file.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** The number of base64 characters that hold 8 bytes, without padding. */
const BASE64_LENGTH = 11;

const hex = (value: number, digits: number): string => (value >>> 0).toString(16).padStart(digits, '0');

/**
 * The hash of a binary skeleton, from the two 32-bit integers its file starts with. Null when
 * both are 0, which is how the editor writes "no hash".
 *
 * @example
 * const hash = hashOfInts(input.readInt32(), input.readInt32()); // '52654f09104f1dc8'
 */
export function hashOfInts(first: number, second: number): string | null {
    return first === 0 && second === 0 ? null : hex(first, 8) + hex(second, 8);
}

/**
 * The hash of a JSON skeleton in the form of {@link hashOfInts}. Text that is not the base64 of
 * 8 bytes is kept as it is: an editor or a tool wrote something else, and it still tells files apart.
 *
 * @example
 * const hash = hashOfText('UmVPCRBPHcg'); // '52654f09104f1dc8'
 */
export function hashOfText(text: string | null | undefined): string | null {
    if (typeof text !== 'string' || text.trim() === '') return null;
    const packed = text.replace(/=+$/, '');

    if (packed.length !== BASE64_LENGTH) return text;
    let out = '';
    let bits = 0;
    let held = 0;

    for (const char of packed) {
        const value = BASE64.indexOf(char);

        if (value === -1) return text;
        bits = (bits << 6) | value;
        held += 6;
        if (held >= 8) {
            held -= 8;
            out += hex((bits >> held) & 0xff, 2);
            bits &= (1 << held) - 1;
        }
    }

    return out === '0000000000000000' ? null : out;
}
