import { exports as packageExports, version } from '../../../../packages/pixi-marrow/package.json';
import { routeExists } from './routes';

/** What every page of the site says about the project. */
export const SITE = {
    name: 'pixi-marrow',
    tagline: 'A Spine runtime for PixiJS v8',
    description: 'pixi-marrow plays Spine 4.1, 4.2 and 4.3 skeletons in PixiJS v8 with its own pose core.',
    repository: 'https://github.com/schmooky/pixi-marrow',
    npm: 'https://www.npmjs.com/package/pixi-marrow',
    /** The version of the package in this checkout, which the bar at the top shows. */
    version,
    /** The command that installs the pre-release, as the start page and the README have it. */
    install: 'npm install pixi-marrow@next pixi.js',
};

/**
 * The parts of the docs, in reading order. The guide comes first: it shows how to load, play and
 * control animations, one step at a time. The basics explain the computer graphics a runtime
 * stands on, for a reader who wants them. How it works takes the runtime apart, so that the
 * reader sees why it does what it does. The reference holds what a game looks up.
 */
export type DocsSection = 'Basics' | 'Guide' | 'How it works' | 'Reference';

/** The parts in the order the navigation shows them. */
export const SECTIONS: readonly DocsSection[] = ['Guide', 'Basics', 'How it works', 'Reference'];

/** A page of the docs, as the navigation lists it. */
export interface DocsPage {
    href: string;
    title: string;
    /** One line for the card on the home page. */
    description: string;
    section: DocsSection;
}

/**
 * The entry points of the package, from the `exports` of its `package.json`. Each has a page of
 * the API reference, which `src/pages/api/[entry].astro` builds from the declarations. A new
 * entry point shows here with no other change.
 */
const API_ENTRIES: readonly { name: string; slug: string; href: string }[] = Object.entries(packageExports)
    .filter(([, target]) => typeof target === 'object')
    .map(([key]) => {
        const slug = key === '.' ? 'pixi-marrow' : key.slice(2);

        return { name: key === '.' ? 'pixi-marrow' : `pixi-marrow/${slug}`, slug, href: `/api/${slug}/` };
    });

/** The pages of the API reference, one per entry point, as the navigation lists them. */
const API_PAGES: DocsPage[] = API_ENTRIES.map((entry) => ({
    href: entry.href,
    title: `API: ${entry.name}`,
    description: `Every export of ${entry.name}, with its signature and its example.`,
    section: 'Reference',
}));

/**
 * The pages of the docs, in reading order. Some are listed before their file exists, because
 * other work adds them. `PAGES` drops those until the build has the page.
 */
