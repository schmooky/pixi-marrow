import {
    type AttachmentRef,
    type EventKey,
    LOCAL_STRIDE,
    type PoseEngine,
    type PoseEvent,
    type PoseEventType,
    type SpineVersion,
    type TrackEntry,
    type TrackField,
    type TrackFields,
    WORLD_STRIDE,
} from '../../src/core';
import type { AnimationInfo, BoneInfo, SlotInfo } from './pose-info';

/*
 * What the three official pose drivers share. A driver takes the calls of a pose engine and makes
 * them on the official Skeleton and AnimationState of one Spine version.
 *
 * The reference is the played official skeleton, with every constraint on: IK, transform and path
 * constraints, physics in the mode the script sets, and sliders. An update is the official
 * sequence `state.update(dt)`, `skeleton.update(dt)`, `state.apply(skeleton)`,
 * `skeleton.updateWorldTransform(physics)`. 4.1 has no skeleton time and no physics mode.
 *
 * 4.3 keeps two poses of what a slider can write: the animated one and the applied one. The bone
 * pose a driver reads is the animated one, the world transforms are those of the applied one, and
 * the slot values and the draw order are the applied ones: what is drawn.
 */

/** The fields of the local pose of a bone, in the order they have in `PoseState.local`. */
export const BONE_FIELDS = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const;

/** One field of the local pose of a bone. */
export type BoneField = (typeof BONE_FIELDS)[number];

/** The calls a script makes. A pose engine and an official driver both take them. */
export type PoseDriver = Omit<PoseEngine, 'state' | 'bytes' | 'setAttachment' | 'slotPose'>;

/** A pose copied out of an official skeleton, in the layout of `PoseState`. */
export interface OfficialPose {
    /** x, y, rotation, scaleX, scaleY, shearX, shearY per bone: the animated pose, before constraints. */
    local: Float64Array;
    inherit: Uint8Array;
    active: Uint8Array;
    /**
     * a, b, c, d, worldX, worldY per bone, with every constraint solved. Zero for a bone that is
     * not active: the official value is stale there.
     */
    world: Float64Array;
    /** r, g, b, a per slot, as drawn: in 4.3 after the sliders. */
    colors: Float64Array;
    /** r, g, b per slot. Zero for a slot without a dark color. */
    darkColors: Float64Array;
    attachments: (AttachmentRef | null)[];
    /** -1 for a slot without an attachment: the official value is stale there. */
    sequenceIndices: Int32Array;
    /** The deform of each slot, as long as the official array. Empty for a slot without an attachment. */
    deform: Float64Array[];
    drawOrder: Int16Array;
}

/** What a script needs to know about a rig. */
export interface PoseRigInfo extends BoneInfo, SlotInfo {
    version: SpineVersion;
    bones: number;
    slots: number;
    skins: number;
    animations: AnimationInfo[];
    /** How many physics constraints the rig has. */
    physics: number;
    /** How many sliders the rig has. */
    sliders: number;
}

export interface OfficialDriver extends PoseDriver {
    /** Sets the position and the scale of the skeleton, as writing them to the state of a pose engine does. */
    place(x: number, y: number, scaleX: number, scaleY: number): void;
    /**
     * Writes one field of the local pose of a bone, as code outside the official runtime does
     * between two updates: `bone.rotation = value` in 4.1 and 4.2, `bone.pose.rotation = value` in 4.3.
     */
    writeBone(bone: number, field: BoneField, value: number): void;
    /**
     * Shows the attachment a skin stores under a slot and a name in a slot, or none, as code
     * outside the official runtime does between two updates: `slot.setAttachment` in 4.1 and 4.2,
     * `slot.pose.setAttachment` in 4.3. `PoseEngine.setAttachment` is our counterpart.
     */
    writeAttachment(slot: number, ref: AttachmentRef | null): void;
    /**
     * Says whether the y axis of the world points down, as writing `yDown` to the state of a pose
     * engine does. The official flag is the static `Skeleton.yDown`, one for the whole process. A
     * driver turns it on for its own update only and turns it off after it.
     */
    yDown(value: boolean): void;
    /** Sets the directions of wind and gravity, as writing them to the state of a pose engine does. 4.3 only. */
    forces(windX: number, windY: number, gravityX: number, gravityY: number): void;
    /** Copies the pose out. The next call reuses the arrays. */
    read(): OfficialPose;
}

/** A skeleton file loaded by the official core of its version, ready to make drivers. */
export interface OfficialPoseRig {
    readonly info: PoseRigInfo;
    createDriver(): OfficialDriver;
}

export function createPose(bones: number, slots: number): OfficialPose {
    return {
        local: new Float64Array(bones * LOCAL_STRIDE),
        inherit: new Uint8Array(bones),
        active: new Uint8Array(bones),
        world: new Float64Array(bones * WORLD_STRIDE),
        colors: new Float64Array(slots * 4),
        darkColors: new Float64Array(slots * 3),
        attachments: new Array<AttachmentRef | null>(slots).fill(null),
        sequenceIndices: new Int32Array(slots),
        deform: Array.from({ length: slots }, () => new Float64Array(0)),
        drawOrder: new Int16Array(slots),
    };
}

