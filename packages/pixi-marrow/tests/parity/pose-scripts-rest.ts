import type { TrackFields } from '../../src/core';
import { DT, ODD, type PoseScript, pick, type ScriptBuilder, script } from './pose-script';
import type { PoseRigInfo } from './pose-shared';

/*
 * Scripts for rest and waking. A skeleton is at rest when an update changes nothing in its pose:
 * nothing plays, an animation that does not loop is past its end, time stands still. A pose
 * engine may leave out the work of such an update, but not what the update does to the clocks:
 * the time of a track, of a mix, of the skeleton and of its physics. Each script brings the
 * skeleton to rest in one way and then wakes it in many, so that work left out by mistake shows
 * in the first update after the wake.
 */

/** Steps over the end of an animation and a third of its length on, whatever the length is. */
function past(s: ScriptBuilder, duration: number): void {
    s.update(Math.max(DT, duration * 0.45), 3);
}

/**
 * Shows the time of an entry that rests past the end of its animation: looped for two updates,
 * the pose is the one of the time the track went up to while nothing changed.
 */
function clock(s: ScriptBuilder, entry: number): void {
    s.configure(entry, { loop: true });
    s.update(ODD, 2);
    s.configure(entry, { loop: false });
    s.update(DT, 2);
}

/** What makes an entry add to the tracks below it, in the words of the version. */
const adding = (rig: PoseRigInfo): TrackFields => (rig.version === '4.3' ? { additive: true } : { mixBlend: 'add' });

/**
 * An animation that does not loop, hundreds of updates past its end. Then fields of its entry
 * change. The time of the track went on all the while: with `loop` on, the pose is the one of that time.
 */
function ownEntry(rig: PoseRigInfo): PoseScript[] {
    const { a, duration } = pick(rig);
    const d = duration(a);

    return [
        script('rest far past the end, woken by fields of the entry', (s) => {
            const entry = s.set(0, a, false);

            past(s, d);
            s.update(DT, 120);
            s.update(ODD, 70);
            s.update(1 / 16, 40);
            s.configure(entry, { loop: true });
            s.update(DT, 6);
            s.configure(entry, { loop: false });
            s.update(DT, 4);
            // set back into the animation: it plays to its end again
            s.configure(entry, { trackTime: d * 0.35 });
            s.update(DT, 4);
            past(s, d);
            s.update(DT, 4);
            // reversed at rest: the pose of the start
            s.configure(entry, { reverse: true });
            s.update(DT, 4);
            s.configure(entry, { reverse: false });
            s.update(DT, 3);
            s.configure(entry, { alpha: 0.5 });
            s.update(DT, 4);
            s.configure(entry, { alpha: 1 });
            s.update(DT, 3);
            // an earlier end: the pose goes back to that time
            s.configure(entry, { animationEnd: d * 0.5 });
            s.update(DT, 4);
            s.configure(entry, { animationStart: d * 0.25 });
            s.update(DT, 3);
            s.configure(entry, { animationStart: 0, animationEnd: d });
            s.update(DT, 3);
            // backwards from a little past the end, then forwards at twice the speed
            s.configure(entry, { trackTime: d * 1.1, timeScale: -1 });
            s.update(Math.max(DT, d * 0.15), 6);
            s.configure(entry, { timeScale: 2 });
            past(s, d);
            s.update(DT, 4);
            // a track end that lies behind: the next update ends the track
            s.configure(entry, { trackEnd: d });
            s.update(DT, 5);
        }),
    ];
}

/** Rest after an animation ended, woken by other animations: set, queued, mixed in, and the empty animation. */
function animations(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c, duration } = pick(rig, 1);

    return [
        script('rest woken by animations', (s) => {
            s.defaultMix(0.2);
            s.set(0, a, false);
            past(s, duration(a));
            s.update(DT, 10);
            // mixes from the entry at rest
            s.set(0, b, false);
            s.update(DT, 4);
            past(s, duration(b));
            s.update(DT, 8);
            // queued behind an entry that ended long ago: it is due at once
            s.add(0, c, false, 0);
            s.update(DT, 3);
            past(s, duration(c));
            s.update(ODD, 8);
            s.add(0, a, true, 0.25);
            s.update(DT, 5);
            // the same animation again, while it plays and while it rests
            s.set(0, a, false);
            s.update(DT, 2);
            past(s, duration(a));
            s.update(DT, 6);
            s.set(0, a, false, { mixDuration: 0 });
            s.update(DT, 3);
            past(s, duration(a));
            s.update(DT, 6);
            // the empty animation mixes the pose at rest out, then the track is gone
            s.setEmpty(0, 0.2);
            s.update(DT, 8);
            s.update(ODD, 6);
            // rest on an upper track, with nothing below it
            s.set(1, b, false, { alpha: 0.5 });
            past(s, duration(b));
            s.update(DT, 6);
            s.addEmpty(1, 0.1, 0);
            s.update(DT, 6);
            s.set(0, c, false);
            s.update(DT, 3);
        }),
    ];
}

