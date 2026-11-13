/*
 * Browser part of scripts/render/game-check.mjs: what a game does with pixi-marrow, case by case.
 *
 * The page gets two classes and nothing else: `Application` of Pixi and `MarrowSpine`. This file
 * imports nothing, and it reaches the rest of Pixi only through the objects those two make. So
 * the bundle of the page holds what the bundle of a game holds, see scripts/render/game-bundle.mjs.
 * A part of Pixi that registers itself when its module is evaluated is then missing from the
 * renderer, or arrives after the renderer exists, in a chunk that pixi-marrow loads on demand.
 *
 * Every case runs in a page of its own: a new renderer, and no chunk that an earlier case loaded.
 * A case steps its rigs by fixed times and waits for a chunk with updates of 0 seconds, so its
 * picture does not depend on how long a chunk took.
 */

/** The width and the height of the canvas, in pixels. */
export const GAME_SIZE = 320;

/** The background of the canvas, opaque: the picture is what a player sees. */
const BACKGROUND = 0x406080;

/** The bytes of a pixel of the background, as a picture holds them. */
export const GAME_BACKGROUND = [0x40, 0x60, 0x80, 0xff];

/**
 * The cases. `mode` is the render mode the rig of the case must have drawn in. `early` loads
 * the rig before the renderer exists. `clips` asks for an active clip, `attached` for a
 * container that was placed.
 */
export const GAME_CASES = [
    { id: 'batched', title: 'a rig in the batched mode', mode: 'batched' },
    { id: 'mesh-after-init', title: 'a rig in the mesh mode, loaded after app.init', mode: 'mesh' },
    { id: 'mesh-before-init', title: 'a rig in the mesh mode, loaded before app.init', mode: 'mesh', early: true },
    { id: 'mesh-at-run-time', title: 'a rig switched to the mesh mode at run time', mode: 'mesh' },
    { id: 'auto-large', title: 'a rig above the limit of auto, with the default options', mode: 'mesh' },
    { id: 'clip-batched', title: 'a rig with a clip in the batched mode', mode: 'batched', clips: true },
    { id: 'clip-mesh', title: 'a rig with a clip in the mesh mode', mode: 'mesh', clips: true },
    {
        id: 'attach-batched',
        title: 'a rig in the batched mode with an attached container',
        mode: 'batched',
        attached: true,
    },
    { id: 'attach-mesh', title: 'a rig in the mesh mode with an attached container', mode: 'mesh', attached: true },
];

const file = (path) => `/fixtures/game/${path}`;

/** The rigs: their files, and where the picture frames them. */
const HERO = {
    files: { skeleton: file('4.2/spineboy-pro.skel'), atlas: file('4.2/spineboy.atlas') },
    place: { x: 0.45, y: 0.94, scale: 0.42 },
};
/** A rig that `auto` draws with meshes. No example rig is that large, so the check writes one, see `writeLargeRig`. */
const LARGE = {
    files: { skeleton: file('4.3/raptor-large.json'), atlas: file('4.3/raptor.atlas') },
    place: { x: 0.6, y: 0.9, scale: 0.22 },
};
/** Where the picture frames the rig while it comes out of its portal, and the steps until it is halfway out. */
const CLIP_PLACE = { x: 0.8, y: 0.9, scale: 0.3 };
const CLIP_FRAMES = 38;
const COIN = { files: { skeleton: file('4.2/coin-pro.skel'), atlas: file('4.2/coin.atlas') } };

/** The seconds of one step. */
const STEP = 1 / 30;

/** How long a case waits for a chunk, in milliseconds. */
const PATIENCE = 15_000;

/** Puts a rig on the stage, where the picture frames it. */
function show(app, spine, place) {
    spine.position.set(place.x * GAME_SIZE, place.y * GAME_SIZE);
    spine.scale.set((place.scale * GAME_SIZE) / 320);
    app.stage.addChild(spine);
}

/** Steps some rigs and renders after every step, as the ticker of a game does. */
function frames(app, spines, count) {
    for (let frame = 0; frame < count; frame++) {
        for (const spine of spines) spine.update(STEP);
        app.render();
    }
}

/** Renders frames that move nothing until something is true: a game goes on while a chunk loads. */
async function until(app, spines, done, what) {
    const started = performance.now();

    while (!done()) {
        if (performance.now() - started > PATIENCE) throw new Error(`timed out while waiting for ${what}`);
        for (const spine of spines) spine.update(0);
        app.render();
        await new Promise((next) => setTimeout(next, 4));
    }
}

/** A rig that runs, created with some options. */
async function runner({ MarrowSpine, app }, options) {
    const hero = await MarrowSpine.load({ ...HERO.files, autoUpdate: false, ...options });

    show(app, hero, HERO.place);
    hero.play('run', { loop: true });

    return hero;
}

/** A rig in the middle of the animation that clips it. */
async function clipped(kit, renderMode) {
    const hero = await kit.MarrowSpine.load({ ...HERO.files, autoUpdate: false, renderMode });

    show(kit.app, hero, CLIP_PLACE);
    hero.play('portal', { loop: false });
    frames(kit.app, [hero], CLIP_FRAMES);

    return { hero };
}

