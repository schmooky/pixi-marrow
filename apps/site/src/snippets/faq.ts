import { Application, Container } from 'pixi.js';
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

const app = new Application();

await app.init({ resizeTo: window });
const asset = await MarrowAsset.load({ skeleton: 'rigs/animation_coin.skel', atlas: 'rigs/symbols.atlas' });

// #region group
// Pixi moves and fades a render group on the GPU, so its skeletons write no vertex again
const reel = new Container({ isRenderGroup: true });

app.stage.addChild(reel);
for (let row = 0; row < 5; row++) {
    const symbol = new MarrowSpine(asset);

    symbol.y = row * 160;
    reel.addChild(symbol);
}

app.ticker.add(() => {
    reel.y += 4;
    reel.alpha = 0.8;
});
// #endregion

// #region stats
const symbol = new MarrowSpine(asset);

reel.addChild(symbol);
app.ticker.add(() => {
    const { drawCalls, renderMode, transformReplaces, tintRewrites, instructionBuilds, frameBytes } = symbol.stats;

    console.log(renderMode, drawCalls, transformReplaces, tintRewrites, instructionBuilds, frameBytes);
});
console.table(await symbol.perf.report());
// #endregion
