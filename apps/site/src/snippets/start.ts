import { Application } from 'pixi.js';
// #region import
import { MarrowSpine } from 'pixi-marrow';

// #endregion

const app = new Application();

await app.init({ resizeTo: window });
document.body.append(app.canvas);

// #region load
const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

app.stage.addChild(hero);

// #endregion

// #region assets
import { Assets } from 'pixi.js';
import { registerMarrowAssets } from 'pixi-marrow';

registerMarrowAssets();
await Assets.load(['hero.skel', 'hero.atlas']);

const fromAssets = MarrowSpine.from({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

app.stage.addChild(fromAssets);
// #endregion

// #region play
hero.play('idle', { loop: true });
hero.play('aim', { track: 1 });
hero.stop({ track: 1, mix: 0.2 });
// #endregion

// #region queue
hero.play('jump');
hero.queue('run', { loop: true });
// #endregion

// #region mix
hero.defaultMix = 0.2;
hero.setMix('run', 'jump', 0.1);
hero.play('walk', { mix: 0.4 });

// #endregion

// #region events
import type { MarrowEvent, Track } from 'pixi-marrow';

hero.on('complete', (track: Track) => console.log(track.animation));
hero.on('event', (event: MarrowEvent) => console.log(event.name));

const shot = hero.play('shoot', { track: 1 });

await shot.finished;
// #endregion

// #region skins
console.log(hero.info.skins);
hero.skin = 'knight';
// #endregion
