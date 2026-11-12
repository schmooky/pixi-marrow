import { MarrowError } from '../base/errors';
import { closestName } from '../base/names';
import type { SpineVersion } from '../base/version';
import type { TrackField, TrackFields } from '../pose/engine';
import type { PlayOptions, QueueOptions } from './options';

/*
 * Play and queue options, checked and turned into fields of the official track entry. A wrong
 * value throws before the engine is touched, so a call that throws changes nothing.
 */

/** The options that are numbers, each with the official field it sets. */
const NUMBERS: readonly (readonly [keyof PlayOptions, TrackField])[] = [
    ['mix', 'mixDuration'],
    ['speed', 'timeScale'],
    ['alpha', 'alpha'],
    ['start', 'animationStart'],
    ['end', 'animationEnd'],
    ['eventThreshold', 'eventThreshold'],
];

/** The options that are true or false, each with the official field it sets. */
const FLAGS: readonly (readonly [keyof PlayOptions, TrackField])[] = [
    ['reverse', 'reverse'],
    ['shortestRotation', 'shortestRotation'],
];

const PLAY_OPTIONS: readonly string[] = [
    'track',
    'loop',
    ...NUMBERS.map(([option]) => option),
    ...FLAGS.map(([option]) => option),
    'additive',
    'entry',
];
const QUEUE_OPTIONS: readonly string[] = [...PLAY_OPTIONS, 'delay'];

/** What play or queue options ask of the engine. */
export interface PlayPlan {
    /** The index of the track. */
    track: number;
    loop: boolean;
    /** The official `delay` of `addAnimation`. 0 for `play`. */
    delay: number;
    /** The fields of the track entry that the named options set, or undefined when they set none. */
    fields: TrackFields | undefined;
    /** The fields of the option `entry`, which are set last, or undefined. */
    extra: TrackFields | undefined;
}

function wrongValue(option: string, value: unknown, expected: string): MarrowError {
    const shown = typeof value === 'string' ? `"${value}"` : String(value);

    return new MarrowError('invalid-data', `The option "${option}" was set to ${shown}.`, {
        fix: `Pass ${expected}.`,
    });
}

/** A number that is not NaN and not infinite, or the error that names the option. */
function finite(option: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw wrongValue(option, value, 'a finite number');

    return value;
}

function flag(option: string, value: unknown): boolean {
    if (typeof value !== 'boolean') throw wrongValue(option, value, 'true or false');

    return value;
}

/** Throws for a key that is no option of the method, with the closest option. */
function checkKeys(options: object, method: 'play' | 'queue', valid: readonly string[]): void {
    for (const key of Object.keys(options)) {
        if (valid.includes(key)) continue;

        throw new MarrowError('unknown-name', `"${key}" is not an option of ${method}.`, {
            fix: `Pass one of the options: ${valid.join(', ')}.`,
            validNames: valid,
            closest: closestName(key, valid) ?? 'track',
        });
    }
}

function trackIndex(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw wrongValue('track', value, 'a whole number from 0');
    }

    return value;
}

/** The fields the named options set. `additive` is the add blend before 4.3 and a flag of its own in 4.3. */
function namedFields(options: PlayOptions, version: SpineVersion): TrackFields | undefined {
    const fields: TrackFields = {};
    let count = 0;

    for (const [option, field] of NUMBERS) {
        if (options[option] === undefined) continue;
        fields[field] = finite(option, options[option]);
        count++;
    }
    for (const [option, field] of FLAGS) {
        if (options[option] === undefined) continue;
        fields[field] = flag(option, options[option]);
        count++;
    }
    if (options.additive !== undefined) {
        const additive = flag('additive', options.additive);

        if (version === '4.3') fields.additive = additive;
        else fields.mixBlend = additive ? 'add' : 'replace';
        count++;
    }

    return count > 0 ? fields : undefined;
}

/**
 * Checks play or queue options and turns them into what the engine takes. Throws a
 * {@link MarrowError} for a key that is no option, and for a value of the wrong type.
 *
 * @param version The Spine version of the skeleton, which decides how `additive` is set.
 *
 * @example
 * const plan = planPlay({ loop: true, mix: 0.2, additive: true }, 'play', '4.2');
 * console.log(plan.track, plan.fields); // 0 { mixDuration: 0.2, mixBlend: 'add' }
 */
export function planPlay(options: QueueOptions, method: 'play' | 'queue', version: SpineVersion): PlayPlan {
    checkKeys(options, method, method === 'play' ? PLAY_OPTIONS : QUEUE_OPTIONS);
    const { entry } = options;

    if (entry !== undefined && (typeof entry !== 'object' || entry === null)) {
        throw wrongValue('entry', entry, 'an object with fields of the official TrackEntry');
    }

    return {
        track: options.track === undefined ? 0 : trackIndex(options.track),
        loop: options.loop === undefined ? false : flag('loop', options.loop),
        delay: options.delay === undefined ? 0 : finite('delay', options.delay),
        fields: namedFields(options, version),
        extra: entry,
    };
}
