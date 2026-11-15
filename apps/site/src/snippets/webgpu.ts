// #region init
import { Application, RendererType } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';

const app = new Application();

// Pixi takes WebGPU where the browser has it, and WebGL where not
await app.init({ preference: 'webgpu', resizeTo: window });

const hero = await MarrowSpine.load({ skeleton: 'rigs/animation_bee.skel', atlas: 'rigs/symbols.atlas' });

app.stage.addChild(hero);
hero.play('idle', { loop: true });
// #endregion

// #region check
// the renderer that Pixi made: the same skeleton code runs on both
const onWebGpu = app.renderer.type === RendererType.WEBGPU;

console.log(onWebGpu ? 'WebGPU' : 'WebGL', hero.stats.renderMode, hero.stats.drawCalls);
// #endregion

// #region bytes
app.ticker.add(() => {
    // the bytes that this skeleton sent to the GPU since its last update began
    console.log(hero.stats.frameBytes, hero.stats.uploadBytes.positions);
});
// #endregion
