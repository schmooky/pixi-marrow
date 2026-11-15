// #region import
import { type MarrowEvent, MarrowSpine, type Track } from 'pixi-marrow';

// #endregion

const coin = await MarrowSpine.load({ skeleton: 'rigs/animation_coin.skel', atlas: 'rigs/symbols.atlas' });

// #region keys
coin.on('event', (event: MarrowEvent, track: Track) => {
    if (event.name === 'onSound') console.log('play a sound', event.string, event.volume);
    if (event.name === 'onCollect') console.log('count the coin', track.animation);
});
coin.play('collect');
// #endregion

// #region life
coin.on('start', (track: Track) => console.log('start', track.animation));
coin.on('complete', (track: Track) => console.log('one loop done', track.animation));
coin.on('interrupt', (track: Track) => console.log('replaced', track.animation));
coin.on('end', (track: Track) => console.log('left its track', track.animation));
// #endregion

// #region cut
const win = coin.play('win');
const reason = await win.finished;

// 'complete': the win played to its end. Anything else took the coin away first
if (reason === 'complete') coin.play('idle', { loop: true });
// #endregion
