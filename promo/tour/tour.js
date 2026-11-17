// pixi-marrow tour. One canvas: the skeletons are pixi-marrow, the text and the shapes are
// pixi-silk. renderAt(t) steps a simulation in 1/60 s steps, so capture.mjs can take the video
// frame by frame and every run gives the same frames.
//
// A frame is three render passes on the same canvas: the background, the skeletons, the text.
// The draw calls of the skeleton pass are counted on the WebGL context, so a counter on the
// screen is the number of that frame.
//
// Open http://127.0.0.1:<port>/promo/tour/?t=12 to see one moment. window.tour.renderAt(t).
import { Application, Container } from 'pixi.js';
import { MarrowAsset } from 'pixi-marrow';
import { SilkGraphics } from 'pixi-silk';
import { enableWebGPU } from 'pixi-silk/webgpu';
import { C, FPS, H, K, makeStyles, prog, STEP, Texts, W } from './kit.js';
import { gridScene, titleScene } from './scenes-a.js';
import { benchScene, debugScene, diagnoseScene, outroScene } from './scenes-b.js';

/** The rigs of the tour. Each is a skeleton file next to one shared atlas. */
const RIGS = ['a', 'j', 'k', 'q', 'blue_flower', 'purple_flower', 'rose_flower', 'bee', 'wild', 'coin', 'boost'];
const RIG_DIR = '/fixtures/bzzz';
const SCENES = [titleScene, gridScene, benchScene, diagnoseScene, debugScene, outroScene];
const DRAWS = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'];

let app;
let active = null;
/** The last frame that was simulated and drawn, or -1. */
let frame = -1;
let total = 0;

/** Gives every scene its first frame and returns the number of frames of the tour. */
function schedule() {
    let at = 0;

    for (const scene of SCENES) {
        scene.startFrame = at;
        scene.frameCount = Math.round(scene.dur * FPS);
        at += scene.frameCount;
    }

    return at;
}

/** Counts the draw calls of one WebGL2 context by wrapping its draw methods. */
function countDraws(gl) {
    const counter = { count: 0 };

    for (const name of DRAWS) {
        const original = gl[name].bind(gl);

        gl[name] = (...args) => {
            counter.count++;
            original(...args);
        };
    }

    return counter;
}

/** The dots of the background and what the scene draws below the skeletons. */
function drawBackground(scene, t) {
    const g = K.bg;

    g.clear();
    g.rect(0, 0, W, H).fill(C.BG);
    for (let x = 48; x < W; x += 96) for (let y = 60; y < H; y += 96) g.circle(x, y, 1.6).fill(0x1d1d22);
    scene.back?.(t);
}

/** Simulates one frame of the tour and draws it. */
function step(n) {
    const scene = SCENES.findLast((s) => n >= s.startFrame);

    if (scene !== active) {
        active?.leave();
        active = scene;
        K.live = null;
        scene.enter();
    }
    const local = n - scene.startFrame;
    const t = local * STEP;
    const { renderer } = app;

    scene.step(local, t);
    drawBackground(scene, t);
    renderer.render({ container: K.back });
    K.draws.count = 0;
    renderer.render({ container: K.stage, clear: false });
    // the draw calls of the skeleton pass of this frame, as the WebGL context saw them
    K.frameDraws = K.draws.count;
    K.hud.g.clear();
    K.hud.tx.begin();
    scene.front(t);
    // the name stays in a corner of every scene that has a headline, for a viewer who joins late
    if (scene.brand !== false) {
        const a = Math.min(prog(t, 0.3, 0.6), 1 - prog(t, scene.dur - 0.45, 0.45));

        K.hud.tx.put('brand', 'pixi-marrow', K.style.brand, W - 100, 60, { alpha: a });
    }
    // in from black and out to black
    const fade = Math.max(1 - n / 14, (n - (total - 36)) / 36);

    if (fade > 0)
        K.hud.g2
            .clear()
            .rect(0, 0, W, H)
            .fill({ color: 0x000000, alpha: Math.min(1, fade) });
    else K.hud.g2.clear();
    renderer.render({ container: K.front, clear: false });
}

