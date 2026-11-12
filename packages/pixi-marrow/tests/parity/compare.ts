/** How many differences are listed before the comparison stops. */
const LIMIT = 25;

const isTypedArray = (value: unknown): value is ArrayLike<number> & { constructor: { name: string } } =>
    ArrayBuffer.isView(value) && !(value instanceof DataView);

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value);

const show = (value: unknown): string => {
    if (isTypedArray(value)) return `${value.constructor.name}(${value.length})`;
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (isRecord(value)) return 'object';

    return JSON.stringify(value) ?? String(value);
};

function compareList(a: ArrayLike<unknown>, b: ArrayLike<unknown>, path: string, out: string[]): void {
    if (a.length !== b.length) {
        out.push(`${path}: length ${a.length}, expected ${b.length}`);

        return;
    }
    for (let i = 0; i < a.length && out.length < LIMIT; i++) {
        const actual = a[i];
        const expected = b[i];

        // equal values need no path. Most of a comparison is this line, so it builds no text.
        if (actual === expected || (Number.isNaN(actual) && Number.isNaN(expected))) continue;
        compare(actual, expected, `${path}[${i}]`, out);
    }
}

/**
 * True when two arrays of 64-bit numbers hold the same values. NaN equals NaN. Poses are made of
 * such arrays and are equal most of the time, and a loop that sees one kind of array is fast.
 */
function sameFloat64(a: Float64Array, b: Float64Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const actual = a[i];
        const expected = b[i];

        if (actual !== expected && !(Number.isNaN(actual) && Number.isNaN(expected))) return false;
    }

    return true;
}

function compare(actual: unknown, expected: unknown, path: string, out: string[]): void {
    if (out.length >= LIMIT) return;
    if (actual instanceof Float64Array && expected instanceof Float64Array && sameFloat64(actual, expected)) return;
    if (isTypedArray(actual) && isTypedArray(expected)) {
        if (actual.constructor.name !== expected.constructor.name) {
            out.push(`${path}: ${show(actual)}, expected ${show(expected)}`);

            return;
        }
        compareList(actual, expected, path, out);
    } else if (Array.isArray(actual) && Array.isArray(expected)) {
        compareList(actual, expected, path, out);
    } else if (isRecord(actual) && isRecord(expected)) {
        // a missing key and a key that holds undefined are the same thing
        for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
            compare(actual[key], expected[key], path ? `${path}.${key}` : key, out);
        }
    } else if (!(actual === expected || (Number.isNaN(actual) && Number.isNaN(expected)))) {
        out.push(`${path}: ${show(actual)}, expected ${show(expected)}`);
    }
}

/**
 * Lists where two values differ, as `path: actual, expected ...` lines. Empty when they are equal.
 * Numbers must be exactly equal: both sides store the same source numbers in the same array types.
 */
export function differences(actual: unknown, expected: unknown): string[] {
    const out: string[] = [];

    compare(actual, expected, '', out);

    return out;
}
