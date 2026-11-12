import { DT, ODD, type PoseScript, pick, script } from './pose-script';
import type { PoseRigInfo } from './pose-shared';

/*
 * Scripts for physics: the four physics modes, the calls that tell the physics about a move of the
 * skeleton, the position, scale, y direction and forces of the skeleton, and steps of every size.
 * They run on every rig. On a rig without physics the calls must change nothing.
 */

/** Every mode held for some updates and changed while an animation plays. One script per animation of a rig with physics. */
function modes(rig: PoseRigInfo): PoseScript[] {
    const { a, name } = pick(rig);
    const animations = rig.physics > 0 ? rig.animations.map((_, index) => index) : [a];

    return animations.map((animation) =>
        script(`physics modes on ${name(animation)}`, (s) => {
            s.set(0, animation, true);
            s.update(DT, 6);
            // the bones go where the physics is, and the physics stands still
            s.physics('pose');
            s.update(DT, 4);
            s.physics('none');
            s.update(DT, 4);
            // every update starts the physics again
            s.physics('reset');
            s.update(DT, 3);
            s.physics('update');
            s.update(DT, 6);
            // the time without physics is made up for in one update
            s.physics('none');
            s.update(DT, 3);
            s.physics('update');
            s.update(ODD, 5);
            s.physics('pose');
            s.update(ODD, 2);
            s.physics('update');
            s.update(DT, 4);
        }),
    );
}

/** A reset for one update in the middle of play, and the modes that are not `update` from the first update on. */
function resets(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 1);

    return [
        script('physics reset for one update', (s) => {
            s.set(0, a, true);
            s.update(DT, 8);
            s.physics('reset');
            s.update(DT);
            s.physics('update');
            s.update(DT, 6);
            // a reset and the pose mode on the same physics state
            s.physics('reset');
            s.update(ODD);
            s.physics('pose');
            s.update(DT, 2);
            s.physics('update');
            s.update(ODD, 5);
        }),
        script('physics modes from the first update', (s) => {
            s.physics('pose');
            s.set(0, b, true);
            s.update(DT, 3);
            s.physics('update');
            s.update(DT, 4);
            s.setupPose();
            s.physics('none');
            s.set(0, c, true);
            s.update(DT, 3);
            // the first update with physics has a long time to make up for
            s.physics('update');
            s.update(DT, 5);
            s.physics('reset');
            s.update(DT, 2);
        }),
    ];
}

/** `physicsTranslate` and `physicsRotate` between updates, with and without a move of the skeleton. */
function moves(rig: PoseRigInfo): PoseScript[] {
    const { a, b } = pick(rig, 2);

    return [
        script('physics translate and rotate', (s) => {
            // before the first update the physics has no place yet
            s.physicsTranslate(5, 5);
            s.set(0, a, true);
            s.update(DT, 4);
            s.physicsTranslate(30, -12);
            s.update(DT, 3);
            s.physicsRotate(10, 20, 35);
            s.update(DT, 3);
            // the skeleton moves and tells the physics
            s.place(40, -25, 1, 1);
            s.physicsTranslate(40, -25);
            s.update(DT, 3);
            // it moves and does not tell
            s.place(-15, 60, 1, 1);
            s.update(DT, 4);
            s.physicsRotate(0, 0, -170);
            s.physicsTranslate(-0.5, 0.25);
            s.update(ODD, 5);
            // the calls count in the pose mode and are kept through a mode without physics
            s.physics('pose');
            s.physicsTranslate(8, 0);
            s.update(DT, 2);
            s.physics('none');
            s.physicsRotate(-20, 4, 90);
            s.update(DT, 2);
            s.physics('update');
            s.update(DT, 4);
        }),
        script('physics on a moving skeleton', (s) => {
            s.set(0, b, true);
            for (let i = 0; i < 12; i++) {
                // a circle, faster than the limit of most constraints allows
                s.place(Math.round(Math.cos(i * 0.9) * 80), Math.round(Math.sin(i * 0.9) * 50), 1, 1);
                s.update(i % 3 === 2 ? ODD : DT);
            }
            s.place(2000, -1500, 1, 1);
            s.update(DT, 3);
            s.place(0, 0, 1, 1);
            s.update(DT, 4);
        }),
    ];
}

