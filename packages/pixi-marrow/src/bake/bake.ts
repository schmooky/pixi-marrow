import type { SkeletonModel } from '../model/model';
import { loadPoseEngine } from '../pose/engine';
import type { BakedClip } from './clip';
import { animationIndex } from './eligible';
import { type BakeOptions, bakeWith } from './record';
import { bakesOf } from './store';

/**
 * Bakes one animation of a skeleton: plays it once on track 0 from the setup pose and keeps
 * the pose of every frame, at `fps` frames per second. In Node at build time, or in a game. The
 * pose engine of the skeleton's Spine version loads on demand.
 *
 * Throws a `MarrowError` for an animation or a skin the skeleton lacks, with the valid names.
 * It throws for a skeleton whose skins turn on a physics constraint or a slider too: their pose
 * depends on more than the time of the animation.
 *
 * @param animation The name of the animation, or its index in the model.
 *
 * @example
 * const model = await importSkeleton(readFileSync('hero.skel'));
 * const run = await bakeAnimation(model, 'run', { fps: 60 });
 * console.log(run.frames, bakedBytes(run));
 */
export async function bakeAnimation(
    model: SkeletonModel,
    animation: string | number,
    options: BakeOptions = {},
): Promise<BakedClip> {
    const index = animationIndex(model, animation);

    return bakeWith(await loadPoseEngine(model), model, index, options);
}

/**
 * Bakes every animation of a skeleton, as {@link bakeAnimation} bakes one.
 *
 * @example
 * const clips = await bakeAnimations(model, { skins: ['default'] });
 * writeFileSync('hero.bake', encodeBakedClips(clips));
 */
export async function bakeAnimations(model: SkeletonModel, options: BakeOptions = {}): Promise<BakedClip[]> {
    const createEngine = await loadPoseEngine(model);

    return model.animations.map((_, index) => bakeWith(createEngine, model, index, options));
}

/**
 * Hands baked clips to every display object of an asset, those that exist and those to come.
 * One whose `bake` setting is `auto`, or lists the animation of a clip, plays the clip instead
 * of baking the animation itself. A clip plays for the skins it was baked with, in that order.
 * A clip of the same animation and skins replaces the one before.
 *
 * Throws a `MarrowError` for a clip of another skeleton: other names, counts or editor hash.
 *
 * @param asset A `MarrowAsset`, or anything with the model the clips were baked from.
 *
 * @example
 * const asset = await MarrowAsset.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
 * addBakedClips(asset, decodeBakedClips(bytes));
 * const hero = new MarrowSpine(asset, { bake: 'auto' });
 */
export function addBakedClips(asset: { readonly model: SkeletonModel }, clips: readonly BakedClip[]): void {
    bakesOf(asset.model).add(clips);
}
