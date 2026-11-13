/*
 * Browser part of scripts/render/assets-check.mjs: one rig of an AssetPack build, loaded through
 * a Pixi manifest and drawn by one runtime.
 *
 * The page gets the job from the check. It sets up `Assets` with the manifest, a base path and a
 * texture preference, loads the bundle of the rig and creates the display object from the aliases
 * of the manifest. The two runtimes register parsers for the same file extensions, so a page
 * loads one of them. Both draw the same steps of the same animation, each frame alone into a
 * render texture on an opaque background. The check compares the pages.
 *
 * The report also says what was loaded: the atlas variant the resolver chose, and the URL and the
 * resolution of every page texture. Last, the page destroys the display object and unloads the
 * bundle, and reports what that left in the cache.
 */
import { BACKGROUNDS, createStudio, picture } from './pixels.js';

/** The width and the height of a picture, in pixels. */
export const ASSETS_SIZE = 384;

/** The steps of the animation that are drawn, as scripts/render/plan.mjs has them. */
export const ASSETS_CAPTURES = [0, 7, 15, 26];

/** The texture preferences of the cases. AssetPack writes an atlas variant for each. */
export const ASSETS_CASES = [
    { id: '1x-png', resolution: 1, format: 'png' },
    { id: '0.5x-webp', resolution: 0.5, format: 'webp' },
];

/**
 * The rigs, each a bundle of its own: their folder in the repo, the skeleton, the atlas and the
 * animation that plays. The atlas of the bee holds the regions of 16 skeletons.
 */
export const ASSETS_RIGS = [
    {
        id: 'bee',
        title: 'Bzzz bee, 4.2 binary',
        version: '4.2',
        dir: 'fixtures/bzzz',
        skeleton: 'animation_bee.skel',
        atlas: 'symbols.atlas',
        animation: 'win',
    },
    {
        id: 'spineboy',
        title: 'spineboy, 4.2 JSON',
        version: '4.2',
        dir: 'fixtures/.cache/4.2',
        skeleton: 'spineboy-pro.json',
        atlas: 'spineboy.atlas',
        animation: 'run',
    },
    {
        id: 'dragon',
        title: 'dragon, 4.3 binary, six pages',
        version: '4.3',
        dir: 'fixtures/.cache/4.3',
        skeleton: 'dragon-ess.skel',
        atlas: 'dragon.atlas',
        animation: 'flying',
    },
];

/** Bytes as base64, for the way out of the page. */
function base64(bytes) {
    let text = '';

    for (let at = 0; at < bytes.length; at += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    }

    return btoa(text);
}

const message = (error) =>
    String(error?.stack ?? error)
        .split('\n')
        .slice(0, 2)
        .join(' | ');

/**
 * The calls of one runtime that differ between the two: create, play, and where the textures of
 * the atlas pages are. `asset` is the asset of ours, which unloading the atlas must destroy.
 */
async function runtimeOf(kit, job) {
    if (job.runtime === 'ours') {
        const lib = await kit.loadOurs();

        if (typeof lib.registerMarrowAssets !== 'function')
            throw new Error('pixi-marrow exports no registerMarrowAssets');
        // nothing of pixi-marrow is registered with Pixi at import
        lib.registerMarrowAssets();

        return {
            async create(names) {
                const spine = lib.MarrowSpine.from({ ...names, autoUpdate: false });

                // the main check draws ours with its outlines, so this page does too
                await spine.asset.optimized;

                return spine;
            },
            play: (spine, name) => spine.play(name, { loop: true, track: 0 }),
            pages: (loaded) => loaded.textures.map((texture) => texture.source),
            asset: (spine) => spine.asset,
        };
    }
    const lib = await kit.loadOfficial(job.version);

    return {
        async create(names) {
            const spine = lib.Spine.from({ ...names, autoUpdate: false });

            // ours runs an update of 0 seconds when it is created, see scripts/render/sides.js
            spine.update(0);

            return spine;
        },
        play: (spine, name) => spine.state.setAnimation(0, name, true),
        pages: (loaded) => loaded.pages.map((page) => page.texture.texture.source),
        asset: () => null,
    };
}

/** What a page texture says about the image behind it. Pixi labels a texture it loaded with its URL. */
const describeSource = (source) => ({
    label: source.label,
    resolution: source.resolution,
    width: source.pixelWidth,
    height: source.pixelHeight,
});

/**
 * Runs one job and reports it. `frames` holds the pictures of the steps in `ASSETS_CAPTURES`.
 * `error` is what the run threw, or null.
 */
async function run(kit, job) {
    const { PIXI } = kit;
    const report = {
        pixi: PIXI.VERSION,
        renderer: null,
        resolved: null,
        pages: [],
        frames: [],
        unload: null,
        error: null,
    };

    try {
        const runtime = await runtimeOf(kit, job);
        const renderer = await PIXI.autoDetectRenderer({
            preference: 'webgl',
            width: 16,
            height: 16,
            antialias: false,
            backgroundAlpha: 0,
        });

        report.renderer = renderer.name;
        await PIXI.Assets.init({
            manifest: job.manifest,
            basePath: new URL(job.basePath, location.href).href,
            texturePreference: { resolution: job.preference.resolution, format: [job.preference.format] },
        });
        await PIXI.Assets.loadBundle(job.bundle);
        const names = { skeleton: job.skeleton, atlas: job.atlas };

        report.resolved = {
            skeleton: PIXI.Assets.resolver.resolve(names.skeleton).src,
            atlas: PIXI.Assets.resolver.resolve(names.atlas).src,
        };
        const spine = await runtime.create(names);
        const sources = runtime.pages(PIXI.Assets.get(names.atlas));
        const root = new PIXI.Container();
        const studio = createStudio(PIXI, renderer, ASSETS_SIZE, { count: 0 });

        report.pages = sources.map(describeSource);
        spine.position.set(job.placement.x, job.placement.y);
        spine.scale.set(job.placement.scale);
        root.addChild(spine);
        runtime.play(spine, job.animation);
        for (let step = 0; step <= Math.max(...ASSETS_CAPTURES); step++) {
            spine.update(step === 0 ? 0 : job.dt);
            if (!ASSETS_CAPTURES.includes(step)) continue;
            const { pixels } = await studio.shoot(root, BACKGROUNDS.solid);

            report.frames.push({ step, pixels: base64(pixels), png: picture(pixels, ASSETS_SIZE) });
        }
        const asset = runtime.asset(spine);
        const warn = console.warn;

        root.destroy({ children: true });
        report.unload = { error: null, warnings: [] };
        // what Pixi warns while it unloads goes to the report, which tells a known warning from another one
        console.warn = (...args) => report.unload.warnings.push(args.join(' '));
        try {
            await PIXI.Assets.unloadBundle(job.bundle);
        } catch (error) {
            report.unload.error = message(error);
        } finally {
            console.warn = warn;
        }
        Object.assign(report.unload, {
            cached: [names.skeleton, names.atlas].filter((alias) => PIXI.Assets.cache.has(alias)),
            assetDestroyed: asset === null ? null : asset.destroyed === true,
            pagesDestroyed: sources.filter((source) => source.destroyed).length,
        });
    } catch (error) {
        report.error = message(error);
    }

    return report;
}

/**
 * The entry of the bundle calls this, see `bundlePage` of scripts/render/serve.mjs. The check then
 * asks for a job with `window.assetsCheck.run(job)`.
 */
export function start(kit) {
    window.assetsCheck = { run: (job) => run(kit, job) };
}
