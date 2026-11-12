import type { PhysicsMode, TrackFields } from '../../src/core';
import type { BoneField, PoseRigInfo } from './pose-shared';

/*
 * A script is a list of calls on a pose engine, as data. The same list runs on our engine and on
 * the official driver. Animations and skins are model indices.
 */

/** One call. `fields` of an entry call go to `configure` right after it. */
export type ScriptOp =
    | { op: 'setMix'; from: number; to: number; duration: number }
    | { op: 'defaultMix'; value: number }
    | { op: 'timeScale'; value: number }
    | { op: 'set'; track: number; animation: number; loop: boolean; fields: TrackFields }
    | { op: 'add'; track: number; animation: number; loop: boolean; delay: number; fields: TrackFields }
    | { op: 'setEmpty'; track: number; mix: number; fields: TrackFields }
    | { op: 'addEmpty'; track: number; mix: number; delay: number; fields: TrackFields }
    /** `entry` counts the entry calls of the script from 0. */
    | { op: 'configure'; entry: number; fields: TrackFields }
    | { op: 'clearTrack'; track: number }
    | { op: 'clearTracks' }
    | { op: 'skin'; skin: number }
    | { op: 'setupPose' }
    | { op: 'setupPoseBones' }
    | { op: 'setupPoseSlots' }
    /** The position and the scale of the skeleton: `x`, `y`, `scaleX` and `scaleY` of the pose state. */
    | { op: 'place'; x: number; y: number; scaleX: number; scaleY: number }
    /**
     * Whether the y axis of the world points down: `yDown` of the pose state, the official static
     * `Skeleton.yDown`. The scale `place` sets stays the effective one.
     */
    | { op: 'yDown'; value: boolean }
    /**
     * A write to the local pose of a bone from outside the engine, as a bone handle of the display
     * object makes it: one field of one bone gets a value, between two updates.
     */
    | { op: 'bone'; bone: number; field: BoneField; value: number }
    /** How physics constraints run from the next update on. */
    | { op: 'physics'; mode: PhysicsMode }
    | { op: 'physicsTranslate'; x: number; y: number }
    | { op: 'physicsRotate'; x: number; y: number; degrees: number }
    /** The directions of wind and gravity: `windX`, `windY`, `gravityX` and `gravityY` of the pose state. 4.3 only. */
    | { op: 'forces'; windX: number; windY: number; gravityX: number; gravityY: number }
    /** `times` updates of `dt` seconds, each followed by a comparison. */
    | { op: 'update'; dt: number; times: number };

export interface PoseScript {
    name: string;
    ops: ScriptOp[];
}

/** Writes the calls of a script. The entry calls return the number `configure` takes. */
export interface ScriptBuilder {
    setMix(from: number, to: number, duration: number): void;
    defaultMix(value: number): void;
    timeScale(value: number): void;
    set(track: number, animation: number, loop: boolean, fields?: TrackFields): number;
    add(track: number, animation: number, loop: boolean, delay: number, fields?: TrackFields): number;
    setEmpty(track: number, mix: number, fields?: TrackFields): number;
    addEmpty(track: number, mix: number, delay: number, fields?: TrackFields): number;
    configure(entry: number, fields: TrackFields): void;
    clearTrack(track: number): void;
    clearTracks(): void;
    skin(skin: number): void;
    setupPose(): void;
    setupPoseBones(): void;
    setupPoseSlots(): void;
    place(x: number, y: number, scaleX: number, scaleY: number): void;
    yDown(value: boolean): void;
    bone(bone: number, field: BoneField, value: number): void;
    physics(mode: PhysicsMode): void;
    physicsTranslate(x: number, y: number): void;
    physicsRotate(x: number, y: number, degrees: number): void;
    forces(windX: number, windY: number, gravityX: number, gravityY: number): void;
    update(dt: number, times?: number): void;
}

export function script(name: string, build: (s: ScriptBuilder) => void): PoseScript {
    const ops: ScriptOp[] = [];
    let entries = 0;
    const push = (op: ScriptOp): void => {
        ops.push(op);
    };
    const entry = (op: ScriptOp): number => {
        ops.push(op);

        return entries++;
    };

    build({
        setMix: (from, to, duration) => push({ op: 'setMix', from, to, duration }),
        defaultMix: (value) => push({ op: 'defaultMix', value }),
        timeScale: (value) => push({ op: 'timeScale', value }),
        set: (track, animation, loop, fields = {}) => entry({ op: 'set', track, animation, loop, fields }),
        add: (track, animation, loop, delay, fields = {}) =>
            entry({ op: 'add', track, animation, loop, delay, fields }),
        setEmpty: (track, mix, fields = {}) => entry({ op: 'setEmpty', track, mix, fields }),
        addEmpty: (track, mix, delay, fields = {}) => entry({ op: 'addEmpty', track, mix, delay, fields }),
        configure: (index, fields) => push({ op: 'configure', entry: index, fields }),
        clearTrack: (track) => push({ op: 'clearTrack', track }),
        clearTracks: () => push({ op: 'clearTracks' }),
        skin: (skin) => push({ op: 'skin', skin }),
        setupPose: () => push({ op: 'setupPose' }),
        setupPoseBones: () => push({ op: 'setupPoseBones' }),
        setupPoseSlots: () => push({ op: 'setupPoseSlots' }),
        place: (x, y, scaleX, scaleY) => push({ op: 'place', x, y, scaleX, scaleY }),
        yDown: (value) => push({ op: 'yDown', value }),
        bone: (bone, field, value) => push({ op: 'bone', bone, field, value }),
        physics: (mode) => push({ op: 'physics', mode }),
        physicsTranslate: (x, y) => push({ op: 'physicsTranslate', x, y }),
        physicsRotate: (x, y, degrees) => push({ op: 'physicsRotate', x, y, degrees }),
        forces: (windX, windY, gravityX, gravityY) => push({ op: 'forces', windX, windY, gravityX, gravityY }),
        update: (dt, times = 1) => push({ op: 'update', dt, times }),
    });

    return { name, ops };
}

/** A short text for one call, for failure messages. */
export function describeOp(op: ScriptOp): string {
    const { op: name, ...rest } = op;
    const values = Object.entries(rest).map(([key, value]) => `${key} ${JSON.stringify(value)}`);

    return [name, ...values].join(' ');
}

export const DT = 1 / 30;
/** A step that lands on no key time. */
export const ODD = 0.0171;

/** Three animations of a rig and their durations. `a` has events when the rig has any. */
export function pick(rig: PoseRigInfo, shift = 0) {
    const n = rig.animations.length;

    if (n === 0) throw new Error('The rig has no animations to script');
    const start = Math.max(
        0,
        rig.animations.findIndex((animation) => animation.events),
    );
    const at = (offset: number): number => (start + shift + offset) % n;
    const duration = (index: number): number => rig.animations[index]?.duration ?? 0;
    const name = (index: number): string => rig.animations[index]?.name ?? `animation ${index}`;

    return { a: at(0), b: at(1), c: at(n - 1), duration, name };
}

/** The fields that set the three mix thresholds, by the names of the version. */
export function thresholds(rig: PoseRigInfo, value: number): TrackFields {
    return rig.version === '4.1'
        ? { eventThreshold: value, attachmentThreshold: value, drawOrderThreshold: value }
        : { eventThreshold: value, mixAttachmentThreshold: value, mixDrawOrderThreshold: value };
}
