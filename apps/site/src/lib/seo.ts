/*
 * What search engines and answer engines read about each page: the title of the browser tab and
 * of a shared link, and the description under it. The page files keep their own short titles for
 * the heading. A route with no entry here gets its page title with `TITLE_SUFFIX` after it.
 *
 * A title names "Spine" and "PixiJS" and has at most 60 characters. A description has 110 to 160
 * characters, starts with the answer, and says only what the page shows.
 */

/** The address of the site, as `astro.config.mjs` has it. */
export const ORIGIN = 'https://pixi-marrow.schmooky.dev';

/** What follows the title of a page that has no entry in `SEO`. */
const TITLE_SUFFIX = '| pixi-marrow, Spine runtime for PixiJS';

/** The command that installs the package, as the start page and the README have it. */
export const INSTALL = 'npm install pixi-marrow pixi.js';

/** The handle on GitHub that owns the repository. The structured data names nobody else. */
export const OWNER = { name: 'schmooky', url: 'https://github.com/schmooky' };

/** The image of a shared link, in `public`. */
export const SHARE_IMAGE = {
    path: '/og.png',
    width: 1200,
    height: 630,
    alt: 'pixi-marrow, a Spine runtime for PixiJS v8',
};

/** The title and the description of a route, where they differ from those of the page file. */
interface SeoEntry {
    seoTitle?: string;
    seoDescription?: string;
}

