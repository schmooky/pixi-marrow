import { Application, Container } from 'pixi.js';
// #region load
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

const NAMES = ['a', 'j', 'k', 'q', 'bee', 'coin', 'wild'] as const;

type SkeletonId = (typeof NAMES)[number];

/** Loads the asset of one skeleton of the set. */
const loadOne = (id: SkeletonId): Promise<MarrowAsset> =>
    MarrowAsset.load({ skeleton: `rigs/animation_${id}.skel`, atlas: 'rigs/symbols.atlas' });
const assets = new Map<SkeletonId, MarrowAsset>();

// every skeleton names the same atlas, so its pages load once
await Promise.all(NAMES.map(async (id) => assets.set(id, await loadOne(id))));
// #endregion

const app = new Application();

await app.init({ resizeTo: window });

// #region copies
/** Makes a copy of a skeleton that plays on its own. */
function makeCopy(id: SkeletonId): MarrowSpine {
    const asset = assets.get(id);

    if (asset === undefined) throw new Error(`no skeleton ${id}`);

    return new MarrowSpine(asset);
}

const scene = app.stage.addChild(new Container());

// two copies of A share everything but their pose
scene.addChild(makeCopy('a'), makeCopy('a'), makeCopy('coin'));

// #endregion

// #region assets
import { Assets } from 'pixi.js';
import { registerMarrowAssets } from 'pixi-marrow';

registerMarrowAssets();
await Assets.load(['rigs/animation_a.skel', 'rigs/symbols.atlas']);

const fromBundle = new MarrowSpine(MarrowAsset.get({ skeleton: 'rigs/animation_a.skel', atlas: 'rigs/symbols.atlas' }));
// #endregion

// #region pool
/** Copies of each skeleton that wait off the screen, so showing one makes none. */
const pools = new Map<SkeletonId, MarrowSpine[]>(NAMES.map((id) => [id, []]));

/** Takes a copy from its pool, or makes one. */
function take(id: SkeletonId): MarrowSpine {
    return pools.get(id)?.pop() ?? makeCopy(id);
}

/** Gives a copy back when it leaves the screen, in its setup pose for the next use. */
function give(id: SkeletonId, copy: MarrowSpine): void {
    copy.removeFromParent();
    copy.stop();
    copy.setupPose();
    pools.get(id)?.push(copy);
}
// #endregion

give('a', take('a'));
app.stage.addChild(fromBundle);
