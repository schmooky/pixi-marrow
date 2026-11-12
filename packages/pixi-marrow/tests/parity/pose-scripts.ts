import { DT, ODD, type PoseScript, pick, script } from './pose-script';
import { dialectScripts, fieldScripts } from './pose-scripts-fields';
import { physicsScripts } from './pose-scripts-physics';
import { randomScript } from './pose-scripts-random';
import type { PoseRigInfo } from './pose-shared';

/*
 * The scripts of the pose parity suite, by family. Every script starts on a fresh engine in the
 * setup pose. Step counts are small on purpose: the suite runs every script on every fixture.
 */

/**
 * Every animation looped from the setup pose: with two small step sizes across its loop point,
 * and in big steps that pass the loop point every third update, one of them by more than a loop.
 */
function loops(rig: PoseRigInfo): PoseScript[] {
    return rig.animations.flatMap(({ name, duration }, animation) => {
        const small = [DT, ODD].map((dt) =>
            script(`loop ${name} by ${dt.toFixed(4)}`, (s) => {
                s.set(0, animation, true);
                s.update(dt, 12);
                // a jump to 6 steps before the end, so that the small steps cross the loop point
                if (duration > 18 * dt) s.update(duration - 18 * dt);
                s.update(dt, 12);
            }),
        );
        const big = script(`loop ${name} in big steps`, (s) => {
            const dt = duration > 0 ? duration * 0.37 : DT;

            s.set(0, animation, true);
            s.update(dt, 7);
            s.update(dt * 6.1);
            s.update(dt, 2);
        });

        return [...small, big];
    });
}

/** Every animation once, run past its end. Every second one has a track end and leaves its track. */
function once(rig: PoseRigInfo): PoseScript[] {
    return rig.animations.map(({ name, duration }, animation) =>
        script(`once ${name}`, (s) => {
            const dt = duration > 0 ? duration / 7.3 : DT;

            s.set(0, animation, false, animation % 2 === 1 ? { trackEnd: duration + 2.5 * dt } : {});
            s.update(dt, 12);
        }),
    );
}

/** Mixes with durations from setMix: complete, interrupted, and with no duration set. */
function mixes(rig: PoseRigInfo): PoseScript[] {
    const shifts = [0, 1, 2].slice(0, Math.min(3, rig.animations.length));

    return shifts.map((shift) => {
        const { a, b, c, name } = pick(rig, shift);

        return script(`mix ${name(a)}, ${name(b)}, ${name(c)}`, (s) => {
            s.setMix(a, b, 0.2);
            s.setMix(b, a, 0.35);
            s.set(0, a, true);
            s.update(DT, 8);
            s.set(0, b, true);
            s.update(DT, 4);
            // the mix to b is at two thirds
            s.set(0, a, false);
            s.update(DT, 14);
            // no duration set for this pair, unless c is b
            s.set(0, c, true);
            s.update(DT, 3);
            s.set(0, b, true);
            s.update(ODD, 5);
        });
    });
}

/** Mixes with the default duration: chains of interrupted mixes, and entries replaced before they are applied. */
function defaultMix(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 1);

    return [
        script('default mix chain', (s) => {
            s.defaultMix(0.25);
            s.set(0, a, true);
            s.update(DT, 6);
            s.set(0, b, true);
            s.update(DT, 3);
            s.set(0, c, true);
            s.update(DT, 3);
            s.set(0, a, true);
            s.update(DT, 2);
            // four entries mix out below this one
            s.set(0, b, true);
            s.update(DT, 14);
            s.defaultMix(0);
            s.set(0, c, false);
            s.update(DT, 3);
        }),
        script('set before apply', (s) => {
            s.defaultMix(0.2);
            s.set(0, a, true);
            // a was never applied
            s.set(0, b, true);
            s.update(DT, 4);
            s.set(0, c, true);
            // the same animation, never applied
            s.set(0, c, false);
            s.update(DT, 8);
            s.set(0, a, true);
            s.add(0, b, true, 0);
            // the queued entry is disposed
            s.set(0, c, true);
            s.update(DT, 3);
        }),
    ];
}

/** Queued animations with a zero, a positive and a negative delay, on a playing and on an empty track. */
function queue(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c, duration } = pick(rig, 2);

    return [
        script('queue with delays', (s) => {
            const total = 2 * duration(a) + duration(c) + 0.6;

            s.setMix(a, b, 0.2);
            s.set(0, a, false);
            // starts so that its mix ends with a
            s.add(0, b, true, 0);
            s.add(0, c, false, 0.3);
            // starts before c ends
            s.add(0, a, true, -0.1);
            s.addEmpty(0, 0.2, 0);
            s.add(1, b, true, 0.25, { alpha: 0.5 });
            s.add(2, c, true, -0.1, { alpha: 0.5 });
            s.update(Math.max(DT, total / 34), 40);
        }),
        script('queue behind a loop', (s) => {
            s.defaultMix(0.1);
            s.set(0, a, true);
            s.update(ODD, 3);
            // waits for the next loop of a
            s.add(0, b, false, 0);
            s.add(0, c, true, -0.05);
            s.update(Math.max(DT, (duration(a) + duration(b)) / 20), 26);
        }),
    ];
}

