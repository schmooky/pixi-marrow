// #region import
import { Application } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

// #endregion

const app = new Application();

await app.init({ resizeTo: window });

// #region destroy
const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

app.stage.addChild(hero);
// the hero was the one holder of its asset: this call also unloads the model and the page images
hero.destroy();
// #endregion

// #region owners
const asset = await MarrowAsset.load({ skeleton: 'coin.skel', atlas: 'coin.atlas' });
const first = new MarrowSpine(asset);
const second = new MarrowSpine(asset);

// one call for each MarrowAsset.load: the two coins still draw
asset.destroy();
first.destroy();
// the last instance is gone: now the asset unloads its page images
second.destroy();
console.log(asset.destroyed); // true
// #endregion

// #region finished
const boss = await MarrowSpine.load({ skeleton: 'boss.skel', atlas: 'boss.atlas' });
const roar = boss.play('roar');

boss.destroy();
console.log(await roar.finished); // 'destroyed'
// #endregion

// #region ticker
const fan = await MarrowSpine.load({ skeleton: 'fan.skel', atlas: 'fan.atlas', ticker: app.ticker });

// the speed, the maxFPS and stop() of the ticker of the app now reach the fan
app.ticker.speed = 0.5;
console.log(fan.ticker === app.ticker); // true
// #endregion

// #region manual
const ghost = await MarrowSpine.load({ skeleton: 'ghost.skel', atlas: 'ghost.atlas', autoUpdate: false });

app.stage.addChild(ghost);
app.ticker.add((ticker) => ghost.update(ticker.deltaMS / 1000));
// #endregion