const LISTED: readonly DocsPage[] = [
    {
        href: '/start/',
        title: 'Start',
        description: 'Install, load a skeleton and play an animation.',
        section: 'Guide',
    },
    {
        href: '/guide/assets/',
        title: 'Assets and instances',
        description: 'Load a skeleton once, show it many times, and load with Pixi Assets.',
        section: 'Guide',
    },
    {
        href: '/guide/size/',
        title: 'Size and units',
        description: 'Fit a skeleton to a place on the screen, and what its scale changes.',
        section: 'Guide',
    },
    {
        href: '/guide/play/',
        title: 'Play',
        description: 'Loops, speed, how to stop, poses that hold, and how to know when an animation ends.',
        section: 'Guide',
    },
    {
        href: '/guide/mix/',
        title: 'Mix and queue',
        description: 'Blend one animation into the next, queue them, and layer them on tracks.',
        section: 'Guide',
    },
    {
        href: '/guide/events/',
        title: 'Events',
        description: 'Keys that the animator placed, and the life of a track.',
        section: 'Guide',
    },
    {
        href: '/skins-and-slots/',
        title: 'Skins and slots',
        description: 'Several skins at once, slot images and colors, and the setup pose.',
        section: 'Guide',
    },
    {
        href: '/bones-and-placeholders/',
        title: 'Bones and attachments',
        description: 'Read a bone, follow it, and put your own Pixi objects into a skeleton.',
        section: 'Guide',
    },
    {
        href: '/basics/pixels/',
        title: 'Pixels and frames',
        description: 'A screen is a grid of pixels, and motion is a new picture every 16.7 ms.',
        section: 'Basics',
    },
    {
        href: '/basics/transforms/',
        title: 'Coordinates and transforms',
        description: 'Move, turn and scale, and how a child moves with its parent.',
        section: 'Basics',
    },
    {
        href: '/basics/triangles/',
        title: 'Triangles and textures',
        description: 'The GPU draws only triangles, and colors them from pictures.',
        section: 'Basics',
    },
    {
        href: '/basics/gpu/',
        title: 'The GPU and draw calls',
        description: 'How the CPU and the GPU work together, and what a draw call costs.',
        section: 'Basics',
    },
    {
        href: '/basics/blending/',
        title: 'Transparency and blending',
        description: 'Alpha, blend rules, and overdraw, the main GPU cost of 2D.',
        section: 'Basics',
    },
    {
        href: '/how/frame/',
        title: 'One frame',
        description: 'From the time to the pixels in six stages, and which stage costs what.',
        section: 'How it works',
    },
    {
        href: '/how/anatomy/',
        title: 'Anatomy of a skeleton',
        description: 'Bones, slots, attachments, skins and the atlas, shown one by one on a live skeleton.',
        section: 'How it works',
    },
    {
        href: '/how/animation/',
        title: 'An animation',
        description: 'Timelines, keys, curves and events, and how a time becomes a pose.',
        section: 'How it works',
    },
    {
        href: '/how/pose/',
        title: 'The pose',
        description: 'Local and world transforms, what follows a bone, constraints, and what the runtime skips.',
        section: 'How it works',
    },
    {
        href: '/how/vertices/',
        title: 'Vertices',
        description: 'Regions and weighted meshes become triangles that take their pixels from the atlas.',
        section: 'How it works',
    },
    {
        href: '/how/batches/',
        title: 'Draw order and batches',
        description: 'How many skeletons draw in one call, and what ends a batch.',
        section: 'How it works',
    },
    {
        href: '/how/fast/',
        title: 'Why it is fast',
        description: 'What a frame skips, shown live, and what still makes a scene slow.',
        section: 'How it works',
    },
    {
        href: '/performance/',
        title: 'Performance',
        description: 'Presets, pacing and the options with a cost, and the report of what is in effect.',
        section: 'Reference',
    },
    {
        href: '/performance/caveats/',
        title: 'Performance caveats',
        description: 'What raises draw calls, CPU work, uploads, overdraw and memory, and how to fix each.',
        section: 'Reference',
    },
    {
        href: '/performance/rules/',
        title: 'Performance rules',
        description: 'Each known cost in a scene, with its id, its sign and its fix.',
        section: 'Reference',
    },
    {
        href: '/warnings/',
        title: 'Warnings and errors',
        description: 'Every console warning and every MarrowError code, with cause and fix.',
        section: 'Reference',
    },
    {
        href: '/debug/',
        title: 'Debug overlays',
        description: 'Bones, shapes, clipping and overdraw drawn over a skeleton.',
        section: 'Reference',
    },
    {
        href: '/webgpu/',
        title: 'WebGPU',
        description: 'What works on the WebGPU renderer of PixiJS, and what differs from WebGL2.',
        section: 'Reference',
    },
    {
        href: '/good-to-know/',
        title: 'Good to know',
        description: 'What is automatic, the options, the versions and the limits.',
        section: 'Reference',
    },
    {
        href: '/api/',
        title: 'API reference',
        description: 'Every export of every entry point, from the built declarations.',
        section: 'Reference',
    },
    ...API_PAGES,
    {
        href: '/compare/spine-pixi-v8/',
        title: 'Compare runtimes',
        description: 'pixi-marrow next to spine-pixi-v8 and pixi-spine, row by row.',
        section: 'Reference',
    },
    {
        href: '/benchmarks/',
        title: 'Benchmarks',
        description: 'Frame time and draw calls against spine-pixi-v8, with machine, date and method.',
        section: 'Reference',
    },
    {
        href: '/migrate/',
        title: 'Migrate',
        description: 'From spine-pixi-v8 or pixi-spine to pixi-marrow, call by call.',
        section: 'Reference',
    },
    {
        href: '/faq/',
        title: 'Questions and answers',
        description: 'Short answers on versions, renderers, draw calls, size and the licence.',
        section: 'Reference',
    },
    {
        href: '/changelog/',
        title: 'Changelog',
        description: 'What each version changed, and what can still change before 1.0.',
        section: 'Reference',
    },
    {
        href: '/reels/',
        title: 'Example: reels',
        description: 'The reels of a slot game: pixi-reels spins them, and pixi-marrow draws them.',
        section: 'Reference',
    },
];

/** The pages of the docs that the build has, in reading order. */
export const PAGES: readonly DocsPage[] = LISTED.filter((page) => API_PAGES.includes(page) || routeExists(page.href));

/** The pages of a part of the docs, in reading order. */
export const pagesOf = (section: DocsSection): DocsPage[] => PAGES.filter((page) => page.section === section);

/** A link of the bar at the top of every page. */
export interface TopLink {
    href: string;
    title: string;
    /** One line on what is behind the link, for the menu on a phone. */
    note: string;
    /** True when the page at `path` belongs to this link. */
    current(path: string): boolean;
}

/** What each part of the docs holds, in one line. */
const SECTION_NOTES: Record<DocsSection, string> = {
    Basics: 'The computer graphics a runtime stands on.',
    Guide: 'Load, play, mix and follow animations.',
    'How it works': 'The parts of the runtime, one frame at a time.',
    Reference: 'Performance, the API, comparisons and an example.',
};

/** The parts of the docs, as the bar at the top links them: each to its first page. */
export const DOCS_LINKS: readonly TopLink[] = SECTIONS.map((section) => {
    const pages = pagesOf(section);

    return {
        href: pages[0]?.href ?? '/',
        title: section,
        note: SECTION_NOTES[section],
        current: (path: string) => pages.some((page) => page.href === path),
    };
});

/** The tools of the site. They open on pages of their own, without the docs around them. */
export const TOOL_LINKS: readonly TopLink[] = [
    {
        href: '/playground/',
        title: 'Playground',
        note: 'Drop your own Spine files, and they play here.',
        current: (path: string) => path.startsWith('/playground'),
    },
    {
        href: '/lab/',
        title: 'Lab',
        note: 'Tests that show how the runtime plays on this device.',
        current: (path: string) => path.startsWith('/lab'),
    },
];
