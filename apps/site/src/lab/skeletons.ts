import type { Rectangle } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';
import type { BuildContext } from './lab';

/*
 * What every test does with its skeletons: makes them with the options of the side, and
 * updates them all by the step of a frame.
 */

/** Makes a skeleton of a rig with the options of the side and puts it on the stage of the scene. */
export function makeSkeleton(context: BuildContext, rig: string): MarrowSpine {
    const asset = context.assets.get(rig);

    if (asset === undefined) throw new Error(`the test did not load the rig ${rig}`);

    return context.stage.addChild(new MarrowSpine(asset, { autoUpdate: false, ...context.side.options }));
}

/** The box of the setup pose of a rig. */
export function frameOf(context: BuildContext, rig: string): Rectangle {
    const frame = context.frames.get(rig);

    if (frame === undefined) throw new Error(`the test did not load the rig ${rig}`);

    return frame;
}

/** Updates every skeleton by some seconds. */
export function updateAll(skeletons: readonly MarrowSpine[], seconds: number): void {
    for (const skeleton of skeletons) skeleton.update(seconds);
}

/** The duration of an animation of a skeleton in seconds, 0 for a name it does not have. */
export function durationOf(skeleton: MarrowSpine, animation: string): number {
    return skeleton.info.animations.find((info) => info.name === animation)?.duration ?? 0;
}
