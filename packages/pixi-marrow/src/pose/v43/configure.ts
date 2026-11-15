import type { TrackFields } from '../engine';
import { checkFields, type FieldKind, type FieldRules } from '../shared/configure';
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

type NumberField = (typeof NUMBERS)[number];
type FlagField = (typeof FLAGS)[number];

const isNumberField = (field: string): field is NumberField => NUMBERS.some((name) => name === field);
const isFlagField = (field: string): field is FlagField => FLAGS.some((name) => name === field);

/** The fields of a 4.3 track entry, and what 4.3 has in the place of the fields of older versions. */
const RULES: FieldRules = {
    version: '4.3',
    kinds: new Map<string, FieldKind>([
        ...NUMBERS.map((name): [string, FieldKind] => [name, 'number']),
        ...FLAGS.map((name): [string, FieldKind] => [name, 'boolean']),
        ['animationLast', 'number'],
    ]),
    instead: {
        holdPrevious: 'Spine 4.3 holds timelines on its own. Leave the field out.',
        mixBlend: 'Set the flag "additive" for what was the add blend. Leave the field out otherwise.',
        attachmentThreshold: 'Set "mixAttachmentThreshold".',
        drawOrderThreshold: 'Set "mixDrawOrderThreshold".',
    },
};

/**
 * Sets fields of a track entry by their official names. `animationLast` goes through the official
 * `setAnimationLast`. Every other field is a plain write, as on the official entry. Every field
 * is checked before the first one is written, so a call that throws changes nothing.
 */
export function configureEntry(entry: Entry, fields: TrackFields): void {
    for (const [field, value] of checkFields(fields, RULES)) {
        if (typeof value === 'number') {
            if (isNumberField(field)) entry[field] = value;
            else {
                // the official setAnimationLast: a plain write would be lost at the next update
                entry.animationLast = value;
                entry.nextAnimationLast = value;
            }
        } else if (typeof value === 'boolean' && isFlagField(field)) entry[field] = value;
    }
}
