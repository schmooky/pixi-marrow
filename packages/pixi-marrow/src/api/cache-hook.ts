import type { Texture } from 'pixi.js';
import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import type { PoseEngineFactory } from '../pose/engine';
import type { MarrowAsset } from './asset';
import type { MarrowAssetsOptions } from './assets';

/*
 * The way from `MarrowAsset.get` to the code that reads Pixi `Assets`. `registerMarrowAssets`
 * sets it. A game that never registers does not carry that code, because nothing else refers
 * to it.
 */

/** What an asset is made of when Pixi `Assets` holds its files. */
export interface CachedAssetParts {
    model: SkeletonModel;
    atlas: AtlasModel;
    textures: readonly Texture[];
    outlines: 'auto' | undefined;
}

/** Makes the asset of a skeleton and an atlas in Pixi `Assets`, with the private constructor of `MarrowAsset`. */
export type CacheReader = (
    options: MarrowAssetsOptions,
    make: (parts: CachedAssetParts, createEngine: PoseEngineFactory) => MarrowAsset,
) => MarrowAsset;

let reader: CacheReader | undefined;

/**
 * Sets the reader of Pixi `Assets`. Called by `registerMarrowAssets`.
 *
 * @example
 * setCacheReader(sharedFromCache);
 */
export function setCacheReader(read: CacheReader): void {
    reader = read;
}

/**
 * The reader of Pixi `Assets`, or undefined before `registerMarrowAssets` ran.
 *
 * @example
 * const read = cacheReader();
 */
export function cacheReader(): CacheReader | undefined {
    return reader;
}
