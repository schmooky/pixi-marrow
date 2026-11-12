import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
/** How far the game moved the skeleton in this frame, in pixels. */
const dx = 12;
const dy = 0;

// #region render-mode
const boss = await MarrowSpine.load({
    skeleton: 'boss.skel',
    atlas: 'boss.atlas',
    renderMode: 'mesh',
});

console.log(boss.stats.renderMode);
// #endregion

// #region physics
hero.physics = 'pose';
hero.resetPhysics();
hero.physicsTranslate(dx, dy);
// #endregion

// #region report
console.table(await hero.perf.report());
// #endregion
