import { Container } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
const flare = new Container();

// #region options
hero.attach('glow', flare, { followAttachment: true, followColor: true });
// #endregion

// #region write
const head = hero.bone('head');

head.rotation += 15;
// #endregion