/** What `yDownKeeper` needs of an official skeleton and of its class. */
interface Flippable {
    /** The official setter. The getter gives the negated value while the static is on. */
    scaleY: number;
}

/**
 * Keeps the y direction of one official skeleton. The official `scaleY` getter negates what the
 * setter took while the static `Skeleton.yDown` is on. A script places the effective scale, so the
 * keeper gives the setter the negated scale while the skeleton is y down. `solve` runs the world
 * transform update with the static on for this skeleton only, and off again whatever happens.
 */
export function yDownKeeper(skeleton: Flippable, flag: { yDown: boolean }) {
    let down = false;
    let scaleY = 1;
    const hold = (): void => {
        skeleton.scaleY = down ? -scaleY : scaleY;
    };

    return {
        /** The effective scaleY a script placed. */
        place(value: number): void {
            scaleY = value;
            hold();
        },
        set(value: boolean): void {
            down = value;
            hold();
        },
        solve(update: () => void): void {
            flag.yDown = down;
            try {
                update();
            } finally {
                flag.yDown = false;
            }
        },
    };
}

/** Writes the seven local numbers of a bone. */
export function writeLocal(
    out: Float64Array,
    bone: number,
    pose: { x: number; y: number; rotation: number; scaleX: number; scaleY: number; shearX: number; shearY: number },
): void {
    const o = bone * LOCAL_STRIDE;

    out[o] = pose.x;
    out[o + 1] = pose.y;
    out[o + 2] = pose.rotation;
    out[o + 3] = pose.scaleX;
    out[o + 4] = pose.scaleY;
    out[o + 5] = pose.shearX;
    out[o + 6] = pose.shearY;
}

/** Writes the six world numbers of a bone, or zeros for a bone that is not active. */
export function writeWorld(
    out: Float64Array,
    bone: number,
    active: boolean,
    pose: { a: number; b: number; c: number; d: number; worldX: number; worldY: number },
): void {
    const o = bone * WORLD_STRIDE;

    out[o] = active ? pose.a : 0;
    out[o + 1] = active ? pose.b : 0;
    out[o + 2] = active ? pose.c : 0;
    out[o + 3] = active ? pose.d : 0;
    out[o + 4] = active ? pose.worldX : 0;
    out[o + 5] = active ? pose.worldY : 0;
}

interface OfficialColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

/** Writes the color and the dark color of a slot. */
export function writeColors(out: OfficialPose, slot: number, color: OfficialColor, dark: OfficialColor | null): void {
    out.colors[slot * 4] = color.r;
    out.colors[slot * 4 + 1] = color.g;
    out.colors[slot * 4 + 2] = color.b;
    out.colors[slot * 4 + 3] = color.a;
    out.darkColors[slot * 3] = dark ? dark.r : 0;
    out.darkColors[slot * 3 + 1] = dark ? dark.g : 0;
    out.darkColors[slot * 3 + 2] = dark ? dark.b : 0;
}

const NO_DEFORM: readonly number[] = [];

/** Copies the official deform of a slot. The target array is replaced when the length changes. */
function writeDeform(out: OfficialPose, slot: number, deform: ArrayLike<number>): void {
    let target = out.deform[slot];

    if (target === undefined || target.length !== deform.length) {
        target = new Float64Array(deform.length);
        out.deform[slot] = target;
    }
    target.set(deform);
}

/**
 * Finds the skin entry of an official attachment. One ref object per attachment, made once.
 * The official `getAttachment` gives undefined for a name no skin has: that is no attachment.
 */
export function cachedRefs(
    find: (attachment: object) => AttachmentRef,
): (attachment: object | null | undefined) => AttachmentRef | null {
    const cache = new Map<object, AttachmentRef>();

    return (attachment) => {
        if (attachment === null || attachment === undefined) return null;
        let ref = cache.get(attachment);

        if (ref === undefined) {
            ref = find(attachment);
            cache.set(attachment, ref);
        }

        return ref;
    };
}

/** The numbers of a slot that belong to its attachment. Without one they are stale: read as none. */
export function writeAttachment(
    out: OfficialPose,
    slot: number,
    ref: AttachmentRef | null,
    sequenceIndex: number,
    deform: ArrayLike<number>,
): void {
    out.attachments[slot] = ref;
    out.sequenceIndices[slot] = ref === null ? -1 : sequenceIndex;
    writeDeform(out, slot, ref === null ? NO_DEFORM : deform);
}

