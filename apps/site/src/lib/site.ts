/** What every page of the site says about the project. */
export const SITE = {
    name: 'pixi-marrow',
    tagline: 'A Spine runtime for PixiJS v8',
    description: 'pixi-marrow plays Spine 4.1, 4.2 and 4.3 skeletons in PixiJS v8 with its own pose core.',
    repository: 'https://github.com/schmooky/pixi-marrow',
    install: 'npm install pixi-marrow pixi.js',
};

/** A page of the docs, as the navigation lists it. */
export interface DocsPage {
    href: string;
    title: string;
    /** One line for the card on the home page. */
    description: string;
}

/** The pages of the docs, in reading order. */
export const PAGES: readonly DocsPage[] = [
    { href: '/start/', title: 'Start', description: 'Install, load, play, queue, mix, events and skins.' },
    {
        href: '/bones-and-placeholders/',
        title: 'Bones and placeholders',
        description: 'Read a bone and put your own Pixi objects into a rig.',
    },
    {
        href: '/skins-and-slots/',
        title: 'Skins and slots',
        description: 'Several skins at once, slot attachments and colors, and the setup pose.',
    },
    {
        href: '/performance/',
        title: 'Performance',
        description: 'Presets, pacing, the idle cache, baking and GPU skinning, and the report of what is in effect.',
    },
    {
        href: '/debug/',
        title: 'Debug overlays',
        description: 'Bones, shapes, clipping and overdraw drawn over a skeleton.',
    },
    {
        href: '/good-to-know/',
        title: 'Good to know',
        description: 'What is automatic, the options, the versions and the limits.',
    },
];
