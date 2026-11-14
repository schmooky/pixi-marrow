import type { Rectangle } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

const asset = await MarrowAsset.load({ skeleton: 'rigs/animation_a.skel', atlas: 'rigs/symbols.atlas' });

// #region measure
/** The box of the setup pose of a symbol, in skeleton units. Measure it once per symbol. */
function setupBox(symbolAsset: MarrowAsset): Rectangle {
    const probe = new MarrowSpine(symbolAsset, { autoUpdate: false });

    // the first update poses the skeleton in its setup pose
    probe.update(0);
    const box = probe.getLocalBounds().rectangle.clone();

    probe.destroy();

    return box;
}
// #endregion

// #region fit
/** Puts a symbol in the middle of its cell and scales it to fill most of it. */
function fitCell(symbol: MarrowSpine, box: Rectangle, x: number, y: number, size: number): void {
    const scale = (size / Math.max(box.width, box.height)) * 0.9;

    symbol.scale.set(scale);
    symbol.position.set(
        x + size / 2 - (box.x + box.width / 2) * scale,
        y + size / 2 - (box.y + box.height / 2) * scale,
    );
}

const symbol = new MarrowSpine(asset);

fitCell(symbol, setupBox(asset), 0, 0, 180);
// #endregion

// #region design
/** The frame every symbol of the set was drawn on, in skeleton units, from the animator. */
const DESIGN_FRAME = 256;
const CELL = 180;

symbol.scale.set(CELL / DESIGN_FRAME);
// #endregion

// #region units
// a bone is in skeleton units, in the space of the symbol. toGlobal adds the scale and the place
const root = symbol.bone('root');
const onStage = symbol.toGlobal({ x: root.worldX, y: root.worldY });

// physics moves by skeleton units too: 20 pixels of the reel are 20 / scale units
symbol.y += 20;
symbol.physicsTranslate(0, 20 / symbol.scale.y);
// #endregion

console.log(onStage);
