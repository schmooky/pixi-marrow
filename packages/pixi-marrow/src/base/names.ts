import { MarrowError } from './errors';

/** How many valid names the fix of an unknown name error spells out. The full list is in `validNames`. */
const LISTED_NAMES = 12;

/**
 * Counts the single character edits that turn one string into the other: the Levenshtein distance.
 * An edit inserts, removes or replaces one character.
 *
 * @example
 * editDistance('idel', 'idle'); // 2
 * editDistance('run', 'run'); // 0
 */
export function editDistance(from: string, to: string): number {
    // one row of the table at a time: row[j] is the distance from the letters read so far to to[0..j]
    const row: number[] = [];

    for (let j = 0; j <= to.length; j++) row.push(j);
    for (let i = 1; i <= from.length; i++) {
        let diagonal = row[0] ?? 0;

        row[0] = i;
        for (let j = 1; j <= to.length; j++) {
            const above = row[j] ?? 0;
            const replace = diagonal + (from.charCodeAt(i - 1) === to.charCodeAt(j - 1) ? 0 : 1);

            row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, replace);
            diagonal = above;
        }
    }

    return row[to.length] ?? 0;
}

/**
 * Finds the valid name closest to a name, by edit distance without regard to case.
 * The first of equally close names wins. Returns undefined when there are no valid names.
 *
 * @example
 * closestName('idel', ['walk', 'idle', 'run']); // 'idle'
 */
export function closestName(name: string, validNames: readonly string[]): string | undefined {
    const wanted = name.toLowerCase();
    let closest: string | undefined;
    let least = Number.POSITIVE_INFINITY;

    for (const candidate of validNames) {
        const distance = editDistance(wanted, candidate.toLowerCase());

        if (distance < least) {
            least = distance;
            closest = candidate;
        }
    }

    return closest;
}

/**
 * Creates the error for a name a skeleton does not have. The message states the name, its kind
 * and the closest valid name. The error carries every valid name.
 *
 * @example
 * throw unknownName('animation', 'idel', ['idle', 'run']);
 * // [pixi-marrow:unknown-name] The skeleton has no animation "idel". The closest name is "idle". ...
 */
export function unknownName(kind: string, name: string, validNames: readonly string[]): MarrowError {
    const closest = closestName(name, validNames);
    const listed = validNames.slice(0, LISTED_NAMES).join(', ');
    const more = validNames.length > LISTED_NAMES ? ` and ${validNames.length - LISTED_NAMES} more` : '';

    if (closest === undefined) {
        return new MarrowError('unknown-name', `The skeleton has no ${kind} "${name}". It has no ${kind} names.`, {
            fix: `Export the skeleton again with the ${kind} in it.`,
            validNames,
        });
    }

    return new MarrowError('unknown-name', `The skeleton has no ${kind} "${name}". The closest name is "${closest}".`, {
        fix: `Pass one of the ${kind} names: ${listed}${more}.`,
        validNames,
        closest,
    });
}