/** Several tracks, the upper ones with alpha below 1, an empty track between them. */
function tracks(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig);

    return [
        script('tracks with alpha', (s) => {
            s.set(0, a, true);
            const upper = s.set(1, b, true, { alpha: 0.5 });

            s.set(2, c, true, { alpha: 0.25 });
            // track 3 stays empty
            s.set(4, a, false, { alpha: 0.75 });
            s.update(DT, 8);
            s.configure(upper, { alpha: 0.8 });
            s.update(DT, 4);
            s.defaultMix(0.2);
            s.set(1, c, true, { alpha: 0.6 });
            s.update(DT, 4);
            s.set(0, b, true);
            s.update(DT, 8);
            s.setEmpty(2, 0.1);
            s.update(ODD, 8);
        }),
    ];
}

/** Empty animations: mixing in from one, mixing out to one, queued ones. */
function empty(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 1);

    return [
        script('empty in and out', (s) => {
            s.setEmpty(0, 0);
            s.add(0, a, true, 0, { mixDuration: 0.3 });
            s.update(DT, 12);
            s.setEmpty(0, 0.25);
            // the track ends when the mix is over
            s.update(DT, 10);
            s.set(1, b, true);
            s.update(DT, 3);
            s.addEmpty(1, 0.2, 0.15);
            s.update(DT, 12);
            s.set(0, c, false);
            // c was never applied
            s.setEmpty(0, 0);
            s.update(DT, 3);
            s.addEmpty(2, 0.1, 0);
            s.add(2, a, false, 0);
            s.update(DT, 6);
        }),
    ];
}

/** Time scale on the engine and on entries, zero included. */
function timeScale(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 2);

    return [
        script('time scale', (s) => {
            s.defaultMix(0.2);
            s.timeScale(0.5);
            s.set(0, a, true, { timeScale: 1.7 });
            s.add(0, b, true, 0.3);
            s.update(DT, 6);
            s.timeScale(2);
            s.update(DT, 6);
            s.timeScale(0);
            s.update(DT, 2);
            s.timeScale(1);
            // an entry that stands still, and one queued behind it that is due at once
            s.set(1, c, true, { timeScale: 0, alpha: 0.5 });
            s.add(1, a, true, 0.1, { delay: 0 });
            s.update(DT, 5);
            s.set(0, c, false, { timeScale: 3 });
            s.update(ODD, 8);
        }),
    ];
}

/** Reversed entries: looped, once and past the end, mixed out, on an upper track. */
function reverse(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c, duration } = pick(rig);

    return [
        script('reverse', (s) => {
            s.set(0, a, true, { reverse: true });
            s.update(DT, 10);
            s.defaultMix(0.2);
            s.set(0, b, false, { reverse: true, eventThreshold: 1 });
            s.update(DT, 10);
            s.set(0, c, true);
            s.update(DT, 4);
            s.set(1, a, false, { reverse: true, alpha: 0.5 });
            s.update(duration(a) > 0 ? duration(a) / 5 : DT, 8);
        }),
    ];
}

/** The shortest rotation flag on mixing and on layered entries, next to entries without it. */
function shortestRotation(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 1);

    return [
        script('shortest rotation', (s) => {
            s.defaultMix(0.3);
            s.set(0, a, true, { shortestRotation: true });
            s.set(1, b, true, { alpha: 0.5, shortestRotation: true });
            // this one keeps the direction of its first frame
            s.set(2, c, true, { alpha: 0.5 });
            s.update(DT, 8);
            s.set(0, b, true, { shortestRotation: true });
            s.update(DT, 5);
            s.set(0, c, true);
            s.update(DT, 12);
        }),
    ];
}

/** clearTrack and clearTracks while animations play, mix and wait in a queue. */
function clear(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 2);

    return [
        script('clear tracks', (s) => {
            s.defaultMix(0.2);
            s.set(0, a, true);
            s.set(1, b, true, { alpha: 0.5 });
            s.update(DT, 5);
            s.clearTrack(1);
            s.update(DT, 3);
            s.set(0, c, true);
            s.update(DT, 2);
            // in the middle of a mix. Nothing plays after it and the pose stays.
            s.clearTrack(0);
            s.update(DT, 3);
            // a track that never held anything
            s.clearTrack(3);
            s.set(0, a, true);
            s.add(0, b, true, 0);
            s.add(0, c, false, 0);
            s.set(2, b, false);
            s.update(DT, 3);
            s.clearTracks();
            s.update(DT, 2);
            s.set(0, b, true);
            s.update(DT, 4);
        }),
    ];
}

