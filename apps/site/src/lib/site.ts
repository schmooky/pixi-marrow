/** What every page of the site says about the project. */
export const SITE = {
    name: 'pixi-marrow',
    tagline: 'A Spine runtime for PixiJS v8',
    description: 'pixi-marrow plays Spine 4.1, 4.2 and 4.3 skeletons in PixiJS v8 with its own pose core.',
    repository: 'https://github.com/schmooky/pixi-marrow',
    install: 'npm install pixi-marrow pixi.js',
};

/**
 * The parts of the docs, in reading order. The basics explain the computer graphics a runtime
 * stands on. The guide shows how to load, play and control animations, one step at a time. How it works takes the runtime apart, so that the reader sees
 * why it does what it does. The reference holds what a game looks up.
 */
export type DocsSection = 'Basics' | 'Guide' | 'How it works' | 'Reference';

/** The parts in the order the navigation shows them. */
export const SECTIONS: readonly DocsSection[] = ['Basics', 'Guide', 'How it works', 'Reference'];

/** A page of the docs, as the navigation lists it. */
export interface DocsPage {
    href: string;
    title: string;
    /** One line for the card on the home page. */
    description: string;
    section: DocsSection;
}

/** The pages of the docs, in reading order. */
export const PAGES: readonly DocsPage[] = [
    {
        href: '/basics/pixels/',
        title: 'Pixels and frames',
        description: 'A screen is a grid of pixels, and motion is a new picture every 16.7 ms.',
        section: 'Basics',
    },
    {
        href: '/basics/transforms/',
        title: 'Coordinates and transforms',
        description: 'Move, turn and scale, and how a child takes its parent along.',
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
        href: '/start/',
        title: 'Start',
        description: 'Install, load a skeleton and play an animation.',
        section: 'Guide',
    },
    {
        href: '/guide/assets/',
        title: 'Assets and copies',
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
        description: 'Loops, speed, stopping, poses that hold, and knowing when an animation ends.',
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
        href: '/how/frame/',
        title: 'One frame',
        description: 'From the time to the pixels in six stages, and which stage costs what.',
        section: 'How it works',
    },
    {
        href: '/how/anatomy/',
        title: 'Anatomy of a skeleton',
        description: 'Bones, slots, attachments, skins and the atlas, taken apart live.',
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
        description: 'Local and world transforms, what follows a bone, constraints, and what is skipped.',
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
        description: 'What a frame leaves out, shown live, and what still makes a scene slow.',
        section: 'How it works',
    },
    {
        href: '/performance/',
        title: 'Performance',
        description: 'Presets, pacing and the options with a cost, and the report of what is in effect.',
        section: 'Reference',
    },
    {
        href: '/debug/',
        title: 'Debug overlays',
        description: 'Bones, shapes, clipping and overdraw drawn over a skeleton.',
        section: 'Reference',
    },
    {
        href: '/good-to-know/',
        title: 'Good to know',
        description: 'What is automatic, the options, the versions and the limits.',
        section: 'Reference',
    },
    {
        href: '/reels/',
        title: 'Example: reels',
        description: 'The reels of a slot game, spun by pixi-reels and drawn by pixi-marrow.',
        section: 'Reference',
    },
];

/** The pages of a part of the docs, in reading order. */
export const pagesOf = (section: DocsSection): DocsPage[] => PAGES.filter((page) => page.section === section);

/** A link of the bar at the top of every page. */
export interface TopLink {
    href: string;
    title: string;
    /** True when the page at `path` belongs to this link. */
    current(path: string): boolean;
}

/** The bar at the top: one link per part of the docs, then the playground and the lab. */
export const TOP_LINKS: readonly TopLink[] = [
    ...SECTIONS.map((section) => {
        const pages = pagesOf(section);

        return {
            href: pages[0]?.href ?? '/',
            title: section,
            current: (path: string) => pages.some((page) => page.href === path),
        };
    }),
    { href: '/playground/', title: 'Playground', current: (path: string) => path.startsWith('/playground') },
    { href: '/lab/', title: 'Lab', current: (path: string) => path.startsWith('/lab') },
];
