import { MarrowSpine } from 'pixi-marrow';

const symbol = await MarrowSpine.load({ skeleton: 'rigs/animation_a.skel', atlas: 'rigs/symbols.atlas' });

// #region names
for (const animation of symbol.info.animations) console.log(animation.name, animation.duration);
// #endregion

// #region idle
symbol.play('idle', { loop: true });
// #endregion

// #region land
// the reel stopped: land, then rest in the idle loop with no gap
symbol.play('landing', { mix: 0 });
symbol.queue('idle', { loop: true });
// #endregion

// #region mix
symbol.defaultMix = 0.1;
symbol.setMix('win', 'idle', 0.25);
// #endregion

// #region hold
// a pose of 0 seconds: the symbol stays dimmed until it plays something else
symbol.play('disable');
// #endregion

// #region finished
const win = symbol.play('win');

symbol.queue('idle', { loop: true });
await win.finished;
// #endregion
