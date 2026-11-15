// #region import
import { Assets } from 'pixi.js';
import { MarrowSpine, registerMarrowAssets } from 'pixi-marrow';

// #endregion

// #region load
const hero = await MarrowSpine.load({
    skeleton: 'hero.skel',
    atlas: 'hero.atlas',
    outlines: 'hero.outlines.json',
});
// #endregion

// #region assets
registerMarrowAssets();
await Assets.load(['hero.skel', 'hero.atlas', 'hero.outlines.json']);

const fromAssets = MarrowSpine.from({
    skeleton: 'hero.skel',
    atlas: 'hero.atlas',
    outlines: 'hero.outlines.json',
});
// #endregion

// #region auto
const scanned = await MarrowSpine.load({ skeleton: 'coin.skel', atlas: 'coin.atlas', outlines: 'auto' });

// the scan runs in idle time after the load: the outlines show when it ends
await scanned.asset.optimized;
console.log(scanned.asset.outlinesState); // 'scanned'
// #endregion

// #region tight
const tight = await MarrowSpine.load({
    skeleton: 'hero.skel',
    atlas: 'hero.atlas',
    outlines: 'hero.outlines.json',
    tightMesh: 'on',
});

console.log(tight.stats.tightRanges, tight.stats.coveredSlots);
// #endregion

console.log(hero, fromAssets);
