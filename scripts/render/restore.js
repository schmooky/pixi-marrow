/*
 * Browser part of scripts/render/restore-check.mjs: a game whose WebGL context is taken away and
 * given back while its `Application` stays alive.
 *
 * The page gets three classes and nothing else: `Application` and `Graphics` of Pixi and
 * `MarrowSpine`. This file imports nothing, so the bundle of the page is the bundle of a game,
 * with its tree shaken, see scripts/render/game.js. The render pipes that pixi-marrow puts into
 * a renderer after its start are then the ones that go through the loss.
 *
 * A browser can take the context of a page at any time. Safari on iOS does it to tabs in the
 * background. Pixi answers `webglcontextlost` with `preventDefault` and builds its GPU resources
 * again on `webglcontextrestored`. Every buffer, texture and program is new then. What a library
 * believes about the old ones must still hold for the new ones, or the picture is wrong.
 *
 * Every case runs twice, each time on a page of its own. One run loses the context with the
 * `WEBGL_lose_context` extension and gets it back. The other one keeps its context and is the
 * reference. Both step their rigs by the same fixed times, so the pictures after the restore
 * must equal the pictures of the reference.
 *
 * The frames of a run, in order. `SETTLE` frames before anything happens. Then the context is
 * lost, and the game goes on: `AWAY` frames before the event of the loss arrives and `AWAY`
 * frames after it. Then the restore is asked for, with `AWAY` frames before its event arrives.
 * From there on the frames of `RESTORE_FRAMES` are read from the canvas.
 *
 * A game also shows new things while its context is away. The cases with `late` rigs put them
 * on the stage in the task that loses the context, before the browser has told anybody. Such a
 * rig is drawn for the first time without a context, and so is the shader program it brings.
 * Pixi cannot compile a program then, and a program that failed once stays broken in Pixi after
 * the restore. pixi-marrow therefore draws no skeleton while the context is lost.
 */

/** The width and the height of the canvas, in pixels. */
export const RESTORE_SIZE = 384;

/** The background of the canvas, opaque: the picture is what a player sees. */
const BACKGROUND = 0x406080;

/** The bytes of a pixel of the background, as a picture holds them. */
export const RESTORE_BACKGROUND = [0x40, 0x60, 0x80, 0xff];

/** The render modes every case runs in. */
export const RESTORE_MODES = ['batched', 'mesh'];

/** The frames after the restore whose pictures are compared. Frame 0 is the first one that is drawn. */
export const RESTORE_FRAMES = [0, 1, 2, 5, 11];

/**
 * The cases. `clips` asks for an active clip and `attached` for a container that was placed.
 * `rests` asks that the rig of the report did no work in any frame after the restore: its
 * updates all returned at once. `moves` asks that it placed vertices in every one of them.
 */
export const RESTORE_CASES = [
    { id: 'rest', title: 'a skeleton at rest', rests: true },
    { id: 'play', title: 'a skeleton that plays', moves: true },
    { id: 'clip-rest', title: 'a rig at rest inside its clip', rests: true, clips: true },
    { id: 'clip-play', title: 'a rig that plays through its clip', moves: true, clips: true },
    { id: 'many', title: 'eight instances of one asset: four at rest, four that play', rests: true },
    { id: 'attach-rest', title: 'a container attached to a slot of a skeleton at rest', rests: true, attached: true },
    {
        id: 'attach-play',
        title: 'a container attached to a slot of a skeleton that plays',
        moves: true,
        attached: true,
    },
    { id: 'first', title: 'the first skeleton of the page, first drawn while the context is lost', moves: true },
    {
        id: 'late',
        title: 'a skeleton of another asset, first drawn while the context is lost, next to one at rest',
        rests: true,
    },
];

const file = (path) => `/fixtures/restore/${path}`;

