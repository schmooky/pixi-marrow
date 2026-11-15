import { type MarrowEvent, MarrowSpine, type Track } from 'pixi-marrow';

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
let replaced = false;
let completed = false;
const onInterrupt = (track: Track): void => {
    if (track === win) replaced = true;
};
// an animation that mixes out can still reach its end: that one does not count
const onComplete = (track: Track): void => {
    if (track === win && !replaced) completed = true;
};

coin.on('interrupt', onInterrupt);
coin.on('complete', onComplete);
await win.finished;
coin.off('interrupt', onInterrupt);
coin.off('complete', onComplete);
// the win reached its end before anything replaced it, stopped it or destroyed the coin
if (completed) coin.play('idle', { loop: true });
// #endregion
