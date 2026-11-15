import { MarrowError } from '../base/errors';
import { closestName } from '../base/names';

/*
 * Checks of the values a game passes: options, setters and arguments. They need nothing but the
 * error type, so the code that checks the `perf` settings stays free of Pixi.
 */

/**
 * A value of a list, or the {@link MarrowError} that lists the values for any other one.
 *
 * @param what What the values are, for the message: `a physics mode`.
 *
 * @example
 * const mode = oneOf('a render mode', options.renderMode ?? 'auto', ['auto', 'mesh', 'batched']);
 */
export function oneOf<T extends string>(what: string, value: unknown, valid: readonly T[]): T {
    const found = valid.find((item) => item === value);

    if (found !== undefined) return found;

    throw new MarrowError('invalid-option', `"${String(value)}" is not ${what}.`, {
        fix: `Set one of: ${valid.join(', ')}.`,
        validNames: valid,
        closest: closestName(String(value), valid),
    });
}

/**
 * The error for an option, a setter or an argument that got a value it does not take.
 *
 * @param option What got the value. That is an option, a setter, or a method and its argument.
 * @param expected What it takes, for the fix, such as `a finite number`.
 *
 * @example
 * throw wrongValue('loop', 'yes', 'true or false'); // loop got "yes". Pass true or false.
 */
export function wrongValue(option: string, value: unknown, expected: string): MarrowError {
    const shown = typeof value === 'string' ? `"${value}"` : String(value);

    return new MarrowError('invalid-option', `${option} got ${shown}.`, { fix: `Pass ${expected}.` });
}

/**
 * A number that is not NaN and not infinite, or the {@link MarrowError} that names what got
 * another value.
 *
 * @param name What got the value: an option, a setter, or a method and its argument.
 *
 * @example
 * engine.physicsTranslate(finite('physicsTranslate x', x), finite('physicsTranslate y', y));
 */
export function finite(name: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw wrongValue(name, value, 'a finite number');

    return value;
}

/**
 * Throws the {@link MarrowError} of a key that is no option, with the closest option. A key of
 * `elsewhere` gets what to do in its place.
 *
 * @param where What takes the options, for the message: `play`.
 *
 * @example
 * checkKeys({ lop: true }, 'play', ['track', 'loop']); // "lop" is not an option of play.
 */
export function checkKeys(
    options: object,
    where: string,
    valid: readonly string[],
    elsewhere: Readonly<Record<string, string>> = {},
): void {
    for (const key of Object.keys(options)) {
        if (valid.includes(key)) continue;
        const fix = Object.hasOwn(elsewhere, key) ? elsewhere[key] : undefined;

        throw new MarrowError(
            'invalid-option',
            `"${key}" is not an option of ${where}.`,
            fix === undefined
                ? {
                      fix: `Pass one of the options: ${valid.join(', ')}.`,
                      validNames: valid,
                      closest: closestName(key, valid),
                  }
                : { fix },
        );
    }
}