/** The three setup pose calls between updates, with and without playing tracks. */
function setupPose(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig);

    return [
        script('setup pose calls', (s) => {
            s.set(0, a, true);
            s.set(1, b, true, { alpha: 0.5 });
            s.update(DT, 5);
            s.setupPose();
            s.update(DT, 2);
            s.setupPoseBones();
            s.update(DT, 2);
            s.setupPoseSlots();
            s.update(DT, 2);
            s.clearTracks();
            // the pose stays as the tracks left it
            s.update(DT, 1);
            s.setupPose();
            s.update(DT, 1);
            s.set(0, c, false);
            s.update(DT, 3);
            s.setupPoseSlots();
            s.setEmpty(0, 0.2);
            s.update(DT, 8);
        }),
    ];
}

/** Skin changes while an animation plays: to a skin, between skins, to none, with and without a setup pose call. */
function skins(rig: PoseRigInfo): PoseScript[] {
    const last = rig.skins - 1;
    const { a, b } = pick(rig, 1);
    const changes = script('skin changes', (s) => {
        s.skin(Math.min(1, last));
        s.setupPoseSlots();
        s.set(0, a, true);
        s.update(DT, 4);
        // attachments carry over from the old skin by name
        s.skin(last);
        s.update(DT, 4);
        s.skin(-1);
        s.update(DT, 3);
        s.skin(last >> 1);
        s.setupPose();
        s.set(0, b, true);
        s.update(DT, 4);
        s.skin(Math.min(0, last));
        s.update(DT, 2);
        s.skin(last);
        // the same skin again changes nothing
        s.skin(last);
        s.setupPoseBones();
        s.update(ODD, 5);
    });

    if (rig.skins < 2) return [changes];

    return [
        changes,
        script('every skin', (s) => {
            s.set(0, a, true);
            for (let skin = 0; skin < rig.skins; skin++) {
                s.skin(skin);
                if (skin % 3 === 0) s.setupPoseSlots();
                s.update(DT, 2);
            }
        }),
    ];
}

/**
 * The position and the scale of the skeleton, set while animations play: uneven, mirrored on one
 * axis and on both. The bones that do not inherit everything read the scale, and so do IK and
 * transform constraints.
 */
function placement(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 1);

    return [
        script('skeleton position and scale', (s) => {
            s.place(30, -20, 1.5, 0.75);
            s.set(0, a, true);
            s.update(DT, 6);
            // mirrored on one axis
            s.place(-10, 5, -1.25, 0.8);
            s.update(DT, 5);
            s.defaultMix(0.2);
            s.set(0, b, true);
            s.update(DT, 5);
            s.skin(rig.skins - 1);
            // mirrored on both axes
            s.place(4, 4, -0.5, -2);
            s.set(1, c, true, { alpha: 0.5 });
            s.update(ODD, 8);
            s.place(0, 0, 1, -1);
            s.setupPose();
            s.update(DT, 3);
            s.place(0, 0, 1, 1);
            s.update(DT, 2);
        }),
    ];
}

/** A family of scripts. `seed` makes the random script of a fixture its own. */
export interface ScriptFamily {
    name: string;
    scripts(rig: PoseRigInfo, seed: string): PoseScript[];
}

export const SCRIPT_FAMILIES: readonly ScriptFamily[] = [
    { name: 'loops', scripts: loops },
    { name: 'once', scripts: once },
    { name: 'mixes', scripts: mixes },
    { name: 'default mix', scripts: defaultMix },
    { name: 'queue', scripts: queue },
    { name: 'tracks', scripts: tracks },
    { name: 'empty', scripts: empty },
    { name: 'time scale', scripts: timeScale },
    { name: 'reverse', scripts: reverse },
    { name: 'shortest rotation', scripts: shortestRotation },
    { name: 'clear', scripts: clear },
    { name: 'setup pose', scripts: setupPose },
    { name: 'skins', scripts: skins },
    { name: 'skeleton', scripts: placement },
    { name: 'dialect', scripts: dialectScripts },
    { name: 'entry fields', scripts: fieldScripts },
    { name: 'physics', scripts: physicsScripts },
    { name: 'random', scripts: (rig, seed) => [1, 2, 3, 4, 5, 6].map((n) => randomScript(rig, `${seed} ${n}`)) },
];
