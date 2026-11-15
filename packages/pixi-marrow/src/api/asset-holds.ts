/*
 * Who holds an asset. An asset is shared: loads of the same files return one object, and many
 * display objects draw with its textures. So it ends only when nobody holds it any more.
 *
 * There are two kinds of holders. An owner is a call that returned the asset to the game:
 * `MarrowAsset.load` or `MarrowAsset.from`, or Pixi `Assets` for an asset of `MarrowAsset.get`.
 * `asset.destroy()` lets one owner go. A user is a display object that is alive. The asset
 * frees its textures when both counts are 0.
 */

/** The holders of one asset, and what frees it. */
export interface AssetHolds {
    /** The loads that returned the asset and did not call `destroy` yet. */
    owners: number;
    /** The display objects that are alive. */
    users: number;
    /** Ends the asset. Called once, when the last holder lets go. */
    readonly free: () => void;
}

const holds = new WeakMap<object, AssetHolds>();

/**
 * Starts to count the holders of a new asset, with one owner: the call that made it.
 *
 * @example
 * const held = trackAsset(asset, () => unloadPages());
 */
export function trackAsset(asset: object, free: () => void): AssetHolds {
    const held: AssetHolds = { owners: 1, users: 0, free };

    holds.set(asset, held);

    return held;
}

/**
 * Counts one more display object that draws with an asset. The asset stays whole while it lives.
 *
 * @example
 * holdAsset(asset);
 */
export function holdAsset(asset: object): void {
    const held = holds.get(asset);

    if (held !== undefined) held.users++;
}

/**
 * Counts one display object less. The asset ends when it was the last holder.
 *
 * @example
 * dropAsset(asset);
 */
export function dropAsset(asset: object): void {
    const held = holds.get(asset);

    if (held !== undefined && held.users > 0 && --held.users === 0 && held.owners === 0) held.free();
}

/**
 * Makes Pixi `Assets` the owner of an asset again, when a `destroy` call took its place and
 * display objects kept the asset alive.
 *
 * @example
 * if (!asset.destroyed) ownAsset(asset);
 */
export function ownAsset(asset: object): void {
    const held = holds.get(asset);

    if (held !== undefined && held.owners === 0) held.owners = 1;
}

/**
 * Makes something from an asset that a load returned, then lets the load go as an owner. What
 * was made holds the asset from then on: `MarrowSpine.load` makes a display object this way, so
 * the asset ends with its last display object. When `make` throws, the asset is let go too.
 *
 * @example
 * const hero = handOver(await MarrowAsset.load(options), (asset) => new MarrowSpine(asset));
 */
export function handOver<A extends { destroy(): void }, T>(asset: A, make: (asset: A) => T): T {
    try {
        return make(asset);
    } finally {
        asset.destroy();
    }
}
