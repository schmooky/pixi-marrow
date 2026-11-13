import {
    type AttachmentData,
    type AttachmentRef,
    LOCAL_STRIDE,
    nextVersion,
    type PoseEngine,
    type SkeletonModel,
    WORLD_STRIDE,
} from '../../src/core';
import { createAttachmentLookup } from '../../src/pose/shared/lookup';
import { createPoseState, type PoseState } from '../../src/pose/state';
import { BONE_FIELDS, type OfficialDriver, type OfficialPose } from './pose-shared';

/*
 * A pose engine made of an official driver. It makes every call on the driver and copies the pose
 * of the official skeleton into a pose state after it, with stamps that are honest and tight:
 * a stamp moves when its values changed and only then. The self-check of the stamp check runs on
 * it, so that the check is proven without one of our engines.
 */

/** The stamps and the version of a state before a call. */
interface StampsBefore {
    boneStamps: Uint32Array;
    slotStamps: Uint32Array;
    drawOrderStamp: number;
    version: number;
}

/**
 * Changes the stamps of a mirror after a call, to make them lie. `call` names the call of the
 * engine, such as `update` or `setupPoseSlots`.
 */
export type Tamper = (state: PoseState, before: StampsBefore, call: string) => void;

const CREATED = 'created';

function differs(now: ArrayLike<number>, before: ArrayLike<number>, at: number, count: number): boolean {
    for (let i = at; i < at + count; i++) {
        if (!Object.is(now[i], before[i])) return true;
    }

    return false;
}

/** Copies `count` numbers at `at` from the official pose. Returns whether one of them changed. */
function copy(
    from: ArrayLike<number>,
    into: Float64Array | Uint8Array | Int32Array | Int16Array,
    at: number,
    count: number,
): boolean {
    const changed = differs(from, into, at, count);

    for (let i = at; i < at + count; i++) into[i] = from[i] ?? 0;

    return changed;
}

/** Copies the deform of a slot. The array of the state grows when the deform needs more room. */
function copyDeform(state: PoseState, slot: number, deform: Float64Array): boolean {
    const changed =
        state.deformLengths[slot] !== deform.length || differs(deform, state.deform[slot] ?? [], 0, deform.length);

    if ((state.deform[slot]?.length ?? 0) < deform.length) state.deform[slot] = new Float64Array(deform.length);
    state.deform[slot]?.set(deform);
    state.deformLengths[slot] = deform.length;

    return changed;
}

/** Copies an official pose into a state and stamps what changed. */
function mirror(state: PoseState, pose: OfficialPose, resolve: (slot: number) => AttachmentData | null): void {
    const { bones, slots } = state.model;
    let version = state.version;
    // the version goes up once, at the first change
    const stamp = (): number => {
        if (version === state.version) version = nextVersion(state.version);

        return version;
    };

    state.local.set(pose.local);
    state.inherit.set(pose.inherit);
    for (let i = 0; i < bones.count; i++) {
        const moved = copy(pose.world, state.world, i * WORLD_STRIDE, WORLD_STRIDE);

        if (copy(pose.active, state.active, i, 1) || moved) state.boneStamps[i] = stamp();
    }
    for (let i = 0; i < slots.count; i++) {
        const attachment = resolve(i);
        const colored = copy(pose.colors, state.colors, i * 4, 4);
        const darkened = copy(pose.darkColors, state.darkColors, i * 3, 3);
        const stepped = copy(pose.sequenceIndices, state.sequenceIndices, i, 1);
        const deformed = copyDeform(state, i, pose.deform[i] ?? new Float64Array(0));

        if (colored || darkened || stepped || deformed || state.attachments[i] !== attachment)
            state.slotStamps[i] = stamp();
        state.attachments[i] = attachment;
    }
    if (copy(pose.drawOrder, state.drawOrder, 0, slots.count)) state.drawOrderStamp = stamp();
    state.version = version;
}

/**
 * Makes a pose engine out of an official driver of the same skeleton. `tamper` runs after every
 * call that can change the pose, for a test that needs stamps that lie.
 */
