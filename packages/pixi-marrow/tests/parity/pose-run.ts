import {
    type AttachmentData,
    type AttachmentRef,
    LOCAL_STRIDE,
    nextVersion,
    type PoseEngine,
    type SkeletonModel,
    type TrackEntry,
    type TrackFields,
    WORLD_STRIDE,
} from '../../src/core';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { differences } from './compare';
import { describeOp, type PoseScript, type ScriptOp } from './pose-script';
import { BONE_FIELDS, type BoneField, type OfficialDriver, type PoseDriver } from './pose-shared';
import { stampWatch } from './pose-stamps';

/*
 * Runs one script on two sides and compares them after every update. A side is a pose engine or
 * an official driver, plus a way to read its pose as a plain object of typed arrays. After every
 * call, an update or any other, the stamps of our side must have reported what the call changed.
 */

/** One side of a comparison. */
export interface Subject {
    driver: PoseDriver;
    /** Sets the position and the scale of the skeleton. */
    place(x: number, y: number, scaleX: number, scaleY: number): void;
    /** Says whether the y axis of the world points down. The scale of the skeleton stays what `place` set. */
    yDown(value: boolean): void;
    /** Sets the directions of wind and gravity. */
    forces(windX: number, windY: number, gravityX: number, gravityY: number): void;
    /** Writes one field of the local pose of a bone from outside the engine, between two updates. */
    writeBone(bone: number, field: BoneField, value: number): void;
    /** The pose, in the same shape on both sides. Attachments are names, so they compare by identity. */
    read(): Record<string, unknown>;
    /**
     * What changed since the call before without a stamp of the pose state that reports it, as
     * text. Empty when the stamps are honest, and always on the official side, which has none.
     * The runner asks after every call.
     */
    stamps(): string;
}

const refLabel = (ref: AttachmentRef): string => `skin ${ref.skin}, slot ${ref.slot}, ${ref.name}`;

/** The official side. `label` names the attachment a ref points at. */
export function officialSubject(driver: OfficialDriver, label: (ref: AttachmentRef) => string = refLabel): Subject {
    return {
        driver,
        place: (x, y, scaleX, scaleY) => driver.place(x, y, scaleX, scaleY),
        yDown: (value) => driver.yDown(value),
        forces: (windX, windY, gravityX, gravityY) => driver.forces(windX, windY, gravityX, gravityY),
        writeBone: (bone, field, value) => driver.writeBone(bone, field, value),
        read() {
            const pose = driver.read();

            return { ...pose, attachments: pose.attachments.map((ref) => (ref === null ? null : label(ref))) };
        },
        stamps: () => '',
    };
}

/**
 * Our side. What nothing can observe is read as on the official side: zero for the world
 * transform of a bone that is not active and for the dark color of a slot that has none, and no
 * sequence index and no deform for a slot without an attachment. Deform counts over its used
 * length only.
 */
export function engineSubject(engine: PoseEngine, label: (attachment: AttachmentData) => string): Subject {
    const { state } = engine;
    const { bones, slots } = state.model;
    const world = new Float64Array(state.world.length);
    const darkColors = new Float64Array(state.darkColors.length);
    const watch = stampWatch(state);

    return {
        driver: engine,
        place(x, y, scaleX, scaleY) {
            Object.assign(state, { x, y, scaleX, scaleY });
        },
        yDown(value) {
            state.yDown = value;
        },
        forces(windX, windY, gravityX, gravityY) {
            Object.assign(state, { windX, windY, gravityX, gravityY });
        },
        writeBone(bone, field, value) {
            state.local[bone * LOCAL_STRIDE + BONE_FIELDS.indexOf(field)] = value;
            // the mark the doc of `version` asks of code that writes an array. The local pose has no
            // stamp, and no world transform has changed yet, so the version is all there is to raise.
            state.version = nextVersion(state.version);
        },
        read() {
            world.set(state.world);
            for (let i = 0; i < bones.count; i++) {
                if (state.active[i] === 0) world.fill(0, i * WORLD_STRIDE, (i + 1) * WORLD_STRIDE);
            }
            darkColors.set(state.darkColors);
            for (let i = 0; i < slots.count; i++) {
                if (slots.hasDark[i] === 0) darkColors.fill(0, i * 3, i * 3 + 3);
            }

            return {
                local: state.local,
                inherit: state.inherit,
                active: state.active,
                world,
                colors: state.colors,
                darkColors,
                attachments: state.attachments.map((attachment) => (attachment === null ? null : label(attachment))),
                sequenceIndices: state.sequenceIndices.map((index, i) => (state.attachments[i] === null ? -1 : index)),
                deform: state.deform.map((values, i) =>
                    values.subarray(0, state.attachments[i] === null ? 0 : (state.deformLengths[i] ?? 0)),
                ),
                drawOrder: state.drawOrder,
            };
        },
        stamps: () => watch.faults(),
    };
}

