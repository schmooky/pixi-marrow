import type { TrackEntry, TrackFields } from '../engine';
import { checkFields, type FieldKind, type FieldRules } from '../shared/configure';
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

/** The fields of a track entry of one version, and what the version has in the place of the fields of the others. */
function rulesOf(
    version: string,
    numbers: ReadonlyMap<string, NumberField>,
    instead: Record<string, string>,
): FieldRules {
    return {
        version,
        kinds: new Map<string, FieldKind>([
            ...[...numbers.keys()].map((name): [string, FieldKind] => [name, 'number']),
            ...[...BOOLEANS].map((name): [string, FieldKind] => [name, 'boolean']),
            ['mixBlend', MIX_BLENDS],
        ]),
        instead: {
            ...instead,
            additive: 'Set "mixBlend" to "add".',
        },
    };
}

const RULES_41: FieldRules = rulesOf('4.1', NUMBERS_41, {
    mixAttachmentThreshold: 'Set "attachmentThreshold".',
    mixDrawOrderThreshold: 'Set "drawOrderThreshold".',
    alphaAttachmentThreshold: 'Spine 4.1 has no threshold for the alpha of attachments. Leave the field out.',
});
const RULES_42: FieldRules = rulesOf('4.2', NUMBERS_42, {
    attachmentThreshold: 'Set "mixAttachmentThreshold".',
    drawOrderThreshold: 'Set "mixDrawOrderThreshold".',
});

function isBooleanField(name: string): name is BooleanField {
    return BOOLEANS.has(name);
}

/**
 * Sets fields of an entry by their official names. Every field is a plain assignment, except
 * `animationLast`, which is set as the official `setAnimationLast` sets it. Every field is
 * checked before the first one is written, so a call that throws changes nothing.
 */
export function configureEntry(entry: LegacyEntry, fields: TrackFields, v41: boolean): void {
    const numbers = v41 ? NUMBERS_41 : NUMBERS_42;

    for (const [name, value] of checkFields(fields, v41 ? RULES_41 : RULES_42)) {
        const numberField = numbers.get(name);

        if (typeof value === 'number' && numberField !== undefined) {
            entry[numberField] = value;
            // the official setAnimationLast: the plain field would be lost on the next update
            if (numberField === 'animationLast') entry.nextAnimationLast = value;
        } else if (typeof value === 'boolean' && isBooleanField(name)) entry[name] = value;
        else if (typeof value === 'string') entry.mixBlend = MIX_BLENDS.indexOf(value);
    }
}
