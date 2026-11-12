import { MarrowError } from '../../base/errors';
import type { TrackEntry, TrackFields } from '../engine';
import { type Clip, MIX_BLENDS, REPLACE } from './timelines';

/** Timeline mode of an entry that never had its modes computed. The official array holds nothing there. */
export const MODE_UNSET = 255;

/**
 * A track entry: the official `TrackEntry` with the same fields and the same defaults. The 4.1
 * fields `attachmentThreshold` and `drawOrderThreshold` are stored under their 4.2 names,
 * `mixAttachmentThreshold` and `mixDrawOrderThreshold`.
 */
export class LegacyEntry implements TrackEntry {
    readonly trackIndex: number;
    /** The index of the animation in the model, or -1 for the empty animation. */
    readonly animation: number;
    readonly clip: Clip;
    next: LegacyEntry | null = null;
    mixingFrom: LegacyEntry | null = null;
    mixingTo: LegacyEntry | null = null;
    loop: boolean;
    holdPrevious = false;
    reverse = false;
    shortestRotation = false;
    eventThreshold = 0;
    mixAttachmentThreshold = 0;
    /** 4.2 only. */
    alphaAttachmentThreshold = 0;
    mixDrawOrderThreshold = 0;
    animationStart = 0;
    animationEnd: number;
    animationLast = -1;
    nextAnimationLast = -1;
    delay = 0;
    trackTime = 0;
    trackLast = -1;
    nextTrackLast = -1;
    trackEnd: number = Number.MAX_VALUE;
    timeScale = 1;
    alpha = 1;
    mixTime = 0;
    mixDuration: number;
    interruptAlpha = 1;
    totalAlpha = 0;
    /** One of the official `MixBlend` values. */
    mixBlend: number = REPLACE;
    /** How each timeline mixes, computed when the tracks change. `MODE_UNSET` before that. */
    readonly timelineMode: Uint8Array;
    /** For timelines in mode `HOLD_MIX`: the entry whose mix fades the timeline out. */
    readonly timelineHoldMix: (LegacyEntry | undefined)[] = [];
    /**
     * Per timeline two numbers for rotate timelines: the total rotation and the last difference.
     * Allocated the first time the entry is mixed. A NaN stands for a number that was never written.
     */
    timelinesRotation: Float64Array | null = null;
    /** The official `timelinesRotation.length`: 0 until the entry is mixed and after a reset. */
    rotationLength = 0;

    constructor(trackIndex: number, clip: Clip, loop: boolean, mixDuration: number) {
        this.trackIndex = trackIndex;
        this.animation = clip.index;
        this.clip = clip;
        this.loop = loop;
        this.animationEnd = clip.duration;
        this.mixDuration = mixDuration;
        this.timelineMode = new Uint8Array(clip.timelines.length).fill(MODE_UNSET);
    }

    /** The official `getTrackComplete`: the track time at which the animation or its current loop ends. */
    getTrackComplete(): number {
        const duration = this.animationEnd - this.animationStart;

        if (duration !== 0) {
            if (this.loop) return duration * (1 + ((this.trackTime / duration) | 0));
            if (this.trackTime < duration) return duration;
        }

        return this.trackTime;
    }
}

type NumberField =
    | 'eventThreshold'
    | 'mixAttachmentThreshold'
    | 'alphaAttachmentThreshold'
    | 'mixDrawOrderThreshold'
    | 'animationStart'
    | 'animationEnd'
    | 'animationLast'
    | 'delay'
    | 'trackTime'
    | 'trackEnd'
    | 'timeScale'
    | 'alpha'
    | 'mixTime'
    | 'mixDuration';
type BooleanField = 'loop' | 'holdPrevious' | 'reverse' | 'shortestRotation';

/** The number fields both versions have. */
const NUMBERS: readonly NumberField[] = [
    'eventThreshold',
    'animationStart',
    'animationEnd',
    'animationLast',
    'delay',
    'trackTime',
    'trackEnd',
    'timeScale',
    'alpha',
    'mixTime',
    'mixDuration',
];
const BOOLEANS: ReadonlySet<string> = new Set<BooleanField>(['loop', 'holdPrevious', 'reverse', 'shortestRotation']);
/** The official name of a number field to the field that stores it. */
const NUMBERS_41: ReadonlyMap<string, NumberField> = new Map<string, NumberField>([
    ...NUMBERS.map((name): [string, NumberField] => [name, name]),
    ['attachmentThreshold', 'mixAttachmentThreshold'],
    ['drawOrderThreshold', 'mixDrawOrderThreshold'],
]);
const NUMBERS_42: ReadonlyMap<string, NumberField> = new Map<string, NumberField>([
    ...NUMBERS.map((name): [string, NumberField] => [name, name]),
    ['mixAttachmentThreshold', 'mixAttachmentThreshold'],
    ['alphaAttachmentThreshold', 'alphaAttachmentThreshold'],
    ['mixDrawOrderThreshold', 'mixDrawOrderThreshold'],
]);

type Write = (entry: LegacyEntry) => void;

function wrongType(name: string, expected: string, value: unknown): MarrowError {
    return new MarrowError('invalid-data', `The track entry field "${name}" was set to ${String(value)}.`, {
        fix: `Pass ${expected}.`,
    });
}

function isBooleanField(name: string): name is BooleanField {
    return BOOLEANS.has(name);
}

/** Checks one field and returns the write that sets it. */
function fieldWrite(name: string, value: unknown, v41: boolean): Write {
    const numberField = (v41 ? NUMBERS_41 : NUMBERS_42).get(name);

    if (numberField !== undefined) {
        if (typeof value !== 'number') throw wrongType(name, 'a number', value);

        return (entry) => {
            entry[numberField] = value;
            // the official setAnimationLast: the plain field would be lost on the next update
            if (numberField === 'animationLast') entry.nextAnimationLast = value;
        };
    }
    if (isBooleanField(name)) {
        if (typeof value !== 'boolean') throw wrongType(name, 'true or false', value);

        return (entry) => {
            entry[name] = value;
        };
    }
    if (name === 'mixBlend') {
        const blend = typeof value === 'string' ? MIX_BLENDS.indexOf(value) : -1;

        if (blend < 0) throw wrongType(name, `one of ${MIX_BLENDS.join(', ')}`, value);

        return (entry) => {
            entry.mixBlend = blend;
        };
    }
    const version = v41 ? '4.1' : '4.2';
    const validNames = [...(v41 ? NUMBERS_41 : NUMBERS_42).keys(), ...BOOLEANS, 'mixBlend'];

    throw new MarrowError('unsupported-feature', `A track entry of Spine ${version} has no field "${name}".`, {
        fix: `Set one of the fields of that version: ${validNames.join(', ')}.`,
        validNames,
    });
}

/**
 * Sets fields of an entry by their official names. Every field is a plain assignment, except
 * `animationLast`, which is set as the official `setAnimationLast` sets it. Every field is
 * checked before the first one is written, so a call that throws changes nothing.
 */
export function configureEntry(entry: LegacyEntry, fields: TrackFields, v41: boolean): void {
    const writes = Object.entries(fields).map(([name, value]) => fieldWrite(name, value, v41));

    for (const write of writes) write(entry);
}
