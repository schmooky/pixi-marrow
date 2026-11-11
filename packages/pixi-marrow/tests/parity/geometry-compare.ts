/*
 * Number comparisons for the geometry parity test. Positions and texture coordinates must have
 * the same bits as the official ones. One documented case allows a bounded difference.
 */

/** How many problems one fixture lists before it stops comparing. */
const LIMIT = 20;

/** A copy that keeps the width of the official numbers: a `Float32Array` stays one, a plain array becomes 64-bit. */
export function copyFloats(values: ArrayLike<number>): Float32Array | Float64Array {
    return values instanceof Float32Array ? values.slice() : Float64Array.from(values);
}

const floatView = new Float32Array(1);
const bitView = new Int32Array(floatView.buffer);

/** The distance from a number to the next 32-bit float away from zero. */
function floatStep(value: number): number {
    floatView[0] = value;
    const here = floatView[0] ?? 0;

    bitView[0] = (bitView[0] ?? 0) + 1;

    return Math.abs((floatView[0] ?? 0) - here);
}

/** Collects the differences of one fixture as readable lines. */
export class Problems {
    readonly lines: string[] = [];

    get full(): boolean {
        return this.lines.length >= LIMIT;
    }

    add(where: string, message: string): void {
        if (!this.full) this.lines.push(`${where}: ${message}`);
    }

    /** Both values must be the same. */
    same(where: string, actual: unknown, expected: unknown): void {
        if (actual !== expected) this.add(where, `${String(actual)}, expected ${String(expected)}`);
    }

    /**
     * Two arrays must be of the same type and hold the same numbers bit for bit: -0 is not 0.
     *
     * `slack` allows a difference for single entries. It gives how far the inputs of an entry are
     * known to differ. An entry with a slack above 0 may then be off by that slack plus one
     * 32-bit step for rounding the result.
     */
    equal(
        where: string,
        actual: ArrayLike<number>,
        expected: ArrayLike<number>,
        slack?: (index: number) => number,
    ): void {
        if (actual.constructor.name !== expected.constructor.name) {
            this.add(where, `${actual.constructor.name}, expected ${expected.constructor.name}`);

            return;
        }
        if (actual.length !== expected.length) {
            this.add(where, `length ${actual.length}, expected ${expected.length}`);

            return;
        }
        for (let i = 0; i < actual.length && !this.full; i++) {
            const a = actual[i] ?? Number.NaN;
            const e = expected[i] ?? Number.NaN;
            const allowed = slack?.(i) ?? 0;

            if (Object.is(a, e) || (allowed > 0 && Math.abs(a - e) <= allowed + floatStep(e))) continue;
            this.add(`${where}[${i}]`, `${a}, expected ${e}`);
        }
    }
}
