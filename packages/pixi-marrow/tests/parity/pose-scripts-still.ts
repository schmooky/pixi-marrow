import { DT, ODD, type PoseScript, script } from './pose-script';
import type { PoseRigInfo } from './pose-shared';

/*
 * Scripts for bones that do not move. An engine may keep the world transform of a bone whose
 * inputs stayed: its own pose, the bone above it, the place of the skeleton, the skin, and every
 * constraint that writes it. These scripts play animations that key few bones or none, and then
 * change one input at a time while the bones stand still.
 *
 * A rig made here can have animations whose name starts with `wake`. Such an animation keys no
 * bone. It keys the values of constraints, each from a mix of 0, so that a constraint starts to
 * move bones that stood still.
 */

/** The animation that keys the fewest bones, but at least one. The first animation when none keys a bone. */
function fewest(rig: PoseRigInfo): number {
    const keyed = rig.animations
        .map(({ keyed: bones }, index) => ({ bones: bones.length, index }))
        .filter(({ bones }) => bones > 0);
    const [first] = keyed.sort((a, b) => a.bones - b.bones);

    return first?.index ?? 0;
}

const nameOf = (rig: PoseRigInfo, index: number): string => rig.animations[index]?.name ?? `animation ${index}`;

/** Few bones move. Then the skeleton moves, the skin changes, the bones go back to the setup pose, and the track goes. */
function moved(rig: PoseRigInfo): PoseScript[] {
    const last = rig.skins - 1;
    const few = fewest(rig);

    return [
        script(`still bones under ${nameOf(rig, few)}, and a skeleton that moves`, (s) => {
            s.set(0, few, true);
            s.update(DT, 6);
            // every bone moves with the skeleton
            s.place(15, -8, 1, 1);
            s.update(DT, 3);
            s.place(15, -8, 1.25, 0.8);
            s.update(DT, 3);
            s.place(15, -8, -1, 0.8);
            s.update(DT, 2);
            // placed again where it is: nothing moves
            s.place(15, -8, -1, 0.8);
            s.update(DT, 2);
            s.skin(last);
            s.update(DT, 3);
            s.skin(-1);
            s.update(DT, 2);
            s.skin(last >> 1);
            s.update(DT, 3);
            s.setupPoseBones();
            s.update(DT, 2);
            // the bones the animation moved stay where they are, then go back
            s.clearTrack(0);
            s.update(DT, 3);
            s.place(0, 0, 1, 1);
            s.update(DT, 2);
            s.setupPose();
            s.update(DT, 2);
        }),
    ];
}

/** A second track that starts later and keys other bones: bones that stood still under the first track start to move. */
function joined(rig: PoseRigInfo): PoseScript[] {
    const few = fewest(rig);
    const others = rig.animations.map((_, index) => index).filter((index) => index !== few);
    const [second = few, third = second] = others;

    return [
        script(`still bones under ${nameOf(rig, few)}, joined by ${nameOf(rig, second)}`, (s) => {
            s.set(0, few, true);
            s.update(DT, 5);
            // waits, then mixes in over the bones that stood still
            s.set(1, second, true, { delay: 0.1, mixDuration: 0.2, alpha: 0.5 });
            s.update(DT, 10);
            s.setEmpty(1, 0.15);
            s.update(DT, 8);
            s.set(0, third, false);
            s.add(0, few, true, 0);
            s.update(ODD, 10);
        }),
    ];
}

/**
 * The `wake` animations of a rig made here. Played in small steps from a pose at rest, forward
 * and in reverse, then with a skeleton that moves, with another skin, and over another animation.
 */
function woken(rig: PoseRigInfo): PoseScript[] {
    const last = rig.skins - 1;
    const few = fewest(rig);

    return rig.animations.flatMap(({ name, duration }, wake) => {
        if (!name.startsWith('wake')) return [];

        return [
            script(`still bones that ${name} starts to move`, (s) => {
                s.update(DT, 3);
                s.set(0, wake, false);
                s.update(duration / 14, 18);
                s.place(-12, 20, 1.1, 0.9);
                s.update(DT, 2);
                s.set(0, wake, false, { reverse: true });
                s.update(duration / 9, 11);
                s.skin(last);
                s.set(0, wake, true);
                s.update(duration / 11, 8);
                s.skin(-1);
                s.update(DT, 2);
                // over an animation that keys bones, with half its weight
                s.set(0, few, true);
                s.set(1, wake, true, { alpha: 0.5 });
                s.update(duration / 12, 14);
                s.clearTrack(1);
                s.update(DT, 2);
                s.setupPoseBones();
                s.update(DT, 2);
            }),
        ];
    });
}

/** The scripts for bones that do not move. */
export function stillScripts(rig: PoseRigInfo): PoseScript[] {
    return [moved, joined, woken].flatMap((scripts) => scripts(rig));
}
