import { MarrowSpine } from 'pixi-marrow';
import { MarrowDebug } from 'pixi-marrow/debug';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

// #region layers
const debug = new MarrowDebug(hero, {
    layers: { meshTriangles: true, overdraw: true, events: true },
    colors: { bones: 0xffffff },
    lineWidth: 1.5,
});

debug.layers.regions = false;
// #endregion

// #region destroy
debug.destroy();
// #endregion