/** Draws the tour at a time in seconds. The frames before it are simulated first. */
export function renderAt(time) {
    const n = Math.min(total - 1, Math.max(0, Math.round(time * FPS)));
    const scene = SCENES.findLast((s) => n >= s.startFrame);

    // a scene builds all its state in enter(): one that is over, or one that must run again, is left
    if (n < frame || scene !== active) {
        active?.leave();
        active = null;
        frame = scene.startFrame - 1;
    }
    while (frame < n) step(++frame);
}

async function loadFonts() {
    const fonts = ['900 100px Inter', '800 100px Inter', '600 100px Inter', '500 100px Inter', '400 100px Inter'];
    const monos = ['500 40px "JetBrains Mono"', '700 40px "JetBrains Mono"', '800 40px "JetBrains Mono"'];

    await Promise.all([...fonts, ...monos].map((font) => document.fonts.load(font)));
    await document.fonts.ready;
    // check() is also true for a family that no face of the page has, so look at the faces themselves
    const loaded = (family) =>
        [...document.fonts].some((face) => face.family.includes(family) && face.status === 'loaded');

    if (!loaded('Inter') || !loaded('JetBrains Mono')) throw new Error('the fonts did not load: is the network there?');
}

async function loadAssets() {
    const entries = await Promise.all(
        RIGS.map(async (name) => {
            const asset = await MarrowAsset.load({
                skeleton: `${RIG_DIR}/animation_${name}.skel`,
                atlas: `${RIG_DIR}/symbols.atlas`,
                // the runtime scans the atlas for the outlines of its regions, for the cuts of overdraw
                outlines: 'auto',
            });

            // the scan runs in the background: wait for it, so that no frame differs from a later run
            await asset.optimized;

            return [name, asset];
        }),
    );

    return Object.fromEntries(entries);
}

async function boot() {
    await loadFonts();
    // MarrowDebug calls this too: it must run before the first pixi-silk object, or the objects
    // made before it and after it do not share a shader layout
    enableWebGPU();
    makeStyles();
    app = new Application();
    await app.init({
        width: W,
        height: H,
        resolution: 1,
        antialias: false,
        preference: 'webgl',
        background: C.BG,
        autoStart: false,
        preserveDrawingBuffer: true,
    });
    app.ticker.stop();
    document.body.appendChild(app.canvas);
    K.app = app;
    K.renderer = app.renderer;
    K.draws = countDraws(app.renderer.gl);
    K.frameDraws = 0;
    [K.assets, K.bench] = await Promise.all([
        loadAssets(),
        fetch('/apps/site/public/benchmarks.json').then((response) => response.json()),
    ]);
    // pass 1: the background
    K.back = new Container();
    K.bg = new SilkGraphics();
    K.back.addChild(K.bg);
    // pass 2: the skeletons and nothing else
    K.stage = new Container({ label: 'stage' });
    // pass 3: shapes, text, and the fade of the first and last frames
    K.front = new Container();
    K.hud = { g: new SilkGraphics(), g2: new SilkGraphics() };
    const texts = new Container();

    K.front.addChild(K.hud.g, texts, K.hud.g2);
    K.hud.tx = new Texts(texts);
    total = schedule();
    const scenes = SCENES.map((s) => ({ id: s.id, from: s.startFrame / FPS, to: (s.startFrame + s.frameCount) / FPS }));

    window.tour = { renderAt, TOTAL: total / FPS, FPS, W, H, scenes, live: () => K.live };
    const query = new URLSearchParams(location.search);

    renderAt(Number(query.get('t') ?? 1));
    if (query.has('play')) {
        const start = performance.now() - Number(query.get('t') ?? 0) * 1000;
        const loop = () => {
            renderAt(((performance.now() - start) / 1000) % (total / FPS));
            requestAnimationFrame(loop);
        };

        loop();
    }
    window.tourReady = true;
}

boot().catch((error) => {
    console.error(error);
    window.tourError = String(error?.stack ?? error);
});