/** The rigs: their files, and where the picture frames them. */
const HERO = {
    files: { skeleton: file('4.2/spineboy-pro.skel'), atlas: file('4.2/spineboy.atlas') },
    place: { x: 0.45, y: 0.94, scale: 0.42 },
};
const COIN = { files: { skeleton: file('4.2/coin-pro.skel'), atlas: file('4.2/coin.atlas') } };
/** Where the picture frames the rig while it comes out of its portal, and the steps until it is halfway out. */
const CLIP_PLACE = { x: 0.8, y: 0.9, scale: 0.3 };
const CLIP_FRAMES = 38;

/** The seconds of one step. */
const STEP = 1 / 30;

/** The frames of a run before the context is lost. */
const SETTLE = 6;

/** The frames a game draws in each of the three stretches without a context. */
const AWAY = 3;

/** The frames a run draws without a context. */
export const RESTORE_AWAY = AWAY * 3;

/** How long a run waits for a chunk or for an event of the context, in milliseconds. */
const PATIENCE = 15_000;

/** Puts a rig on the stage, where the picture frames it. */
function show(app, spine, place) {
    spine.position.set(place.x * RESTORE_SIZE, place.y * RESTORE_SIZE);
    spine.scale.set((place.scale * RESTORE_SIZE) / 320);
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

/**
 * Loads a rig for a render mode and waits until it draws in it: the code of the mesh mode loads
 * on demand. The outlines of the atlas are there too, so no run lays its vertices out at
 * another frame than the other one.
 *
 * @param staged False keeps the rig off the stage: it is placed and not drawn.
 */
async function load({ MarrowSpine, app }, files, renderMode, place, staged = true) {
    const spine = await MarrowSpine.load({ ...files, autoUpdate: false, renderMode });

    await spine.asset.optimized;
    show(app, spine, place);
    if (!staged) app.stage.removeChild(spine);
    await until(app, [spine], () => spine.stats.renderMode === renderMode, `the ${renderMode} mode`);

    return spine;
}

/** Stops the clock of a rig. Its updates go on, as the ticker of a game calls them, and change nothing. */
function freeze(spine) {
    spine.timeScale = 0;
}

/** A rig in the middle of its run. */
async function runner(kit, mode, place = HERO.place) {
    const hero = await load(kit, HERO.files, mode, place);

    hero.play('run', { loop: true });
    frames(kit.app, [hero], 7);

    return hero;
}

/** A rig in the middle of the animation that clips it. */
async function clipped(kit, mode) {
    const hero = await load(kit, HERO.files, mode, CLIP_PLACE);

    hero.play('portal', { loop: false });
    frames(kit.app, [hero], CLIP_FRAMES);

    return hero;
}

/**
 * A rig with two display objects at slots in the middle of its draw order: a `Graphics`, and a
 * skeleton of another asset that plays.
 */
async function attached(kit, mode) {
    const hero = await runner(kit, mode);
    const coin = await kit.MarrowSpine.load({ ...COIN.files, autoUpdate: false, renderMode: mode });
    const badge = new kit.Graphics().rect(-40, -90, 150, 70).fill({ color: 0xffcc00, alpha: 0.85 });

    await coin.asset.optimized;
    coin.play('animation', { loop: true });
    coin.scale.set(0.5);
    hero.attach('torso', coin);
    hero.attach('head', badge);
    // a container shows once the code that places it is there
    await until(
        kit.app,
        [hero, coin],
        () => coin.parent !== null && coin.visible && badge.parent !== null && badge.visible,
        'the attached containers',
    );
    frames(kit.app, [hero, coin], 4);

    return { hero, coin, placed: () => coin.parent !== null && coin.visible && badge.visible };
}

/**
 * What each case puts on the stage. It gets the classes, the application and the render mode.
 * `hero` is the rig the report reads, `spines` are all rigs, which the run steps in every frame.
 * `late` are rigs that are not on the stage yet: the run adds them in the task that loses the
 * context.
 */
const STAGES = {
    async rest(kit, mode) {
        const hero = await runner(kit, mode);

        freeze(hero);

        return { hero, spines: [hero] };
    },
    async play(kit, mode) {
        const hero = await runner(kit, mode);

        return { hero, spines: [hero] };
    },
    async 'clip-rest'(kit, mode) {
        const hero = await clipped(kit, mode);

        freeze(hero);

        return { hero, spines: [hero] };
    },
    async 'clip-play'(kit, mode) {
        const hero = await clipped(kit, mode);

        // the portal goes on at a quarter of its speed, so the clip cuts the rig in every frame that is compared
        hero.timeScale = 0.25;

        return { hero, spines: [hero] };
    },
    async many(kit, mode) {
        const spines = [];
        const animations = ['run', 'walk', 'hoverboard', 'idle'];

        for (let index = 0; index < 8; index++) {
            const place = { x: 0.14 + (index % 4) * 0.24, y: index < 4 ? 0.46 : 0.96, scale: 0.2 };
            const spine = await load(kit, HERO.files, mode, place);

            spine.play(animations[index % 4], { loop: true });
            spines.push(spine);
        }
        // every rig gets another pose: the first one moves one frame, the last one eight
        for (let index = 0; index < spines.length; index++) frames(kit.app, spines.slice(index), 1);
        // the rigs of the upper row rest, among neighbours in the same batch that play
        for (const spine of spines.slice(0, 4)) freeze(spine);

        return { hero: spines[0], spines };
    },
    async 'attach-rest'(kit, mode) {
        const { hero, coin, placed } = await attached(kit, mode);

        freeze(hero);
        freeze(coin);

        return { hero, spines: [hero, coin], placed };
    },
    async 'attach-play'(kit, mode) {
        const { hero, coin, placed } = await attached(kit, mode);

        return { hero, spines: [hero, coin], placed };
    },
    async first(kit, mode) {
        // nothing of pixi-marrow is drawn before the loss: no pipe, no batcher, no program
        const hero = await load(kit, HERO.files, mode, HERO.place, false);

        hero.play('run', { loop: true });

        return { hero, spines: [hero], late: [hero] };
    },
    async late(kit, mode) {
        const hero = await runner(kit, mode, { x: 0.32, y: 0.94, scale: 0.36 });
        // the coin has dark colors and the runner has none, so the coin draws with a program of its own
        const coin = await load(kit, COIN.files, mode, { x: 0.76, y: 0.5, scale: 0.4 }, false);

        freeze(hero);
        coin.play('animation', { loop: true });

        return { hero, spines: [hero, coin], late: [coin] };
    },
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
 * Reads the canvas in the task that rendered it: the picture a player sees. `pixels` are the
 * RGBA bytes as base64, `png` is the same picture as a file.
 */
function picture(app, copy) {
    const context = copy.getContext('2d', { willReadFrequently: true });

    context.clearRect(0, 0, RESTORE_SIZE, RESTORE_SIZE);
    context.drawImage(app.canvas, 0, 0);

    return {
        pixels: base64(context.getImageData(0, 0, RESTORE_SIZE, RESTORE_SIZE).data),
        png: copy.toDataURL('image/png').split(',')[1],
    };
}

/**
 * Resolves in the task after the canvas fired an event of its context, and rejects when the
 * event does not come. The browser notes that a loss was answered with `preventDefault` once
 * every listener has returned. A promise that resolves inside a listener goes on before that,
 * and a restore that is asked for there is refused.
 */
function eventOf(canvas, name) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the canvas fired no ${name}`)), PATIENCE);

        canvas.addEventListener(
            name,
            () => {
                clearTimeout(timer);
                setTimeout(resolve, 0);
            },
            { once: true },
        );
    });
}

/**
 * Takes the context of the application away and gives it back, with frames of the game in
 * between. A run that keeps its context draws the same frames and loses nothing.
 *
 * @param late Rigs that go on the stage in the task that loses the context, in both runs.
 * @returns What happened to the context: the events the canvas fired, and whether the context
 * was lost in between and is back at the end.
 */
async function loseAndRestore(app, spines, late, lose) {
    const { canvas } = app;
    const gl = app.renderer.gl;
    const context = { lost: 0, restored: 0, wasLost: false, back: null };

    if (!lose) {
        for (const spine of late) app.stage.addChild(spine);
        frames(app, spines, AWAY * 3);

        return context;
    }
    const extension = gl.getExtension('WEBGL_lose_context');

    if (!extension) throw new Error('the browser has no WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', () => context.lost++);
    canvas.addEventListener('webglcontextrestored', () => context.restored++);
    const lost = eventOf(canvas, 'webglcontextlost');

    extension.loseContext();
    context.wasLost = gl.isContextLost();
    // the context is gone from this moment on. The event arrives in a later task
    for (const spine of late) app.stage.addChild(spine);
    frames(app, spines, AWAY);
    await lost;
    frames(app, spines, AWAY);
    // the tooling proof: this context never comes back
    if (lose === 'forever') {
        frames(app, spines, AWAY);

        return context;
    }
    const restored = eventOf(canvas, 'webglcontextrestored');

    extension.restoreContext();
    frames(app, spines, AWAY);
    await restored;
    context.back = !gl.isContextLost();

    return context;
}

/**
 * Runs one case in one render mode and reports it. `frames` holds the pictures of the frames
 * after the restore. `skipped` and `placed` say per frame after the restore whether the update
 * of the rig returned at once and how often its positions were handed on. `meshPipeAtInit` says
 * whether the renderer had Pixi's mesh pipe from its start. `error` is what the run threw, or null.
 *
 * @param lose True to lose the context and get it back. False for the reference. `forever` to
 * lose it and never get it back, which is the tooling proof.
 */
async function runCase({ Application, Graphics, MarrowSpine, pixi }, id, mode, lose) {
    const report = { id, mode, lose, pixi, renderer: null, meshPipeAtInit: null, frames: [], error: null };
    const copy = document.createElement('canvas');

    copy.width = RESTORE_SIZE;
    copy.height = RESTORE_SIZE;
    try {
        const stage = STAGES[id];

        if (!stage) throw new Error(`there is no case ${id}`);
        const app = new Application();

        await app.init({
            width: RESTORE_SIZE,
            height: RESTORE_SIZE,
            preference: 'webgl',
            background: BACKGROUND,
            antialias: false,
            resolution: 1,
            autoStart: false,
        });
        document.body.appendChild(app.canvas);
        report.renderer = app.renderer.name;
        report.meshPipeAtInit = app.renderer.renderPipes.mesh !== undefined;
        const { hero, spines, late = [], placed = null } = await stage({ MarrowSpine, Graphics, app }, mode);

        frames(app, spines, SETTLE);
        report.context = await loseAndRestore(app, spines, late, lose);
        const last = Math.max(...RESTORE_FRAMES);
        const work = { skipped: [], placed: [] };

        for (let frame = 0; frame <= last; frame++) {
            const before = { ...hero.stats };

            frames(app, spines, 1);
            work.skipped.push(hero.stats.skips - before.skips);
            work.placed.push(hero.stats.positionUploads - before.positionUploads);
            if (RESTORE_FRAMES.includes(frame)) report.frames.push({ frame, ...picture(app, copy) });
        }
        Object.assign(report, work, {
            drew: hero.stats.renderMode,
            clips: hero.stats.clips,
            maskDraws: hero.stats.maskDraws,
            drawCalls: hero.stats.drawCalls,
            placedContainers: placed ? placed() : null,
        });
    } catch (error) {
        report.error = String(error?.stack ?? error)
            .split('\n')
            .slice(0, 2)
            .join(' | ');
    }

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
 * The entry of the bundle calls this with the classes a game starts with. The check then asks
 * for a run with `window.restoreCheck.run(id, mode, lose)`.
 *
 * @param kit `Application` and `Graphics` of Pixi, `MarrowSpine`, and `pixi`, the version of Pixi.
 */
export function startRestore(kit) {
    window.restoreCheck = { run: (id, mode, lose) => runCase(withSkinning(kit), id, mode, lose) };
}
