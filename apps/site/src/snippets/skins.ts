import { Container } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
const spark = new Container();

// #region skins
hero.skins = ['skin-base', 'hair/pink', 'clothes/hoodie-orange'];
console.log(hero.skins);
// #endregion

// #region attachment
const weapon = hero.slot('weapon');

weapon.attachment = 'axe';
weapon.attachment = null;
// #endregion

// #region color
const glow = hero.slot('glow');

glow.tint = 0xffcc00;
glow.alpha = 0.5;
// #endregion

// #region setup
hero.stop();
hero.setupPose();
hero.setupPose('slots');
// #endregion

// #region points
const tip = hero.bone('sword').localToWorld({ x: 120, y: 0 });

spark.position.copyFrom(tip);
// #endregion
