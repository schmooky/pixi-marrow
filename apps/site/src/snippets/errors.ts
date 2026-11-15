// #region import
import { MarrowError, MarrowSpine } from 'pixi-marrow';

// #endregion

const hero = await MarrowSpine.load({ skeleton: 'hero.skel', atlas: 'hero.atlas' });

// #region catch
try {
    hero.play('wim');
} catch (error) {
    if (!(error instanceof MarrowError)) throw error;
    console.log(error.code); // 'unknown-name'
    console.log(error.closest); // 'win'
    console.log(error.validNames); // every animation of the skeleton
    console.log(error.fix); // what to change
}
// #endregion
