import { Application, Assets, Container, Sprite, Texture } from 'pixi.js';
// #region load
import { MarrowSpine } from 'pixi-marrow';

const hero = await MarrowSpine.load({ skeleton: 'rigs/animation_bee.skel', atlas: 'rigs/symbols.atlas' });
// #endregion

const app = new Application();

await app.init({ resizeTo: window });
app.stage.addChild(hero);

// #region assets
import { registerMarrowAssets } from 'pixi-marrow';

// once, before the first load of a Spine file through Assets
registerMarrowAssets();
await Assets.load(['rigs/animation_coin.skel', 'rigs/symbols.atlas']);

const coin = MarrowSpine.from({ skeleton: 'rigs/animation_coin.skel', atlas: 'rigs/symbols.atlas' });

// the size is that of a Pixi object, not a load option
coin.scale.set(0.5);
// #endregion

app.stage.addChild(coin);

// #region play
// state.setAnimation(0, 'idle', true)
hero.play('idle', { loop: true });
// state.setAnimation(1, 'blink', false)
hero.play('blink', { track: 1 });
// state.addAnimation(0, 'win', false, 0)
hero.queue('win');
// state.addAnimation(0, 'idle', true, 0.5)
hero.queue('idle', { loop: true, delay: 0.5 });
// state.setEmptyAnimation(1, 0.2)
hero.stop({ track: 1, mix: 0.2 });
// state.clearTracks()
hero.stop();
// #endregion

// #region entry
// entry.timeScale, entry.mixDuration, entry.animationStart and entry.animationEnd
const win = hero.play('win', { speed: 1.5, mix: 0.1, start: 0.2, end: 1.1 });

// later, as on the entry
win.speed = 2;
win.alpha = 0.5;
// any other field of the official TrackEntry, by its official name
win.configure({ trackEnd: 2 });

// state.timeScale and state.data.defaultMix
hero.timeScale = 0.5;
hero.defaultMix = 0.2;
// state.data.setMix('idle', 'win', 0.3)
hero.setMix('idle', 'win', 0.3);
// #endregion

// #region events
// state.addListener({ complete: (entry) => ..., event: (entry, event) => ... })
hero.on('complete', (track) => console.log('one loop done', track.animation, track.track));
// the event comes first here, and the track second
hero.on('event', (event, track) => console.log(event.name, event.string, track.animation));
// #endregion

// #region finished
const end = await hero.play('win').finished;

// 'complete', 'interrupted', 'stopped' or 'destroyed'
if (end === 'complete') hero.play('idle', { loop: true });
// #endregion

// #region skins
// skeleton.setSkinByName('gold'), then skeleton.setSlotsToSetupPose()
hero.skin = 'gold';
// a new Skin with skin.addSkin(...) for each part
hero.skins = ['skin-base', 'hair/pink', 'clothes/hoodie-orange'];
// skeleton.setToSetupPose()
hero.setupPose();
// #endregion

// #region slots
// skeleton.findBone('head') and skeleton.findSlot('weapon')
const head = hero.bone('head');
const weapon = hero.slot('weapon');

console.log(head.worldX, head.worldY);
// skeleton.setAttachment('weapon', 'axe')
weapon.attachment = 'axe';
// slot.color
weapon.tint = 0xff8080;
weapon.alpha = 0.5;
// #endregion

// #region attach
const badge = new Sprite(Texture.WHITE);

// spine.addSlotObject('placeholder', badge, { followAttachmentTimeline: true })
hero.attach('placeholder', badge, { followAttachment: true });
// spine.removeSlotObject(badge)
hero.detach(badge);
// #endregion

// #region update
// the same names as in the official runtime
const manual = new MarrowSpine(hero.asset, { autoUpdate: false, ticker: app.ticker });

manual.update(1 / 60);
// #endregion

// #region destroy
// frees the display object. When MarrowSpine.load made it, the asset also unloads with its last user
manual.destroy();
// the files of Assets unload as before
await Assets.unload(['rigs/animation_coin.skel', 'rigs/symbols.atlas']);
// #endregion

// #region typed
// written by: pixi-marrow typegen coin.skel --out coin.names.ts
type CoinNames = {
    animations: 'collect' | 'idle' | 'win';
    skins: 'default';
    bones: 'root' | 'coin';
    slots: 'gold_b' | 'placeholder';
    events: 'onCollect' | 'onSound';
};

const typed = await MarrowSpine.load<CoinNames>({ skeleton: 'rigs/animation_coin.skel', atlas: 'rigs/symbols.atlas' });

// a name that the skeleton lacks does not compile
typed.play('collect');
// #endregion

app.stage.addChild(new Container(), manual, typed);
