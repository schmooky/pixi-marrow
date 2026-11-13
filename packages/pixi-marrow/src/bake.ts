/**
 * `pixi-marrow/bake`: animations baked at a fixed rate, at build time in Node or in a game, and
 * handed to the display objects of an asset. No Pixi.
 */
export { addBakedClips, bakeAnimation, bakeAnimations } from './bake/bake';
export type { BakedClip } from './bake/clip';
export { bakedBytes } from './bake/clip';
export { decodeBakedClips, encodeBakedClips } from './bake/codec';
export type { BakeOptions } from './bake/record';
