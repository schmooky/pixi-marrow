import type { Texture } from 'pixi.js';
import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import type { PoseEngineFactory } from '../pose/engine';
import type { MarrowAsset } from './asset';
import type { MarrowAssetsOptions } from './assets';

/*
 * The way from `MarrowAsset.fromCache` to the code that reads Pixi `Assets`. `registerMarrowAssets`
 * sets it. A game that never registers does not carry that code, because nothing else refers
 * to it.
 */

/** What an asset is made of when Pixi `Assets` holds its files. */
export interface CachedAssetParts {
    model: SkeletonModel;
    atlas: AtlasModel;
    textures: readonly Texture[];
    /** A promise gives the outlines once they were checked and the code that cuts with them is loaded. */
    outlines: Promise<AtlasOutlines> | 'auto' | undefined;
    /** The name of the asset, see `MarrowAsset.name`. */
    name: string;
}

/**
 * Makes the asset of a skeleton and an atlas in Pixi `Assets`, with the private constructor of
 * `MarrowAsset`. `release` runs when the asset ends.
 */
export type CacheReader = (
    options: MarrowAssetsOptions,
    make: (parts: CachedAssetParts, createEngine: PoseEngineFactory, release: () => void) => MarrowAsset,
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
