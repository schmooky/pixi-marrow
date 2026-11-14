/** What every page of the site says about the project. */
export const SITE = {
    name: 'pixi-marrow',
    tagline: 'A Spine runtime for PixiJS v8',
    description: 'pixi-marrow plays Spine 4.1, 4.2 and 4.3 skeletons in PixiJS v8 with its own pose core.',
    repository: 'https://github.com/schmooky/pixi-marrow',
    install: 'npm install pixi-marrow pixi.js',
};

/**
 * The parts of the docs, in reading order. The slot guide builds a slot game step by step. How
 * it works takes the runtime apart, so that the reader sees why it does what it does.
 */
export type DocsSection = 'Start' | 'Slot guide' | 'How it works' | 'Reference';

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
        href: '/start/',
        title: 'Start',
        description: 'Install, load, play, queue, mix, events and skins.',
        section: 'Start',
    },
    {
        href: '/guide/symbol-set/',
        title: 'A symbol set',
        description: 'Load each symbol once and make as many copies as the reels show.',
        section: 'Slot guide',
    },
    {
        href: '/guide/cell/',
        title: 'A symbol in its cell',
        description: 'Size a symbol for the cells of the reels, and what its scale changes.',
        section: 'Slot guide',
    },
    {
        href: '/guide/states/',
        title: 'Symbol states',
        description: 'Idle, landing, win, dimmed and blurred, and how a symbol moves between them.',
        section: 'Slot guide',
    },
    {
        href: '/how/anatomy/',
        title: 'Anatomy of a symbol',
        description: 'Bones, slots, attachments, skins and the atlas, taken apart on the Bzzz symbols.',
        section: 'How it works',
    },
    {
        href: '/how/animation/',
        title: 'An animation',
        description: 'Timelines, keys, curves and events, on the win of the bee, and how a time becomes a pose.',
        section: 'How it works',
    },
    {
        href: '/bones-and-placeholders/',
        title: 'Bones and placeholders',
        description: 'Read a bone and put your own Pixi objects into a rig.',
        section: 'Reference',
    },
    {
        href: '/skins-and-slots/',
        title: 'Skins and slots',
        description: 'Several skins at once, slot attachments and colors, and the setup pose.',
        section: 'Reference',
    },
    {
        href: '/reels/',
        title: 'Reels',
        description: 'The reels of a slot game, spun by pixi-reels and drawn by pixi-marrow, with line wins.',
        section: 'Reference',
    },
    {
        href: '/performance/',
        title: 'Performance',
        description: 'Presets, pacing, the idle cache, baking and GPU skinning, and the report of what is in effect.',
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
];

/** The pages of a part of the docs, in reading order. */
export const pagesOf = (section: DocsSection): DocsPage[] => PAGES.filter((page) => page.section === section);
