import { MarrowError } from '../../base/errors';
import { closestName } from '../../base/names';
import type { TrackField, TrackFields } from '../engine';

/*
 * The rules of `PoseEngine.configure` that both engines share. Every field is checked before
 * the first one is written, so a call that throws changes nothing. The errors have the same codes
 * in every Spine version.
 */

/** What a field takes: a number, true or false, or one of a list of words. */
export type FieldKind = 'number' | 'boolean' | readonly string[];

/** The fields of the track entry of one Spine version. */
export interface FieldRules {
    /** The Spine version, for the messages. */
    readonly version: string;
    /** The fields the version has, with what each takes. */
    readonly kinds: ReadonlyMap<string, FieldKind>;
    /** For a field that only other versions have: what to do in this version. */
    readonly instead: Readonly<Record<string, string>>;
}

/** A field of `TrackFields` with its value, checked. */
export type CheckedField = readonly [name: string, value: number | boolean | string];

/** Every field of every version. The type makes the list complete. */
const EVERY: Readonly<Record<TrackField, true>> = {
    loop: true,
    delay: true,
    trackTime: true,
    trackEnd: true,
    timeScale: true,
    alpha: true,
    mixTime: true,
    mixDuration: true,
    reverse: true,
    shortestRotation: true,
    eventThreshold: true,
    animationStart: true,
    animationEnd: true,
    animationLast: true,
    holdPrevious: true,
    mixBlend: true,
    attachmentThreshold: true,
    drawOrderThreshold: true,
    mixAttachmentThreshold: true,
    alphaAttachmentThreshold: true,
    mixDrawOrderThreshold: true,
    additive: true,
    keepHold: true,
};

/** True when the value is what the field takes. */
function fits(kind: FieldKind, value: unknown): boolean {
    if (kind === 'number' || kind === 'boolean') return typeof value === kind;

    return typeof value === 'string' && kind.includes(value);
}

/** What a field takes, in words. */
function described(kind: FieldKind): string {
    if (kind === 'number') return 'a number';
    if (kind === 'boolean') return 'true or false';

    return `one of ${kind.join(', ')}`;
}

/** The error for a field name that the version does not have. */
function noField(name: string, rules: FieldRules): MarrowError {
    const validNames = [...rules.kinds.keys()];

    if (Object.hasOwn(EVERY, name)) {
        return new MarrowError('unsupported-feature', `A Spine ${rules.version} track entry has no field "${name}".`, {
            fix: rules.instead[name] ?? `Set one of the fields of that version: ${validNames.join(', ')}.`,
            validNames,
        });
    }
    const closest = closestName(name, validNames);

    return new MarrowError('unknown-name', `A track entry has no field "${name}". The closest name is "${closest}".`, {
        fix: `Set one of the fields of the official TrackEntry: ${validNames.join(', ')}.`,
        validNames,
        ...(closest === undefined ? {} : { closest }),
    });
}

/**
 * Checks the fields of a `configure` call against the fields of one Spine version, all of them
 * before the caller writes the first. Returns the fields to write, in the order they were given.
 *
 * - A field that only another Spine version has throws `unsupported-feature`.
 * - A name that no version has throws `unknown-name`.
 * - A value of the wrong type throws `invalid-data`.
 * - A field whose value is `undefined` is left out: it stays as it is.
 *
 * @example
 * for (const [name, value] of checkFields(fields, RULES)) write(entry, name, value);
 */
export function checkFields(fields: TrackFields, rules: FieldRules): CheckedField[] {
    const checked: CheckedField[] = [];

    for (const [name, value] of Object.entries(fields)) {
        const kind = rules.kinds.get(name);

        if (kind === undefined) throw noField(name, rules);
        if (value === undefined) continue;
        if (!fits(kind, value)) {
            throw new MarrowError(
                'invalid-option',
                `The track entry field "${name}" takes ${described(kind)}, not ${JSON.stringify(value)}.`,
                { fix: `Pass ${described(kind)}.` },
            );
        }
        checked.push([name, value]);
    }

    return checked;
}
