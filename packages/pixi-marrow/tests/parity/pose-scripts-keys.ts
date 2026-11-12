import type { AnimationInfo } from './pose-info';
import { DT, type PoseScript, script } from './pose-script';
import type { PoseRigInfo } from './pose-shared';

/*
 * Scripts for the lookup of keys. An engine may start the search for the key of a time at the key
 * it found last, as long as it finds the same key as a search from the start. These scripts move
 * the time of an animation in every way that makes the last key a bad guess: by hand, in both
 * directions and across many keys, onto key times and next to them, in reverse, backwards with a
 * negative time scale, across the loop point and over hundreds of loops in one step, and at two
 * times at once on two tracks. They run on the animation of a rig whose timelines are longest.
 */

/** The animation with the most keys in one timeline, and its place in the rig. */
function longest(rig: PoseRigInfo): { index: number; animation: AnimationInfo } {
    const index = rig.animations.reduce((best, each, i, all) => (each.keys > (all[best]?.keys ?? 0) ? i : best), 0);
    const animation = rig.animations[index];

    if (animation === undefined) throw new Error('The rig has no animations to script');

    return { index, animation };
}

/** The values in an order that jumps back and forth: the last, the first, the one before the last, and so on. */
function zigzag(values: readonly number[]): number[] {
    const sorted = [...values];
    const out: number[] = [];

    while (sorted.length > 0) {
        const value = out.length % 2 === 0 ? sorted.pop() : sorted.shift();

        if (value !== undefined) out.push(value);
    }

    return out;
}

/** The smallest step from a time that is still a step. */
const near = (time: number): number => Math.max(Math.abs(time), 1) * Number.EPSILON;

/** The time set by hand, far forward and far back, onto key times and next to them. An update of no time applies it as it is. */
function byHand(rig: PoseRigInfo): PoseScript[] {
    const { index, animation } = longest(rig);

    return [
        script(`keys of ${animation.name} at times set by hand`, (s) => {
            const entry = s.set(0, index, false);

            s.update(DT, 3);
            for (const time of zigzag(animation.times)) {
                for (const at of [time, time - near(time), time + near(time)]) {
                    s.configure(entry, { trackTime: at });
                    s.update(0);
                }
                s.update(DT);
            }
            // half a step before each key, then across it
            for (const time of animation.times) {
                s.configure(entry, { trackTime: time - DT / 2 });
                s.update(DT, 2);
            }
            // back by less than a key, again and again
            for (let i = 0; i < 6; i++) {
                s.configure(entry, { trackTime: animation.duration * 0.6 - i * 0.004 });
                s.update(0);
            }
        }),
    ];
}

/** The part of the animation an entry plays, moved by hand: forward, back, between two keys, and without a length. */
function byWindow(rig: PoseRigInfo): PoseScript[] {
    const { index, animation } = longest(rig);
    const d = animation.duration;
    const [first = 0, second = d] = animation.times.slice(1);

    return [
        script(`keys of ${animation.name} in a part of the animation that moves`, (s) => {
            const entry = s.set(0, index, true, { animationStart: d * 0.2, animationEnd: d * 0.7 });

            // wraps inside the part
            s.update(Math.max(DT, (d * 0.5) / 7.3), 9);
            s.configure(entry, { animationStart: d * 0.6, animationEnd: d * 0.9 });
            s.update(DT, 5);
            s.configure(entry, { animationStart: 0, animationEnd: d * 0.25 });
            s.update(DT, 5);
            // the last time by hand: the events between it and the time now fire
            s.configure(entry, { animationLast: d * 0.8 });
            s.update(DT, 2);
            // from one key to the next, and nothing else
            s.configure(entry, { animationStart: first, animationEnd: second });
            s.update(Math.max(1 / 240, (second - first) / 3.3), 8);
            // a part without a length
            s.configure(entry, { animationStart: second, animationEnd: second });
            s.update(DT, 3);
            s.configure(entry, { animationStart: 0, animationEnd: d, loop: false, trackTime: d * 0.5 });
            s.update(DT, 4);
        }),
    ];
}

/** Time that runs down: a reversed entry, and a negative time scale on an entry and on the engine. */
function backwards(rig: PoseRigInfo): PoseScript[] {
    const { index, animation } = longest(rig);
    const step = Math.max(DT, animation.duration / 9.7);

    return [
        script(`keys of ${animation.name} in reverse and backwards`, (s) => {
            const entry = s.set(0, index, true, { reverse: true });

            // wraps in reverse
            s.update(step, 12);
            s.configure(entry, { reverse: false });
            s.update(DT, 3);
            // backwards through the animation and on, to times before its start
            s.configure(entry, { timeScale: -1 });
            s.update(step, 14);
            // two negative scales make time run forward
            s.timeScale(-0.5);
            s.update(step, 8);
            s.configure(entry, { timeScale: 1 });
            s.update(step, 6);
            s.timeScale(1);
            s.configure(entry, { loop: false });
            s.update(step, 6);
        }),
    ];
}

/** Steps over the loop point: a little less than a loop, a little more, a whole loop, and hundreds of loops at once. */
function overLoops(rig: PoseRigInfo): PoseScript[] {
    const { index, animation } = longest(rig);
    const d = animation.duration;

    return [
        script(`keys of ${animation.name} over many loops`, (s) => {
            const entry = s.set(0, index, true);

            // the time scale is on the entry, so that the physics of a rig does not have to run for minutes
            s.configure(entry, { timeScale: 17.37 });
            s.update(d);
            s.configure(entry, { timeScale: 1 });
            s.update(DT, 3);
            // the time in the animation goes back a little with every update, then forward a little
            s.update(d * 0.999, 4);
            s.update(d * 1.001, 4);
            // a whole loop: the same time again
            s.update(d, 3);
            s.configure(entry, { timeScale: 250.5 });
            s.update(d);
            s.configure(entry, { timeScale: 1 });
            // without physics a long update costs nothing: hundreds of loops in one plain step
            if (rig.physics === 0) s.update(d * 311.7);
            s.update(d / 3, 7);
            // small steps across the loop point
            s.configure(entry, { trackTime: d - 2.5 * DT });
            s.update(DT, 6);
        }),
    ];
}

/** One animation at several times at once: on three tracks, and mixing out while it plays again. */
function twoTimes(rig: PoseRigInfo): PoseScript[] {
    const { index, animation } = longest(rig);
    const d = animation.duration;

    return [
        script(`keys of ${animation.name} at several times at once`, (s) => {
            s.set(0, index, true);
            s.set(1, index, true, { trackTime: d * 0.5, alpha: 0.5 });
            s.update(DT, 8);
            s.set(2, index, false, { reverse: true, alpha: 0.5 });
            s.update(DT, 6);
            // mixes from itself at another time
            s.defaultMix(0.3);
            s.set(0, index, true, { trackTime: d * 0.8 });
            s.update(DT, 10);
            s.clearTrack(1);
            s.clearTrack(2);
            s.update(DT, 2);
        }),
    ];
}

/** The scripts for the lookup of keys. */
export function keyScripts(rig: PoseRigInfo): PoseScript[] {
    return [byHand, byWindow, backwards, overLoops, twoTimes].flatMap((scripts) => scripts(rig));
}
