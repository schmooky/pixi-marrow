import type { LabInfo } from './lab';

/*
 * The tests of the lab, as the pages name them. A page reads this list at build time, so it
 * holds no code that draws. The code of each test is a module of `src/lab/tests`.
 */

/** The tests in the order of the index page. */
export const CATALOG: readonly LabInfo[] = [
    {
        name: 'grid',
        title: 'Slot grid',
        question: 'Which settings draw a grid of slot symbols fastest on this device?',
        scene: (count) =>
            `A grid of ${count} Bzzz symbols spins, lands and shows two line wins, again and again, as the reels of a slot game do.`,
        count: 15,
    },
    {
        name: 'crowd',
        title: 'Many copies',
        question: 'Does GPU skinning with instanced draws pay for many copies of one rig on this device?',
        scene: (count) => `${count} bees play their idle loop, each at another point of it.`,
        count: 200,
    },
    {
        name: 'rest',
        title: 'At rest',
        question: 'Does the idle cache pay on this device, where most symbols stand still?',
        scene: (count) =>
            `${count} Bzzz symbols stand at rest. Every 12 frames one of them plays its win once, so a few move at any time.`,
        count: 120,
    },
    {
        name: 'fill',
        title: 'Fill rate',
        question: 'Do tight meshes pay on the GPU of this device, where every pixel is drawn many times?',
        scene: (count) =>
            `${count} big bees cover the whole screen, on top of each other, and play their feature loop.`,
        count: 12,
    },
];

/** What the catalog says about the test with a name. */
export function testInfo(name: string): LabInfo {
    const info = CATALOG.find((test) => test.name === name);

    if (info === undefined) throw new Error(`the catalog of the lab has no test named ${name}`);

    return info;
}