/** The entries by route. Add a route here when its page title alone does not say what the page answers. */
const SEO: Readonly<Record<string, SeoEntry>> = {
    '/': {
        seoTitle: 'pixi-marrow: Spine runtime for PixiJS v8, WebGL2 and WebGPU',
        seoDescription:
            'pixi-marrow is a Spine runtime for PixiJS v8. It plays Spine 4.1, 4.2 and 4.3 skeletons on WebGL2 and WebGPU, with its own pose core and render path.',
    },
    '/basics/pixels/': {
        seoTitle: 'Pixels and frames: graphics basics for Spine in PixiJS',
        seoDescription:
            'A screen is a grid of pixels, and motion is a new picture many times a second. A Spine runtime for PixiJS v8 builds on these two facts.',
    },
    '/basics/transforms/': {
        seoTitle: 'Coordinates and transforms for Spine bones in PixiJS',
        seoDescription:
            'A transform moves, turns and scales an object, and a child follows its parent. The bones of a Spine skeleton in PixiJS v8 work the same way.',
    },
    '/basics/triangles/': {
        seoTitle: 'Triangles and textures: how PixiJS draws a Spine skeleton',
        seoDescription:
            'The GPU draws only triangles, and it colors them from textures. Every image of a Spine skeleton reaches the screen this way in PixiJS v8.',
    },
    '/basics/gpu/': {
        seoTitle: 'The GPU and draw calls in PixiJS, for Spine animation',
        seoDescription:
            'The CPU prepares a frame and the GPU draws it, through buffers and draw calls. See what a draw call costs before you tune Spine skeletons in PixiJS.',
    },
    '/basics/blending/': {
        seoTitle: 'Transparency, blending and overdraw: Spine in PixiJS',
        seoDescription:
            'Blending is how the GPU combines transparent pictures. Every pixel painted twice costs GPU time, which is the overdraw of Spine skeletons in PixiJS.',
    },
    '/start/': {
        seoTitle: 'Get started: play a Spine animation in PixiJS v8',
        seoDescription:
            'Run npm install pixi-marrow pixi.js, load a Spine skeleton with its atlas, and play an animation in PixiJS v8. The guide starts from these calls.',
    },
    '/guide/assets/': {
        seoTitle: 'Load Spine assets once in PixiJS v8 and show many instances',
        seoDescription:
            'Load a Spine skeleton and its atlas once, then show as many instances as a scene needs. Load with pixi-marrow or with PixiJS Assets.',
    },
    '/guide/size/': {
        seoTitle: 'Size and scale of a Spine skeleton in PixiJS v8',
        seoDescription:
            'A Spine skeleton has units of the Spine editor, and the screen has pixels. Fit a skeleton to a place on the screen in PixiJS v8, and see what scale changes.',
    },
    '/guide/play/': {
        seoTitle: 'Play, loop and stop Spine animations in PixiJS v8',
        seoDescription:
            'Call play to start a Spine animation in PixiJS v8. Loop it, change its speed, play part of it, stop it, hold a pose, and know when it ends.',
    },
    '/guide/mix/': {
        seoTitle: 'Mix, queue and layer Spine animations in PixiJS v8',
        seoDescription:
            'Play Spine animations one after the other, blend one into the next with a mix, and layer them on tracks. The calls of pixi-marrow for PixiJS v8.',
    },
    '/guide/events/': {
        seoTitle: 'Spine animation events and track events in PixiJS v8',
        seoDescription:
            'React to the events that an animator marked in a Spine animation, and to the life of each track, without guessing times in code. For PixiJS v8.',
    },
    '/skins-and-slots/': {
        seoTitle: 'Spine skins, slots and slot colors in PixiJS v8',
        seoDescription:
            'Wear several Spine skins at once, change what a slot shows, tint a slot, and return to the setup pose. The calls of pixi-marrow for PixiJS v8.',
    },
    '/bones-and-placeholders/': {
        seoTitle: 'Follow Spine bones and add PixiJS objects to a skeleton',
        seoDescription:
            'Read a Spine bone, let a PixiJS object follow it, or put a PixiJS object into the draw order of a skeleton. The calls of pixi-marrow, with a live preview.',
    },
    '/how/frame/': {
        seoTitle: 'One frame of a Spine runtime in PixiJS, stage by stage',
        seoDescription:
            'A Spine runtime turns the time into pixels in every frame. Follow one frame on a two-bone arm, stage by stage, and see which stage costs what in PixiJS.',
    },
    '/how/anatomy/': {
        seoTitle: 'Anatomy of a Spine skeleton in PixiJS: bones, slots, atlas',
        seoDescription:
            'A Spine skeleton is bones, slots, attachments and an atlas. See each part on a live skeleton in PixiJS v8, and why the runtime keeps them as it does.',
    },
    '/how/animation/': {
        seoTitle: 'How a Spine animation works in PixiJS: timelines and keys',
        seoDescription:
            'A Spine animation is a list of timelines, and a timeline is a list of keys. See how a runtime for PixiJS v8 turns a time into a pose.',
    },
    '/how/pose/': {
        seoTitle: 'The pose of a Spine skeleton in PixiJS: bones in the world',
        seoDescription:
            'An animation sets each Spine bone relative to its parent. The runtime then computes where every bone is in the skeleton, before PixiJS draws anything.',
    },
    '/how/vertices/': {
        seoTitle: 'Vertices: how Spine regions and meshes draw in PixiJS',
        seoDescription:
            'Spine bones say where things are, and the GPU draws triangles. See how a region and a mesh become vertices in PixiJS v8, and where each takes its pixels.',
    },
    '/how/batches/': {
        seoTitle: 'Draw calls and batches of Spine skeletons in PixiJS v8',
        seoDescription:
            'pixi-marrow draws small Spine skeletons that follow each other in one PixiJS draw call. See how 15 skeletons share one call, and what makes them take more.',
    },
    '/how/fast/': {
        seoTitle: 'Why pixi-marrow is fast: Spine performance in PixiJS v8',
        seoDescription:
            'This page collects what pixi-marrow skips in a frame of a Spine skeleton in PixiJS v8, shows it live, and lists what still makes a scene slow.',
    },
    '/performance/': {
        seoTitle: 'Spine performance settings in PixiJS v8: presets, pacing',
        seoDescription:
            'The perf presets of pixi-marrow, the settings that trade exactness for speed, and how to see which are in effect for a Spine skeleton in PixiJS v8.',
    },
    '/debug/': {
        seoTitle: 'Debug overlays for Spine skeletons in PixiJS v8',
        seoDescription:
            'MarrowDebug draws the bones, the shapes, the clipping and the overdraw of a Spine skeleton over it in PixiJS v8. It is the entry pixi-marrow/debug.',
    },
    '/good-to-know/': {
        seoTitle: 'pixi-marrow: Spine versions, PixiJS versions, limits',
        seoDescription:
            'pixi-marrow plays Spine 4.1, 4.2 and 4.3 in PixiJS 8, from 8.23, on WebGL2 and WebGPU. See what the runtime does on its own, its options and its limits.',
    },
    '/reels/': {
        seoTitle: 'Slot reels example: Spine symbols in PixiJS v8',
        seoDescription:
            'The reels of a slot game with line wins, as a live example. pixi-reels spins the reels, and pixi-marrow draws the Spine symbols in PixiJS v8.',
    },
    '/compare/spine-pixi-v8/': {
        seoTitle: 'pixi-marrow vs spine-pixi-v8 vs pixi-spine: Spine in PixiJS',
        seoDescription:
            'For PixiJS v8 there are two Spine runtimes: the official spine-pixi-v8 and pixi-marrow. A table of versions, draw calls, size, features and maturity.',
    },
    '/benchmarks/': {
        seoTitle: 'Spine PixiJS v8 benchmarks: pixi-marrow vs spine-pixi-v8',
        seoDescription:
            'On an Apple M4, 200 Spine skeletons in PixiJS 8.23 took 0.23 to 0.77 times the CPU time of spine-pixi-v8. All rows, the method and the date: 2026-11-15.',
    },
    '/migrate/': {
        seoTitle: 'Migrate from spine-pixi-v8 or pixi-spine: Spine, PixiJS v8',
        seoDescription:
            'pixi-marrow is not a drop-in replacement. Each call of spine-pixi-v8 and pixi-spine, such as state.setAnimation, with its call in pixi-marrow for PixiJS v8.',
    },
    '/faq/': {
        seoTitle: 'pixi-marrow FAQ: a Spine runtime for PixiJS v8, answered',
        seoDescription:
            'pixi-marrow plays Spine 4.1 to 4.3 in PixiJS 8.23 or later, on WebGL2 and WebGPU. Short answers on draw calls, size, speed, the licence and readiness.',
    },
    '/webgpu/': {
        seoTitle: 'Spine on PixiJS WebGPU: what works with pixi-marrow',
        seoDescription:
            'pixi-marrow draws Spine skeletons on the WebGPU renderer of PixiJS v8, from 8.23. See what differs from WebGL2: uploads, the mesh limit and a lost device.',
    },
    '/api/': {
        seoTitle: 'API reference of pixi-marrow, Spine runtime for PixiJS v8',
        seoDescription:
            'Every export of pixi-marrow, a Spine runtime for PixiJS v8, by entry point: signature, description and example, made from the declarations at each build.',
    },
    '/changelog/': {
        seoTitle: 'Changelog of pixi-marrow, a Spine runtime for PixiJS v8',
        seoDescription:
            'What each version of pixi-marrow changed, what waits for the next release, and what can still change before 1.0. A Spine runtime for PixiJS v8.',
    },
    '/performance/caveats/': {
        seoTitle: 'Spine performance in PixiJS: draw calls, uploads, overdraw',
        seoDescription:
            'What makes a PixiJS v8 scene with Spine skeletons slow: moving parents, batch breaks, clipping, filters, memory. See each cause in pixi-marrow and fix it.',
    },
    '/performance/rules/': {
        seoTitle: 'Spine performance rules for PixiJS v8, MARROW001 and up',
        seoDescription:
            'Each performance rule of pixi-marrow has an id from MARROW001, a sign in the PixiJS scene or the stats, a cost and a fix. For Spine skeletons in PixiJS v8.',
    },
    '/warnings/': {
        seoTitle: 'pixi-marrow warnings and MarrowError codes: Spine in PixiJS',
        seoDescription:
            'Every console warning and every MarrowError code of pixi-marrow, the Spine runtime for PixiJS v8, with its text, its cause and the fix.',
    },
    '/lab/': {
        seoTitle: 'Lab: test Spine performance in PixiJS v8 on your device',
        seoDescription:
            'The lab plays Spine scenes with pixi-marrow on the device that opens it, and counts frames and CPU time. This page lists the tests and how they measure.',
    },
    '/playground/': {
        seoTitle: 'Playground: drop Spine files, play them in PixiJS v8',
        seoDescription:
            'Drop or choose Spine skeletons, atlases and page images, or a folder. pixi-marrow plays every skeleton in PixiJS v8 with its numbers, in this browser only.',
    },
};

