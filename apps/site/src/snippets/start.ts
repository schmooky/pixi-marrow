// #region complete
import { Application } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';

const app = new Application();

await app.init({ resizeTo: window });
document.body.append(app.canvas);

const hero = await MarrowSpine.load({ skeleton: 'rigs/animation_bee.skel', atlas: 'rigs/symbols.atlas' });

app.stage.addChild(hero);
hero.position.set(app.screen.width / 2, app.screen.height / 2);
hero.play('idle', { loop: true });
// #endregion
