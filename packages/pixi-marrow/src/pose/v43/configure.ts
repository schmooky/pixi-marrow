import { MarrowError } from '../../base/errors';
import type { TrackFields } from '../engine';
import type { Entry } from './entry';

/** The number fields of the official 4.3 `TrackEntry` that are set by a plain write. */
const NUMBERS = [
    'delay',
    'trackTime',
    'trackEnd',
    'timeScale',
    'alpha',
    'mixTime',
    'mixDuration',
    'eventThreshold',
    'animationStart',
    'animationEnd',
    'mixAttachmentThreshold',
    'alphaAttachmentThreshold',
    'mixDrawOrderThreshold',
] as const;

/** The flags of the official 4.3 `TrackEntry`. */
const FLAGS = ['loop', 'reverse', 'shortestRotation', 'additive', 'keepHold'] as const;

/** Fields of older versions, with what 4.3 has in their place. */
const MISSING: Readonly<Record<string, string>> = {
    holdPrevious: 'Spine 4.3 holds timelines on its own. Leave the field out.',
    mixBlend: 'Set the flag "additive" for what was the add blend. Leave the field out otherwise.',
    attachmentThreshold: 'Set "mixAttachmentThreshold".',
    drawOrderThreshold: 'Set "mixDrawOrderThreshold".',
};

const VALID: readonly string[] = [...NUMBERS, ...FLAGS, 'animationLast'];

type NumberField = (typeof NUMBERS)[number];
type FlagField = (typeof FLAGS)[number];

const isNumberField = (field: string): field is NumberField => NUMBERS.some((name) => name === field);
const isFlagField = (field: string): field is FlagField => FLAGS.some((name) => name === field);

function wrongType(field: string, value: unknown, expected: string): MarrowError {
    return new MarrowError(
        'invalid-data',
        `The track entry field "${field}" takes a ${expected}, not ${JSON.stringify(value)}.`,
        {
            fix: `Pass a ${expected}.`,
        },
    );
}

/** Sets one field. Throws for a field 4.3 does not have and for a value of the wrong type. */
function setField(entry: Entry, field: string, value: number | boolean | string): void {
    if (field === 'animationLast') {
        if (typeof value !== 'number') throw wrongType(field, value, 'number');
        // the official setAnimationLast: a plain write would be lost at the next update
        entry.animationLast = value;
        entry.nextAnimationLast = value;
    } else if (isNumberField(field)) {
        if (typeof value !== 'number') throw wrongType(field, value, 'number');
        entry[field] = value;
    } else if (isFlagField(field)) {
        if (typeof value !== 'boolean') throw wrongType(field, value, 'boolean');
        entry[field] = value;
    } else {
        const instead = MISSING[field];

        if (instead !== undefined) {
            throw new MarrowError('unsupported-feature', `A Spine 4.3 track entry has no field "${field}".`, {
                fix: instead,
                validNames: VALID,
            });
        }
        throw new MarrowError('invalid-data', `A track entry has no field "${field}".`, {
            fix: 'Set one of the fields of the official TrackEntry.',
            validNames: VALID,
        });
    }
}

/**
 * Sets fields of a track entry by their official names. `animationLast` goes through the official
 * `setAnimationLast`. Every other field is a plain write, as on the official entry.
 */
export function configureEntry(entry: Entry, fields: TrackFields): void {
    for (const [field, value] of Object.entries(fields)) {
        if (value !== undefined) setField(entry, field, value);
    }
}
