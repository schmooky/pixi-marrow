import { MarrowAsset, MarrowSpine } from 'pixi-marrow';
import { addBakedClips, decodeBakedClips } from 'pixi-marrow/bake';

// #region preset
const coin = await MarrowSpine.load({ skeleton: 'coin.skel', atlas: 'coin.atlas', perf: 'balanced' });

console.log(coin.perfSettings.offscreen); // 'throttle'
// #endregion

// #region settings
const crowd = await MarrowSpine.load({
    skeleton: 'fan.skel',
    atlas: 'fan.atlas',
    perf: { preset: 'fast', offscreen: 'throttle' },
    updateRate: 24,
});
// #endregion

// #region report
console.table(await crowd.perf.report());
console.log(crowd.pacingStatus());
// #endregion

// #region bake
const asset = await MarrowAsset.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
const bytes = new Uint8Array(await (await fetch('hero.bake')).arrayBuffer());

addBakedClips(asset, decodeBakedClips(bytes));
const hero = new MarrowSpine(asset, { bake: 'auto' });

hero.play('run', { loop: true });
// #endregion
