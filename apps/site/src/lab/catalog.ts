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
        question: 'Does a slot grid play at the full frame rate of this device?',
        scene: (count) =>
            `A grid of ${count} Bzzz symbols spins, lands and shows two line wins, again and again, as the reels of a slot game do.`,
        count: 15,
        noun: 'symbols',
    },
    {
        name: 'how-many',
        title: 'How many',
        question: 'How many slot symbols does this device play at the full frame rate?',
        scene: (count) =>
            `Bzzz symbols play their idle loops. It starts with ${count}, and more join every few seconds until the frames drop.`,
        count: 20,
        noun: 'symbols',
        grows: true,
    },
    {
        name: 'rest',
        title: 'At rest',
        question: 'What do symbols cost while most of them stand still?',
        scene: (count) =>
            `${count} Bzzz symbols stand at rest. Five times a second one of them plays its win once, so a few move at any time.`,
        count: 60,
        noun: 'symbols',
    },
    {
        name: 'crowd',
        title: 'Many copies',
        question: 'Do many copies of one rig play at the full frame rate of this device?',
        scene: (count) => `${count} bees play their idle loop, each at another point of it.`,
        count: 100,
        noun: 'bees',
    },
];

/** What the catalog says about the test with a name. */
export function testInfo(name: string): LabInfo {
    const info = CATALOG.find((test) => test.name === name);

    if (info === undefined) throw new Error(`the catalog of the lab has no test named ${name}`);

    return info;
}