/** The scale of the skeleton: mirrored on y, uneven, mirrored on both axes, nearly flat. */
function scales(rig: PoseRigInfo): PoseScript[] {
    const { a, c } = pick(rig, 3);

    return [
        script('physics on a skeleton mirrored on y', (s) => {
            s.place(0, 0, 1, -1);
            s.set(0, a, true);
            s.update(DT, 8);
            s.physicsTranslate(-20, 14);
            s.update(DT, 3);
            s.place(100, 200, 1, -1);
            s.physicsRotate(100, 200, -45);
            s.update(DT, 5);
            s.physics('pose');
            s.update(DT, 2);
            s.physics('update');
            s.update(ODD, 4);
        }),
        script('physics on a scaled skeleton', (s) => {
            s.place(12, -7, -1.5, 0.6);
            s.set(0, c, true);
            s.update(DT, 5);
            s.place(12, -7, 0.4, -2.5);
            s.update(DT, 5);
            s.place(-30, 9, -1, -1);
            s.update(ODD, 5);
            // the scale changes on every update
            for (const scale of [1.1, 1.3, 0.9, -0.9, 1]) {
                s.place(-30, 9, scale, 2 - scale);
                s.update(DT);
            }
            // nearly flat: the limit of a constraint shrinks with the scale
            s.place(0, 0, 0.01, 1);
            s.update(DT, 3);
            s.place(0, 0, 1, 1);
            s.update(DT, 3);
        }),
    ];
}

/**
 * The y axis of the world pointing down: the official static `Skeleton.yDown`, which the Pixi
 * runtimes turn on. It turns gravity. It does not mirror the pose: the scale stays what was placed.
 */
function yDown(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig, 1);

    return [
        script('physics with y down and scaleY -1, as Pixi plays', (s) => {
            s.yDown(true);
            s.place(0, 0, 1, -1);
            s.set(0, a, true);
            s.update(DT, 8);
            s.physicsTranslate(-20, 14);
            s.update(DT, 3);
            s.place(100, 200, 1, -1);
            s.physicsRotate(100, 200, -45);
            s.update(ODD, 5);
            s.physics('pose');
            s.update(DT, 2);
            s.physics('update');
            s.update(DT, 4);
        }),
        script('physics with y down and a positive scale', (s) => {
            s.yDown(true);
            s.set(0, b, true);
            s.update(DT, 6);
            s.place(5, -5, 1.3, 0.7);
            s.update(DT, 5);
            s.forces(0.5, -1, 0.3, -0.8);
            s.update(ODD, 5);
            s.place(5, -5, -0.8, 1.2);
            s.update(DT, 4);
        }),
        script('physics with y turned in the middle of play', (s) => {
            s.set(0, c, true);
            s.update(DT, 5);
            // the flag alone: gravity turns and the scale stays
            s.yDown(true);
            s.update(DT, 5);
            s.place(0, 0, 1, -1);
            s.update(DT, 5);
            // the scale stays mirrored
            s.yDown(false);
            s.update(DT, 5);
            s.physics('reset');
            s.yDown(true);
            s.update(DT);
            s.physics('update');
            s.update(ODD, 4);
            s.place(0, 0, 1, 1);
            s.yDown(false);
            s.update(DT, 3);
        }),
    ];
}

/** The directions of wind and gravity. Only 4.3 has them: in 4.1 and 4.2 the values must change nothing. */
function forces(rig: PoseRigInfo): PoseScript[] {
    const { a, b } = pick(rig, 4);

    return [
        script('physics forces', (s) => {
            s.forces(0.6, -0.8, 0.3, -1);
            s.set(0, a, true);
            s.update(DT, 6);
            // wind against x, and no gravity
            s.forces(-1, 0, 0, 0);
            s.update(DT, 5);
            s.forces(0, 2.5, -1.5, 0.5);
            s.place(0, 0, 1, -1);
            s.update(ODD, 6);
            s.defaultMix(0.2);
            s.set(0, b, true);
            s.forces(40, 0, 0, 40);
            s.update(DT, 4);
            s.physics('pose');
            s.forces(1, 0, 0, 1);
            s.update(DT, 2);
            s.physics('update');
            s.update(DT, 4);
        }),
    ];
}

