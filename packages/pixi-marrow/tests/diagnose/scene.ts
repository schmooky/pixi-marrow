import { Container } from 'pixi.js';
import type { Diagnosis, RuleHit, TreeDump, TreeNode } from '../../src/diagnose';
import { type MarrowAsset, MarrowSpine, type MarrowSpineOptions } from '../../src/index';
import { fixtureAsset } from '../api/helpers';

/*
 * Small scenes for the tests of `pixi-marrow/diagnose`: a root named `stage` with display objects
 * of fixtures below it. Every display object is updated by hand.
 */

/** The display objects a test made, to destroy after it. */
const made: MarrowSpine[] = [];

/** The asset of each fixture, which the display objects of one test share as those of a game do. */
const assets = new Map<string, Promise<MarrowAsset>>();

/** A display object of a fixture that updates only when the test says so. */
export async function spine(id: string, options: MarrowSpineOptions = {}): Promise<MarrowSpine> {
    let asset = assets.get(id);

    if (asset === undefined) {
        asset = fixtureAsset(id);
        assets.set(id, asset);
    }
    const hero = new MarrowSpine(await asset, { ...options, autoUpdate: false });

    made.push(hero);

    return hero;
}

/** A root with the label `stage` and the children given. */
export function stageOf(...children: Container[]): Container {
    const root = new Container({ label: 'stage' });

    if (children.length > 0) root.addChild(...children);

    return root;
}

/** Destroys what {@link spine} made since the last call. */
export function cleanUp(): void {
    for (const hero of made.splice(0)) hero.destroy();
    assets.clear();
}

/** The hits of a rule in a diagnosis. */
export const hitsOf = (result: Diagnosis, id: string): RuleHit[] => result.hits.filter((hit) => hit.id === id);

/** The ids of the rules that hit, each once, sorted. */
export const idsOf = (result: Diagnosis): string[] => [...new Set(result.hits.map((hit) => hit.id))].sort();

/** The nodes of a dump that are skeletons, in tree order. */
export function skeletonNodes(dump: TreeDump): TreeNode[] {
    const found: TreeNode[] = [];
    const visit = (node: TreeNode): void => {
        if (node.marrow !== undefined) found.push(node);
        node.children.forEach(visit);
    };

    visit(dump.root);

    return found;
}
