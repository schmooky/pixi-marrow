// #region import
import { Application, Container } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

// #endregion

const app = new Application();

await app.init({ resizeTo: window });

const asset = await MarrowAsset.load({ skeleton: 'rigs/animation_a.skel', atlas: 'rigs/symbols.atlas' });
/** Pixels that a reel moves in a millisecond while it spins. */
const SPEED = 2;
/** The height of one symbol in pixels. */
const CELL = 180;

// #region reel
// a render group moves on the GPU: Pixi sends one matrix, and no skeleton places a vertex again
const reel = new Container({ isRenderGroup: true });

for (let row = 0; row < 4; row++) {
    const symbol = new MarrowSpine(asset);

    symbol.y = row * CELL;
    reel.addChild(symbol);
}
app.stage.addChild(reel);
app.ticker.add((ticker) => {
    reel.y = (reel.y + SPEED * ticker.deltaMS) % CELL;
});
// #endregion

// #region dim
// every symbol that does not win goes into this layer
const losers = new Container({ isRenderGroup: true });
/** The brightness of the layer, from 255 for full to 102 for dim. */
let shade = 255;

app.stage.addChild(losers);
app.ticker.add(() => {
    shade = Math.max(102, shade - 8);
    // the GPU applies the tint of a render group: no skeleton writes a vertex again
    losers.tint = (shade << 16) | (shade << 8) | shade;
});
// #endregion

// #region check
const watched = new MarrowSpine(asset);

reel.addChild(watched);
app.ticker.add(() => {
    // read after the render of the frame before: the skeleton rests, so all three stay as they are
    console.log(watched.stats.frameBytes, watched.stats.transformReplaces, watched.stats.tintRewrites);
});
// #endregion

// #region layers
const symbols = new Container();
const overlay = new Container();

// skeletons in one container, texts and frames above them: nothing stands between two skeletons
app.stage.addChild(symbols, overlay);
// #endregion

// #region hidden
watched.visible = false;
// the ticker places no vertex for it now. Its tracks, its events and finished go on
watched.stop();
// a stopped skeleton runs no timeline at all
// #endregion

// #region mesh
const boss = await MarrowSpine.load({
    skeleton: 'boss.skel',
    atlas: 'boss.atlas',
    renderMode: 'mesh',
    skinning: 'gpu',
    instancing: 'auto',
});
// #endregion

console.log(boss, symbols);