/** The fields of an official track entry that every version has. */
interface OfficialEntry {
    trackIndex: number;
    animation: object | null;
    loop: boolean;
    delay: number;
    trackTime: number;
    trackEnd: number;
    timeScale: number;
    alpha: number;
    mixTime: number;
    mixDuration: number;
    reverse: boolean;
    shortestRotation: boolean;
}

/** A read-only entry of the engine interface that reads an official track entry. */
function viewOf(entry: OfficialEntry, animationIndex: (animation: object | null) => number): TrackEntry {
    return {
        get trackIndex() {
            return entry.trackIndex;
        },
        get animation() {
            return animationIndex(entry.animation);
        },
        get loop() {
            return entry.loop;
        },
        get delay() {
            return entry.delay;
        },
        get trackTime() {
            return entry.trackTime;
        },
        get trackEnd() {
            return entry.trackEnd;
        },
        get timeScale() {
            return entry.timeScale;
        },
        get alpha() {
            return entry.alpha;
        },
        get mixTime() {
            return entry.mixTime;
        },
        get mixDuration() {
            return entry.mixDuration;
        },
        get reverse() {
            return entry.reverse;
        },
        get shortestRotation() {
            return entry.shortestRotation;
        },
    };
}

/**
 * Wraps official track entries as the read-only entries of the engine interface, and back.
 *
 * The official core pools its entry objects: after `dispose` an object is handed out again for
 * a later entry. A view stands for one use of an object. `view` gives the view of the use that
 * is going on and makes it at the first sight of the object, which is the `start` call of the
 * listener or the return of the call that made the entry. `release` ends the use at `dispose`.
 */
export function entryViews<E extends OfficialEntry>(animationIndex: (animation: object | null) => number) {
    const officials = new WeakMap<TrackEntry, E>();
    const inUse = new Map<E, TrackEntry>();

    return {
        view(entry: E): TrackEntry {
            let view = inUse.get(entry);

            if (view === undefined) {
                view = viewOf(entry, animationIndex);
                officials.set(view, entry);
                inUse.set(entry, view);
            }

            return view;
        },
        release(entry: E): void {
            inUse.delete(entry);
        },
        official(view: TrackEntry): E {
            const entry = officials.get(view);

            if (entry === undefined) throw new Error('This track entry is not from this driver');

            return entry;
        },
    };
}

/** The index of an official animation in its list. -1 for the empty animation and for no animation. */
export function animationIndexer(animations: readonly object[]): (animation: object | null) => number {
    const positions = new Map<object, number>();

    animations.forEach((animation, i) => {
        positions.set(animation, i);
    });

    return (animation) => (animation === null ? -1 : (positions.get(animation) ?? -1));
}

/**
 * Records the calls of the official listener, in the order they come. `listener` goes to
 * `AnimationState.addListener`. An event names its entry by the view of the official entry the
 * listener got.
 */
export function eventRecorder<E extends OfficialEntry, V>(
    views: { view(entry: E): TrackEntry; release(entry: E): void },
    animationIndex: (animation: object | null) => number,
    key: (event: V) => EventKey,
) {
    let events: PoseEvent[] = [];
    const record =
        (type: PoseEventType) =>
        (entry: E): void => {
            const animation = animationIndex(entry.animation);

            events.push({ type, track: entry.trackIndex, animation, entry: views.view(entry) });
        };
    const dispose = record('dispose');

    return {
        listener: {
            start: record('start'),
            interrupt: record('interrupt'),
            end: record('end'),
            dispose(entry: E): void {
                dispose(entry);
                // the official core puts the object back into its pool after this call
                views.release(entry);
            },
            complete: record('complete'),
            event(entry: E, event: V): void {
                const animation = animationIndex(entry.animation);

                events.push({
                    type: 'event',
                    track: entry.trackIndex,
                    animation,
                    entry: views.view(entry),
                    key: key(event),
                });
            },
        },
        take(): PoseEvent[] {
            const taken = events;

            events = [];

            return taken;
        },
    };
}

/** The number and flag fields every official version has. A version adds its own. */
export const COMMON_NUMBERS: readonly TrackField[] = [
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
];
export const COMMON_FLAGS: readonly TrackField[] = ['loop', 'reverse', 'shortestRotation'];

/**
 * Sets fields of an official track entry by name. `special` handles the fields that are not a
 * plain write and says whether it took the field. A field the version does not have throws.
 */
export function setEntryFields(
    entry: object,
    fields: TrackFields,
    numbers: readonly TrackField[],
    flags: readonly TrackField[],
    special: (field: string, value: number | boolean | string) => boolean,
): void {
    for (const [field, value] of Object.entries(fields)) {
        if (special(field, value)) continue;
        const isNumber = numbers.some((name) => name === field) && typeof value === 'number';
        const isFlag = flags.some((name) => name === field) && typeof value === 'boolean';

        if (!isNumber && !isFlag) {
            throw new Error(`The official track entry takes no ${field} of ${JSON.stringify(value)}`);
        }
        Reflect.set(entry, field, value);
    }
}