/**
 * Our side next to a second engine of the same model. Before every update of the first, the
 * second plays the animations of the rig in turn, at its own pace and mirrored. What an engine
 * keeps from one update to the next must be its own: with a key, a path or a pose kept in a place
 * that instances share, the first engine poses wrong.
 */
export function besideAnother(subject: Subject, other: PoseEngine, animations: number): Subject {
    let updates = 0;
    const update = (dt: number): void => {
        if (updates % 5 === 0) other.setAnimation(0, (updates / 5) % animations, updates % 2 === 0);
        if (updates % 11 === 0) other.setAnimation(1, (updates / 11 + 1) % animations, true);
        updates++;
        other.update(dt * 2.7 + 0.013);
        other.takeEvents();
        subject.driver.update(dt);
    };
    const driver: PoseDriver = new Proxy(subject.driver, {
        get(target, key) {
            const value: unknown = Reflect.get(target, key);

            if (key === 'update') return update;

            // bound to the engine itself, so that the engine does not see the proxy
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set: (target, key, value) => Reflect.set(target, key, value),
    });

    other.state.scaleX = -1.2;
    other.state.x = 40;

    return { ...subject, driver };
}

/**
 * Names for the attachment objects of a model. Two names are equal only for the same object, so
 * comparing `ofObject` of our slot with `ofRef` of the official ref is the identity check: our
 * slot must hold the object that `lookup.resolve(ref)` returns.
 */
export function attachmentLabels(model: SkeletonModel) {
    const lookup = createAttachmentLookup(model);
    const names = new Map<AttachmentData, string>();

    model.skins.forEach((skin, index) => {
        for (const { slot, name, attachment } of skin.attachments) {
            if (!names.has(attachment)) names.set(attachment, refLabel({ skin: index, slot, name }));
        }
    });
    const ofObject = (attachment: AttachmentData): string =>
        names.get(attachment) ?? `an object from outside the model (${attachment.type} ${attachment.name})`;

    return {
        ofObject,
        ofRef(ref: AttachmentRef): string {
            const attachment = lookup.resolve(ref);

            return attachment === undefined ? `missing from the model (${refLabel(ref)})` : ofObject(attachment);
        },
    };
}

const entryFields = (entry: TrackEntry) => ({
    trackIndex: entry.trackIndex,
    animation: entry.animation,
    loop: entry.loop,
    delay: entry.delay,
    trackTime: entry.trackTime,
    trackEnd: entry.trackEnd,
    timeScale: entry.timeScale,
    alpha: entry.alpha,
    mixTime: entry.mixTime,
    mixDuration: entry.mixDuration,
    reverse: entry.reverse,
    shortestRotation: entry.shortestRotation,
});

/** Keeps an entry a call made, after setting its fields. */
function made(driver: PoseDriver, entries: TrackEntry[], entry: TrackEntry, fields: TrackFields): TrackEntry {
    if (Object.keys(fields).length > 0) driver.configure(entry, fields);
    entries.push(entry);

    return entry;
}

function configured(driver: PoseDriver, entries: TrackEntry[], index: number, fields: TrackFields): TrackEntry {
    const entry = entries[index];

    if (entry === undefined) throw new Error(`The script made no entry ${index}`);
    driver.configure(entry, fields);

    return entry;
}

/** Makes one call that is not an update. Returns the entry the call made or changed. */
function call(subject: Subject, op: ScriptOp, entries: TrackEntry[]): TrackEntry | undefined {
    const { driver } = subject;

    switch (op.op) {
        case 'set':
            return made(driver, entries, driver.setAnimation(op.track, op.animation, op.loop), op.fields);
        case 'add':
            return made(driver, entries, driver.addAnimation(op.track, op.animation, op.loop, op.delay), op.fields);
        case 'setEmpty':
            return made(driver, entries, driver.setEmptyAnimation(op.track, op.mix), op.fields);
        case 'addEmpty':
            return made(driver, entries, driver.addEmptyAnimation(op.track, op.mix, op.delay), op.fields);
        case 'configure':
            return configured(driver, entries, op.entry, op.fields);
        case 'setMix':
            driver.setMix(op.from, op.to, op.duration);
            break;
        case 'defaultMix':
            driver.defaultMix = op.value;
            break;
        case 'timeScale':
            driver.timeScale = op.value;
            break;
        case 'clearTrack':
            driver.clearTrack(op.track);
            break;
        case 'clearTracks':
            driver.clearTracks();
            break;
        case 'skin':
            driver.setSkin(op.skin);
            break;
        case 'setupPose':
            driver.setupPose();
            break;
        case 'setupPoseBones':
            driver.setupPoseBones();
            break;
        case 'setupPoseSlots':
            driver.setupPoseSlots();
            break;
        case 'place':
            subject.place(op.x, op.y, op.scaleX, op.scaleY);
            break;
        case 'yDown':
            subject.yDown(op.value);
            break;
        case 'bone':
            subject.writeBone(op.bone, op.field, op.value);
            break;
        case 'physics':
            driver.physics = op.mode;
            break;
        case 'physicsTranslate':
            driver.physicsTranslate(op.x, op.y);
            break;
        case 'physicsRotate':
            driver.physicsRotate(op.x, op.y, op.degrees);
            break;
        case 'forces':
            subject.forces(op.windX, op.windY, op.gravityX, op.gravityY);
            break;
        case 'update':
            driver.update(op.dt);
            break;
    }

    return undefined;
}

/** What an event names when no script call made its entry on that side, or when the entry was disposed before. */
export const NO_SCRIPT_ENTRY = 'an entry no script call made';

const ENTRY_CALLS: readonly ScriptOp['op'][] = ['set', 'add', 'setEmpty', 'addEmpty'];

/** One side while a script runs: its entries, by the number of the entry call that made them. */
interface Side {
    subject: Subject;
    /** The entry each entry call returned, in call order. `configure` picks from it. */
    entries: TrackEntry[];
    /**
     * The number of the entry call behind every entry object in use. Entry objects differ on the
     * two sides, the numbers do not. An engine may hand an object out again after its `dispose`
     * event, so that event ends the number of the object and the next entry call gives it a new one.
     */
    ordinals: Map<TrackEntry, number>;
    /** The events since the last comparison. They name their entry by its number. */
    events: object[];
}

const sideOf = (subject: Subject): Side => ({ subject, entries: [], ordinals: new Map(), events: [] });

/**
 * Takes the events of a side and names their entries by number, right after every call, while
 * the entry objects still stand for the entries the events are about. `created` is the entry the
 * call made: its `start` event comes before the call returns it.
 */
function collect(side: Side, created?: TrackEntry): void {
    const ordinal = side.entries.length - 1;

    for (const { entry, ...event } of side.subject.driver.takeEvents()) {
        if (entry === created && !side.ordinals.has(entry)) side.ordinals.set(entry, ordinal);
        side.events.push({ ...event, entry: side.ordinals.get(entry) ?? NO_SCRIPT_ENTRY });
        if (event.type === 'dispose') side.ordinals.delete(entry);
    }
    if (created !== undefined) side.ordinals.set(created, ordinal);
}

const frame = (side: Side) => ({ ...side.subject.read(), stamps: side.subject.stamps(), events: side.events });

/** One update on both sides. Returns where the poses or the events since the last update differ. */
function updateBoth(ours: Side, theirs: Side, dt: number): string[] {
    ours.subject.driver.update(dt);
    theirs.subject.driver.update(dt);
    collect(ours);
    collect(theirs);
    const lines = differences(frame(ours), frame(theirs));

    if (lines.length === 0) {
        ours.events = [];
        theirs.events = [];
    }

    return lines;
}

/**
 * One other call on both sides. Returns where the entries it made or changed differ, and what the
 * call changed in the pose without a stamp: a call such as a setup pose call writes the pose at once.
 */
function callBoth(ours: Side, theirs: Side, op: ScriptOp): string[] {
    const mine = call(ours.subject, op, ours.entries);
    const official = call(theirs.subject, op, theirs.entries);
    const creates = ENTRY_CALLS.includes(op.op);

    collect(ours, creates ? mine : undefined);
    collect(theirs, creates ? official : undefined);

    return differences(
        { entry: mine && entryFields(mine), stamps: ours.subject.stamps() },
        { entry: official && entryFields(official), stamps: theirs.subject.stamps() },
    );
}

/**
 * Runs a script on both sides. After every update the poses and the events must be equal, and
 * after every entry call the fields of the two entries. Events compare in order, with the entry
 * of each as the number of the script call that made it. Returns null, or a message that names
 * the script, the step and the first differences as `path: actual, expected ...` lines.
 */
export function runScript(script: PoseScript, actual: Subject, expected: Subject): string | null {
    const ours = sideOf(actual);
    const theirs = sideOf(expected);
    let updates = 0;
    let where = 'before the first call';
    const failure = (lines: string[]): string =>
        `script "${script.name}", ${where}\n${lines.map((line) => `    ${line}`).join('\n')}`;

    try {
        for (const [index, op] of script.ops.entries()) {
            const step = `step ${index + 1} of ${script.ops.length}`;
            const times = op.op === 'update' ? op.times : 1;

            for (let i = 0; i < times; i++) {
                where =
                    op.op === 'update'
                        ? `${step}, update ${i + 1} of ${times} by ${op.dt} (update ${++updates} of the script)`
                        : `${step}, ${describeOp(op)}`;
                const lines = op.op === 'update' ? updateBoth(ours, theirs, op.dt) : callBoth(ours, theirs, op);

                if (lines.length > 0) return failure(lines);
            }
        }
        where = 'after the last call';
        // the last calls can report events too
        const lines = differences({ events: ours.events }, { events: theirs.events });

        return lines.length > 0 ? failure(lines) : null;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        throw new Error(`script "${script.name}", ${where}: ${message}`, { cause: error });
    }
}