export function mirrorEngine(model: SkeletonModel, driver: OfficialDriver, tamper: Tamper = () => {}): PoseEngine {
    const state = createPoseState(model);
    const lookup = createAttachmentLookup(model);
    // the first skin entry of every attachment object, to tell the official side which one to show
    const refs = new Map<AttachmentData, AttachmentRef>();

    model.skins.forEach((skin, index) => {
        for (const { slot, name, attachment } of skin.attachments) {
            if (!refs.has(attachment)) refs.set(attachment, { skin: index, slot, name });
        }
    });
    const sync = (call: string): void => {
        const before = {
            boneStamps: state.boneStamps.slice(),
            slotStamps: state.slotStamps.slice(),
            drawOrderStamp: state.drawOrderStamp,
            version: state.version,
        };
        const pose = driver.read();

        mirror(state, pose, (slot) => {
            const ref = pose.attachments[slot];

            return ref ? (lookup.resolve(ref) ?? null) : null;
        });
        // the pose a new engine starts with is not a call
        if (call !== CREATED) tamper(state, before, call);
    };
    /** What a script wrote to the state goes to the official skeleton before the next call that reads it. */
    const forward = (): void => {
        const local = driver.read().local;

        driver.place(state.x, state.y, state.scaleX, state.scaleY);
        driver.yDown(state.yDown);
        driver.forces(state.windX, state.windY, state.gravityX, state.gravityY);
        // a number of the local pose that is not the official one any more was written from outside
        state.local.forEach((value, i) => {
            const field = BONE_FIELDS[i % LOCAL_STRIDE];

            if (field !== undefined && !Object.is(value, local[i]))
                driver.writeBone(Math.floor(i / LOCAL_STRIDE), field, value);
        });
    };
    const posing = (call: string, run: () => void): void => {
        forward();
        run();
        sync(call);
    };

    sync(CREATED);

    return {
        state,
        bytes: 0,
        get timeScale() {
            return driver.timeScale;
        },
        set timeScale(value) {
            driver.timeScale = value;
        },
        get defaultMix() {
            return driver.defaultMix;
        },
        set defaultMix(value) {
            driver.defaultMix = value;
        },
        get physics() {
            return driver.physics;
        },
        set physics(value) {
            driver.physics = value;
        },
        setMix: (from, to, duration) => driver.setMix(from, to, duration),
        setAnimation: (track, animation, loop) => driver.setAnimation(track, animation, loop),
        addAnimation: (track, animation, loop, delay) => driver.addAnimation(track, animation, loop, delay),
        setEmptyAnimation: (track, mixDuration) => driver.setEmptyAnimation(track, mixDuration),
        addEmptyAnimation: (track, mixDuration, delay) => driver.addEmptyAnimation(track, mixDuration, delay),
        configure: (entry, fields) => driver.configure(entry, fields),
        clearTrack: (track) => driver.clearTrack(track),
        clearTracks: () => driver.clearTracks(),
        setSkin: (skin) => posing('setSkin', () => driver.setSkin(skin)),
        setSkins: (skins) => posing('setSkins', () => driver.setSkins(skins)),
        get skins() {
            return driver.skins;
        },
        setAttachment(slot, attachment) {
            const ref = attachment === null ? null : refs.get(attachment);

            if (ref === undefined) throw new Error('The mirror shows attachments of the model only');
            posing('setAttachment', () => driver.writeAttachment(slot, ref));
        },
        setColor: (slot, r, g, b, a) => posing('setColor', () => driver.setColor(slot, r, g, b, a)),
        setDarkColor: (slot, r, g, b) => posing('setDarkColor', () => driver.setDarkColor(slot, r, g, b)),
        setupPose: () => posing('setupPose', () => driver.setupPose()),
        setupPoseBones: () => posing('setupPoseBones', () => driver.setupPoseBones()),
        setupPoseSlots: () => posing('setupPoseSlots', () => driver.setupPoseSlots()),
        physicsTranslate: (x, y) => driver.physicsTranslate(x, y),
        physicsRotate: (x, y, degrees) => driver.physicsRotate(x, y, degrees),
        update: (dt) => posing('update', () => driver.update(dt)),
        takeEvents: () => driver.takeEvents(),
    };
}
