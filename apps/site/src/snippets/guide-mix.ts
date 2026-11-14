import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'rigs/animation_bee.skel', atlas: 'rigs/symbols.atlas' });

// #region queue
// a bounce, then rest, with no gap between them
hero.play('landing');
hero.queue('idle', { loop: true });
// #endregion

// #region delay
// the win starts half a second after the landing started
hero.play('landing');
hero.queue('win', { delay: 0.5 });
// #endregion

// #region mix
hero.defaultMix = 0.15;
hero.setMix('win', 'idle', 0.3);
hero.play('win', { mix: 0 });
// #endregion

// #region layers
// track 0 rests, track 1 plays a win over it, half strong
hero.play('idle', { loop: true });
hero.play('win', { track: 1, alpha: 0.5 });
// #endregion

// #region fade
// fade the layer out over a fifth of a second, back to what track 0 shows
hero.stop({ track: 1, mix: 0.2 });
// #endregion
