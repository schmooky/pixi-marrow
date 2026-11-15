// #region import
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

// #endregion
// #region bake-import
import { addBakedClips, decodeBakedClips, setBakeBudget } from 'pixi-marrow/bake';

// #endregion

// #region preset
const coin = await MarrowSpine.load({ skeleton: 'coin.skel', atlas: 'coin.atlas', perf: 'balanced' });

console.log(coin.perfSettings.offscreen); // 'throttle'
console.log(coin.perfSettings.bake); // 'off': no preset bakes
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

// #region stats
const { stats } = hero;

console.log(stats.renderMode, stats.drawCalls, stats.vertices);
// the bytes this skeleton handed to the GPU in the last frame: 0 when nothing moved
console.log(stats.frameBytes, stats.transformReplaces, stats.tintRewrites);
// #endregion

// #region memory
const memory = await hero.perf.memory();

console.log(memory.shared, memory.instance, memory.gpu, memory.baked, memory.bakeBudget);
// #endregion

// #region budget
// clips that the game bakes while it plays may hold 8 MB for this skeleton, not 4
setBakeBudget(asset, 8 * 1024 * 1024);
// #endregion