/** Rest after an animation ended, woken by calls that are not about tracks. On a rig without physics some change nothing. */
function skeleton(rig: PoseRigInfo): PoseScript[] {
    const last = rig.skins - 1;
    const { a, b, duration } = pick(rig, 2);

    return [
        script('rest woken by the skeleton', (s) => {
            const entry = s.set(0, a, false);

            past(s, duration(a));
            s.update(DT, 10);
            s.skin(last);
            s.update(DT, 4);
            s.skin(-1);
            s.update(DT, 3);
            // the entry at rest poses what it keys again, in the next update
            s.setupPose();
            s.update(DT, 4);
            s.setupPoseBones();
            s.update(DT, 3);
            s.setupPoseSlots();
            s.update(DT, 3);
            s.place(25, -10, 1, 1);
            s.update(DT, 3);
            s.place(25, -10, -1.5, 0.75);
            s.update(DT, 3);
            s.yDown(true);
            s.update(DT, 3);
            s.place(0, 0, 1, -1);
            s.update(DT, 3);
            s.physics('none');
            s.update(DT, 3);
            s.physics('pose');
            s.update(DT, 3);
            s.physics('reset');
            s.update(DT, 2);
            s.physics('update');
            s.update(DT, 4);
            s.physicsTranslate(30, -15);
            s.update(DT, 4);
            s.physicsRotate(0, 0, 60);
            s.update(DT, 4);
            s.forces(0, -1, 1, 0);
            s.update(DT, 4);
            clock(s, entry);
            // the track goes and the pose stays. Now nothing poses it again.
            s.clearTrack(0);
            s.update(DT, 3);
            s.setupPose();
            s.update(DT, 3);
            s.set(0, b, false);
            s.set(1, a, false, { alpha: 0.5 });
            past(s, Math.max(duration(a), duration(b)));
            s.update(DT, 4);
            s.clearTracks();
            s.update(DT, 3);
            s.skin(last);
            s.setupPoseSlots();
            s.update(DT, 3);
        }),
    ];
}

/**
 * The other ways to rest: nothing ever played, time that stands still on the engine and on an
 * entry, updates of no time, a track cleared in the middle, and a mix to the empty animation that ended.
 */
function otherWays(rig: PoseRigInfo): PoseScript[] {
    const last = rig.skins - 1;
    const { a, b, c } = pick(rig);

    return [
        script('rest without an animation', (s) => {
            s.update(DT, 6);
            s.place(10, 10, 1, 1);
            s.update(DT, 2);
            s.skin(last);
            s.update(DT, 2);
            s.setupPose();
            s.update(DT, 2);
            s.yDown(true);
            s.physicsTranslate(5, 5);
            s.update(ODD, 3);
            s.setEmpty(0, 0);
            s.update(DT, 3);
            s.add(0, a, true, 0);
            s.update(DT, 4);
        }),
        script('rest while time stands still', (s) => {
            const entry = s.set(0, a, true);

            s.update(DT, 5);
            // on the engine: no track moves, but the skeleton time goes on
            s.timeScale(0);
            s.update(DT, 10);
            s.timeScale(1);
            s.update(DT, 4);
            s.configure(entry, { timeScale: 0 });
            s.update(DT, 10);
            s.update(ODD, 3);
            // a second track plays over the one that stands still
            s.set(1, b, true, { alpha: 0.5 });
            s.update(DT, 5);
            s.clearTrack(1);
            s.configure(entry, { timeScale: 1 });
            s.update(DT, 4);
            s.update(0, 10);
            s.update(DT, 3);
            s.update(0, 3);
            s.set(0, c, true);
            s.update(0, 3);
            s.update(DT, 4);
        }),
        script('rest after a track was cleared and after a mix out ended', (s) => {
            s.set(0, a, true);
            s.update(DT, 5);
            s.clearTrack(0);
            s.update(DT, 8);
            s.set(0, b, true);
            s.update(DT, 4);
            s.setEmpty(0, 0.15);
            s.update(DT, 6);
            s.update(DT, 8);
            s.add(0, c, false, 0);
            s.update(DT, 3);
            s.setEmpty(0, 0);
            s.update(DT, 4);
            s.clearTracks();
            s.setupPose();
            s.update(DT, 4);
        }),
    ];
}

/**
 * Two tracks where one rests and one plays. The track at rest still counts in every update: the
 * upper track mixes with what the lower one wrote, or adds to it.
 */
