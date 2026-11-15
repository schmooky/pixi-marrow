// #region import
import { MarrowSpine } from 'pixi-marrow';

// #endregion

const hero = await MarrowSpine.load({ skeleton: 'rigs/animation_bee.skel', atlas: 'rigs/symbols.atlas' });

// #region names
for (const animation of hero.info.animations) console.log(animation.name, animation.duration);
// #endregion

// #region loop
hero.play('idle', { loop: true });
// #endregion

// #region speed
// half as fast, from 0.25 seconds in
hero.play('win', { speed: 0.5, start: 0.25 });
hero.timeScale = 1.5;
// #endregion

// #region stop
hero.stop({ mix: 0.2 });
// #endregion

// #region hold
// an animation of 0 seconds is a pose: it holds until the track plays something else
hero.play('disable');
// #endregion

// #region finished
const win = hero.play('win');

// wait for the win, and show the total only when it played to its end
if ((await win.finished) === 'complete') hero.play('idle', { loop: true });
// #endregion