/** The route of a page of the API reference: one per entry point of the package, made at build time. */
const API_ENTRY = /^\/api\/[^/]+\/$/;

/** Routes that search engines must not index: the lab tests, the playground and the 404 page. */
const NOINDEX: readonly RegExp[] = [/^\/lab\/[^/]+\/$/, /^\/playground\/$/, /^\/404(\.html|\/)?$/];

/** True for a route that carries `noindex` and stays out of the sitemap. */
export const isNoindex = (route: string): boolean => NOINDEX.some((pattern) => pattern.test(route));

/** The title of the browser tab and of a shared link, for a route and the title of its page file. */
export function seoTitle(route: string, pageTitle?: string): string {
    const entry = SEO[route];

    if (entry?.seoTitle !== undefined) return entry.seoTitle;
    // a page of the API reference has the name of its entry point as its title, such as `API: pixi-marrow/core`
    if (API_ENTRY.test(route) && pageTitle !== undefined) return `${pageTitle}, Spine runtime for PixiJS v8`;
    if (pageTitle === undefined) return `pixi-marrow, a Spine runtime for PixiJS v8`;

    return `${pageTitle} ${TITLE_SUFFIX}`;
}

/** The description for search results and shared links, for a route and the description of its page file. */
export function seoDescription(route: string, pageDescription: string): string {
    return SEO[route]?.seoDescription ?? pageDescription;
}