/** Steps of every size: none, small, uneven and longer than a second. The time scale slows the tracks and not the physics. */
function steps(rig: PoseRigInfo): PoseScript[] {
    const { a, b, duration } = pick(rig, 5);

    return [
        script('physics steps', (s) => {
            s.set(0, a, true);
            s.update(DT, 3);
            s.update(0, 2);
            // many steps of the physics in one update
            s.update(1.37);
            s.update(DT, 2);
            for (const dt of [0.001, 0.2, 1 / 60, 0.09, 0.004, 1 / 120, 0.5, 1 / 240, 0.0167]) s.update(dt);
            s.update(0);
            s.update(2.6);
            s.update(DT, 3);
        }),
        script('physics and time scale', (s) => {
            s.timeScale(0.5);
            s.set(0, b, true);
            s.update(DT, 5);
            // the tracks stand still, the physics goes on
            s.timeScale(0);
            s.update(DT, 4);
            s.timeScale(3);
            s.update(DT, 4);
            s.timeScale(1);
            s.set(0, a, false, { timeScale: 0.3, reverse: true });
            s.update(DT, 3);
            // past the end of the animation in one step
            s.update(duration(a) / 0.3 + 1.1);
            s.update(DT, 3);
        }),
    ];
}

/** Skin changes while physics runs. A physics constraint or its bone can need a skin. */
function skins(rig: PoseRigInfo): PoseScript[] {
    const last = rig.skins - 1;
    const { a, b } = pick(rig, 6);

    return [
        script('physics skins', (s) => {
            s.set(0, a, true);
            s.update(DT, 4);
            s.skin(last);
            s.update(DT, 4);
            s.skin(-1);
            s.update(DT, 3);
            s.skin(Math.min(1, last));
            s.physics('pose');
            s.update(DT, 2);
            // the skin changes while the physics stands still
            s.skin(last >> 1);
            s.update(DT, 2);
            s.physics('update');
            s.update(DT, 3);
            s.skin(-1);
            s.setupPose();
            s.skin(last);
            s.set(0, b, true);
            s.update(ODD, 4);
            for (let skin = 0; skin < Math.min(rig.skins, 6); skin++) {
                s.skin(skin);
                s.update(DT, 2);
            }
        }),
    ];
}

/** The three setup pose calls in the middle of play. They set the values of a constraint back, not its physics state. */
function setupPose(rig: PoseRigInfo): PoseScript[] {
    const { a, b } = pick(rig, 7);

    return [
        script('physics setup pose calls', (s) => {
            s.set(0, a, true);
            s.update(DT, 6);
            s.setupPose();
            s.update(DT, 3);
            s.setupPoseBones();
            s.update(DT, 3);
            s.setupPoseSlots();
            s.update(DT, 2);
            s.clearTracks();
            // nothing plays: the physics comes to rest from where the tracks left it
            s.update(DT, 4);
            s.setupPoseBones();
            s.update(DT, 4);
            s.set(0, b, false);
            s.update(DT, 3);
            s.setupPose();
            s.physics('reset');
            s.update(DT);
            s.physics('update');
            s.update(DT, 4);
        }),
    ];
}

/** Mixes between two animations, an empty animation and two tracks, while physics runs. */
function mixes(rig: PoseRigInfo): PoseScript[] {
    return [0, 1].map((shift) => {
        const { a, b, c, name } = pick(rig, shift);

        return script(`physics mixes of ${name(a)}, ${name(b)}, ${name(c)}`, (s) => {
            s.defaultMix(0.2);
            s.set(0, a, true);
            s.update(DT, 5);
            s.set(0, b, true);
            s.update(DT, 4);
            // the mix to b is at two thirds
            s.set(0, c, false, { mixDuration: 0.35 });
            s.update(DT, 6);
            s.set(1, a, true, { alpha: 0.5 });
            s.update(DT, 5);
            s.setEmpty(0, 0.15);
            s.update(DT, 6);
            s.setEmpty(1, 0.1);
            s.add(0, b, false, 0, { mixDuration: 0.25 });
            s.update(ODD, 8);
            s.physics('pose');
            s.set(0, a, true);
            s.update(DT, 3);
            s.physics('update');
            s.update(DT, 4);
        });
    });
}

/** The scripts for physics. */
export function physicsScripts(rig: PoseRigInfo): PoseScript[] {
    return [modes, resets, moves, scales, yDown, forces, steps, skins, setupPose, mixes].flatMap((scripts) =>
        scripts(rig),
    );
}