/** A rig with another display object at the place of a slot in the middle of its draw order. */
async function attached(kit, renderMode) {
    const hero = await runner(kit, { renderMode });
    const coin = await kit.MarrowSpine.load({ ...COIN.files, autoUpdate: false });

    frames(kit.app, [hero], 4);
    coin.play('animation', { loop: true });
    hero.attach('torso', coin);
    // the container shows once the code that places it is there
    await until(kit.app, [hero, coin], () => coin.parent !== null && coin.visible, 'the attached container');
    frames(kit.app, [hero, coin], 8);

    return { hero, placed: coin.parent !== null && coin.visible };
}

/** What each case does. It gets the two classes and the application, and returns the rig the report reads. */
const RUNS = {
    async batched(kit) {
        const hero = await runner(kit, { renderMode: 'batched' });

        frames(kit.app, [hero], 12);

        return { hero };
    },
    async 'mesh-after-init'(kit) {
        const hero = await runner(kit, { renderMode: 'mesh' });

        frames(kit.app, [hero], 12);

        return { hero };
    },
    async 'mesh-before-init'(kit) {
        const hero = kit.early;

        show(kit.app, hero, HERO.place);
        hero.play('run', { loop: true });
        frames(kit.app, [hero], 12);

        return { hero };
    },
    async 'mesh-at-run-time'(kit) {
        const hero = await runner(kit, { renderMode: 'batched' });

        frames(kit.app, [hero], 6);
        hero.renderMode = 'mesh';
        await until(kit.app, [hero], () => hero.stats.renderMode === 'mesh', 'the mesh mode');
        frames(kit.app, [hero], 6);

        return { hero };
    },
    async 'auto-large'(kit) {
        const hero = await kit.MarrowSpine.load({ ...LARGE.files, autoUpdate: false });

        show(kit.app, hero, LARGE.place);
        hero.play('walk', { loop: true });
        frames(kit.app, [hero], 12);

        return { hero };
    },
    'clip-batched': (kit) => clipped(kit, 'batched'),
    'clip-mesh': (kit) => clipped(kit, 'mesh'),
    'attach-batched': (kit) => attached(kit, 'batched'),
    'attach-mesh': (kit) => attached(kit, 'mesh'),
};

/** Bytes as base64, for the way out of the page. */
function base64(bytes) {
    let text = '';

    for (let at = 0; at < bytes.length; at += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    }

    return btoa(text);
}

/**
 * Renders the stage and reads the canvas, in the same task: the picture a player sees. `pixels`
 * are the RGBA bytes as base64, `png` is the same picture as a file.
 */
function picture(app) {
    const copy = document.createElement('canvas');

    copy.width = GAME_SIZE;
    copy.height = GAME_SIZE;
    const context = copy.getContext('2d', { willReadFrequently: true });

    app.render();
    context.drawImage(app.canvas, 0, 0);

    return {
        pixels: base64(context.getImageData(0, 0, GAME_SIZE, GAME_SIZE).data),
        png: copy.toDataURL('image/png').split(',')[1],
    };
}

/**
 * Runs one case and reports it. `pipes` are the render pipes the renderer had when it was
 * initialized. `meshPipe` says whether Pixi's mesh pipe was among them, and whether the renderer
 * had one at the end. `error` is what the case threw, or null.
 */
async function runCase({ Application, MarrowSpine, bundle }, id, preference) {
    const plan = GAME_CASES.find((entry) => entry.id === id);
    const report = { id, bundle, renderer: null, pipes: [], meshPipe: { atInit: null, atEnd: null } };
    let app = null;

    try {
        if (!plan) throw new Error(`there is no case ${id}`);
        const early = plan.early
            ? await MarrowSpine.load({ ...HERO.files, autoUpdate: false, renderMode: 'mesh' })
            : null;

        app = new Application();
        await app.init({
            width: GAME_SIZE,
            height: GAME_SIZE,
            preference,
            background: BACKGROUND,
            antialias: false,
            resolution: 1,
            autoStart: false,
        });
        document.body.appendChild(app.canvas);
        report.renderer = app.renderer.name;
        report.pipes = Object.keys(app.renderer.renderPipes).sort();
        report.meshPipe.atInit = app.renderer.renderPipes.mesh !== undefined;
        const { hero, placed = null } = await RUNS[id]({ MarrowSpine, app, early });

        Object.assign(report, picture(app), {
            mode: hero.stats.renderMode,
            clips: hero.stats.clips,
            drawCalls: hero.stats.drawCalls,
            placed,
            error: null,
        });
    } catch (error) {
        report.error = String(error?.stack ?? error)
            .split('\n')
            .slice(0, 2)
            .join(' | ');
    }
    report.meshPipe.atEnd = app ? app.renderer?.renderPipes?.mesh !== undefined : null;

    return report;
}

/**
 * The kit of a page, with a `MarrowSpine.load` that gives every instance the `skinning` of the
 * address: `?skinning=gpu`. Without one the kit is as it was given.
 */
function withSkinning(kit) {
    const skinning = new URLSearchParams(location.search).get('skinning');
    const { MarrowSpine } = kit;

    return skinning ? { ...kit, MarrowSpine: { load: (options) => MarrowSpine.load({ skinning, ...options }) } } : kit;
}

/**
 * The entry of both bundles calls this with the classes a game starts with. The check then asks
 * for a case with `window.gameCheck.run(id, renderer)`.
 *
 * @param kit `Application` of Pixi, `MarrowSpine` and `bundle`, the name of the bundle.
 */
export function startGame(kit) {
    window.gameCheck = { bundle: kit.bundle, run: (id, renderer) => runCase(withSkinning(kit), id, renderer) };
}
