import { MarrowError } from '../../base/errors';

const EXPORT_FIX = 'Export the skeleton again from the Spine editor.';

/** Builds the error for data this importer cannot read. */
export function invalid(message: string, fix: string = EXPORT_FIX): MarrowError {
    return new MarrowError('invalid-data', message, { fix });
}

/** The value of a key, or the fallback when the file leaves the key out. Works like the official `getValue`. */
export function pick<T>(value: T | undefined, fallback: T): T {
    return value === undefined ? fallback : value;
}

/** A name the file must hold. Throws when it is missing or empty. */
export function requireName(value: string | undefined, what: string): string {
    if (typeof value !== 'string' || value === '') throw invalid(`${what} has no name.`);

    return value;
}

/** A number the file must hold. Throws when it is missing. */
export function requireNumber(value: number | undefined, what: string): number {
    if (typeof value !== 'number') throw invalid(`${what} is missing or is not a number.`);

    return value;
}

/**
 * Checks a count against what the integer arrays of the model can hold.
 * Throws `unsupported-feature` when it is over the limit.
 */
export function requireAtMost(count: number, limit: number, what: string): void {
    if (count > limit) {
        throw new MarrowError('unsupported-feature', `${what}: ${count}. The model holds at most ${limit}.`, {
            fix: 'Split the skeleton or the mesh into smaller parts.',
        });
    }
}

/** A list from the file, or an empty list when the file has none. */
export function list<T>(value: readonly T[] | null | undefined, what: string): readonly T[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw invalid(`${what} must be a list.`);

    return value;
}

/** A list the file must hold. Throws when it is missing. */
export function requireList<T>(value: readonly T[] | undefined, what: string): readonly T[] {
    if (!Array.isArray(value)) throw invalid(`${what} is missing or is not a list.`);

    return value;
}

/** The number at an index of a list from the file. Throws when the list ends before it. */
export function numberAt(values: readonly number[], index: number, what: string): number {
    const value = values[index];

    if (value === undefined) throw invalid(`${what} ends before its data does.`);

    return value;
}

/** The keys of a map from the file in file order, or none when the file has no such map. */
export function names(map: object | null | undefined, what: string): string[] {
    if (map === undefined || map === null) return [];
    if (typeof map !== 'object' || Array.isArray(map)) throw invalid(`${what} must be a map from names to values.`);

    return Object.keys(map);
}

/** The entries of a map from the file in file order, or none when the file has no such map. */
export function entries<T>(map: Readonly<Record<string, T>> | null | undefined, what: string): [string, T][] {
    if (map === undefined || map === null) return [];
    if (typeof map !== 'object' || Array.isArray(map)) throw invalid(`${what} must be a map from names to values.`);

    return Object.entries(map);
}

/** Finds the index of a name. */
export type NameIndex = ReadonlyMap<string, number>;

/** Indexes names by position. The first entry wins when a name is used twice, as in the official lookups. */
export function indexNames(all: readonly string[]): Map<string, number> {
    const index = new Map<string, number>();

    all.forEach((name, i) => {
        if (!index.has(name)) index.set(name, i);
    });

    return index;
}

/**
 * The index of a name the file refers to. Throws when nothing has that name.
 *
 * @param kind what the name stands for, for example `bone`
 * @param user what refers to the name, as the start of a sentence
 */
export function resolve(index: NameIndex, name: string | undefined, kind: string, user: string): number {
    const found = typeof name === 'string' ? index.get(name) : undefined;

    if (found === undefined) {
        throw new MarrowError(
            'invalid-data',
            `${user} refers to the ${kind} "${String(name)}", which does not exist.`,
            {
                fix: `Use the name of an existing ${kind}, or export the skeleton again from the Spine editor.`,
                validNames: [...index.keys()],
            },
        );
    }

    return found;
}

/** Builds the error for a timeline name this importer does not know. */
export function unknownTimeline(name: string, user: string, known: readonly string[]): MarrowError {
    return new MarrowError('invalid-data', `${user} has a timeline of the unknown type "${name}".`, {
        fix: 'Export the skeleton again from Spine 4.1 or 4.2.',
        validNames: known,
    });
}

/** An enum name from the file with a lower case first letter. The official parsers accept both cases there. */
export function lowerFirst(value: string): string {
    return typeof value === 'string' ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

/** Checks an enum name from the file against the names that exist. Throws when it is not one of them. */
export function enumName<T extends string>(all: readonly T[], value: string, what: string): T {
    const found = all.find((name) => name === value);

    if (found === undefined) {
        throw new MarrowError('invalid-data', `${what} has the unknown value "${String(value)}".`, {
            fix: 'Use one of the valid values, or export the skeleton again from the Spine editor.',
            validNames: all,
        });
    }

    return found;
}

/** The position of an enum name from the file in the list of names. Throws when it is not one of them. */
export function enumIndex(all: readonly string[], value: string, what: string): number {
    return all.indexOf(enumName(all, value, what));
}

/**
 * Reads a hex color as r, g, b, a in double precision, the way the official `Color.setFromString`
 * does. Curves are computed from these numbers before they are stored as floats.
 */
export function readHexColor(hex: string | undefined, out: Float64Array, offset: number, what: string): void {
    if (typeof hex !== 'string') throw invalid(`${what} has no color.`);
    const digits = hex.charAt(0) === '#' ? hex.slice(1) : hex;

    out[offset] = Number.parseInt(digits.slice(0, 2), 16) / 255;
    out[offset + 1] = Number.parseInt(digits.slice(2, 4), 16) / 255;
    out[offset + 2] = Number.parseInt(digits.slice(4, 6), 16) / 255;
    out[offset + 3] = digits.length !== 8 ? 1 : Number.parseInt(digits.slice(6, 8), 16) / 255;
}
