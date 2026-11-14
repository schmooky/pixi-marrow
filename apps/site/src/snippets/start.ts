import { Application } from 'pixi.js';
// #region import
import { MarrowSpine } from 'pixi-marrow';

// #endregion

const app = new Application();

await app.init({ resizeTo: window });
document.body.append(app.canvas);

// #region load
const hero = await MarrowSpine.load({ skeleton: 'rigs/animation_bee.skel', atlas: 'rigs/symbols.atlas' });

app.stage.addChild(hero);
hero.position.set(app.screen.width / 2, app.screen.height / 2);
// #endregion

// #region play
hero.play('idle', { loop: true });
// #endregion
