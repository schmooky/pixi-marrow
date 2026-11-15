// #region import
import { type MarrowEvent, MarrowSpine, type Track } from 'pixi-marrow';

// #endregion

// #region type
/** What `pixi-marrow typegen coin.skel --out coin.names.ts --name CoinNames` writes, shortened. */
type CoinNames = {
    animations: 'idle' | 'win' | 'collect';
    skins: 'default';
    bones: 'root' | 'coin';
    slots: 'gold_b' | 'placeholder';
    events: 'onCollect' | 'onSound';
};
// #endregion

// #region typed
const coin = await MarrowSpine.load<CoinNames>({ skeleton: 'coin.skel', atlas: 'coin.atlas' });

coin.play('win');
// @ts-expect-error the skeleton has no animation "wim"
coin.play('wim');
coin.slot('gold_b').alpha = 0.5;
// #endregion

// #region events
coin.on('event', (event: MarrowEvent<CoinNames>, track: Track<CoinNames>) => {
    // event.name is 'onCollect' | 'onSound', and track.animation is one of the three animations
    if (event.name === 'onCollect') console.log('collected in', track.animation);
});
// @ts-expect-error "complet" is no event of a MarrowSpine
coin.on('complet', () => undefined);
// #endregion