function tracks(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c, duration } = pick(rig, 1);

    return [
        script('rest on the lower track while the upper one plays', (s) => {
            const lower = s.set(0, a, false);

            past(s, duration(a));
            s.update(DT, 6);
            const upper = s.set(1, b, true, { alpha: 0.5 });

            s.update(DT, 10);
            s.configure(upper, { alpha: 1 });
            s.update(DT, 4);
            // adds to what the track at rest wrote: it must be written anew in every update
            s.set(1, c, true, adding(rig));
            s.update(DT, 8);
            s.setEmpty(1, 0.1);
            s.update(DT, 6);
            clock(s, lower);
        }),
        script('rest on the upper track while the lower one plays', (s) => {
            const upper = s.set(1, a, false, { alpha: 0.6 });

            past(s, duration(a));
            s.update(DT, 6);
            s.set(0, b, true);
            s.update(DT, 10);
            s.defaultMix(0.2);
            s.set(0, c, true);
            s.update(DT, 6);
            // the lower track rests too, then wakes
            s.set(0, b, false);
            past(s, duration(b));
            s.update(DT, 6);
            s.setEmpty(0, 0.2);
            s.update(DT, 8);
            s.update(ODD, 6);
            clock(s, upper);
            s.clearTrack(1);
            s.update(DT, 3);
        }),
    ];
}

/** Steps of many sizes: at rest only the clock of the physics tells them apart. */
const UNEVEN = [0.001, 0.02, 1 / 60, 0.05, 0.004, ODD, 1 / 120, 0.03];

/** The first `count` uneven steps. After a wake the first of them shows what was left on the clock of the physics. */
function uneven(s: ScriptBuilder, count: number): void {
    for (const dt of UNEVEN.slice(0, count)) s.update(dt);
}

/**
 * Rest of a skeleton with physics. Physics takes many seconds to stand still, so the steps are
 * long first and short later. Then moves wake it, with long rests between them.
 */
function physics(rig: PoseRigInfo): PoseScript[] {
    if (rig.physics === 0) return [];
    const { a, b, duration } = pick(rig, 1);
    const settle = (s: ScriptBuilder, seconds: number): void => {
        s.update(1, seconds);
        s.update(0.25, 6);
        s.update(DT, 6);
    };

    return [
        script('rest of physics after an animation, woken by moves', (s) => {
            s.set(0, a, false);
            past(s, duration(a));
            settle(s, 30);
            uneven(s, 8);
            s.place(40, -20, 1, 1);
            uneven(s, 6);
            settle(s, 10);
            s.physicsTranslate(-25, 10);
            uneven(s, 5);
            settle(s, 8);
            uneven(s, 4);
            s.physicsRotate(0, 0, 45);
            uneven(s, 5);
            settle(s, 8);
            s.yDown(true);
            uneven(s, 4);
            settle(s, 6);
            s.forces(0, -1, 1, 0);
            uneven(s, 4);
            settle(s, 6);
            s.physics('pose');
            s.update(DT, 3);
            s.physics('update');
            s.update(DT, 3);
            s.physics('reset');
            s.update(DT, 2);
            s.physics('update');
            s.update(DT, 3);
            s.set(0, b, false);
            s.update(DT, 4);
        }),
        script('rest of physics that never moved', (s) => {
            s.update(DT, 10);
            uneven(s, 8);
            s.place(-30, 15, 1, 1);
            uneven(s, 6);
            settle(s, 12);
            uneven(s, 8);
            s.physicsTranslate(12, 0);
            uneven(s, 4);
            s.skin(rig.skins - 1);
            s.update(DT, 4);
            s.set(0, a, true);
            s.update(DT, 4);
        }),
    ];
}

/**
 * On a rig with sliders: one track plays an animation to its end and rests, while a second track
 * plays the others in turn. A slider that reads a bone at rest still plays over what the second
 * track keys.
 */
function sliders(rig: PoseRigInfo): PoseScript[] {
    if (rig.sliders === 0) return [];
    const count = rig.animations.length;

    return [0, 1].slice(0, count).map((resting) =>
        script(`rest of what drives the sliders, with ${rig.animations[resting]?.name}`, (s) => {
            s.set(0, resting, false);
            past(s, rig.animations[resting]?.duration ?? 0);
            s.update(DT, 4);
            for (let playing = 0; playing < Math.min(count, 7); playing++) {
                if (playing === resting) continue;
                s.set(1, playing, true, playing % 2 === 0 ? {} : { alpha: 0.5 });
                s.update(DT, 7);
            }
            s.clearTrack(1);
            s.update(DT, 3);
            s.setupPoseBones();
            s.update(DT, 3);
        }),
    );
}

/** The scripts for rest and waking. */
export function restScripts(rig: PoseRigInfo): PoseScript[] {
    return [ownEntry, animations, skeleton, otherWays, tracks, physics, sliders].flatMap((scripts) => scripts(rig));
}
