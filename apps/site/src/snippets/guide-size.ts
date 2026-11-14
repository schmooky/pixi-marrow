import type { Rectangle } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

const asset = await MarrowAsset.load({ skeleton: 'rigs/animation_a.skel', atlas: 'rigs/heros.atlas' });

// #region measure
/** The box of the setup pose of a skeleton, in skeleton units. Measure it once per asset. */
function setupBox(skeletonAsset: MarrowAsset): Rectangle {
    const probe = new MarrowSpine(skeletonAsset, { autoUpdate: false });

    // the first update poses the skeleton in its setup pose
    probe.update(0);
    const box = probe.getLocalBounds().rectangle.clone();

    probe.destroy();

    return box;
}
// #endregion

// #region fit
/** Puts a skeleton in the middle of a square and scales it to fill most of it. */
function fitBox(hero: MarrowSpine, box: Rectangle, x: number, y: number, size: number): void {
    const scale = (size / Math.max(box.width, box.height)) * 0.9;

    hero.scale.set(scale);
    hero.position.set(x + size / 2 - (box.x + box.width / 2) * scale, y + size / 2 - (box.y + box.height / 2) * scale);
}

const hero = new MarrowSpine(asset);

fitBox(hero, setupBox(asset), 0, 0, 180);
// #endregion

// #region design
/** The frame every skeleton of the set was drawn on, in skeleton units, from the animator. */
const DESIGN_FRAME = 256;
const BOX = 180;

hero.scale.set(BOX / DESIGN_FRAME);
// #endregion

// #region units
// a bone is in skeleton units, in the space of the hero. toGlobal adds the scale and the place
const root = hero.bone('root');
const onStage = hero.toGlobal({ x: root.worldX, y: root.worldY });

// physics moves by skeleton units too: 20 pixels on the stage are 20 / scale units
hero.y += 20;
hero.physicsTranslate(0, 20 / hero.scale.y);
// #endregion

console.log(onStage);
