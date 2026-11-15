import type { Container } from 'pixi.js';
import type { MarrowSpine } from '../api/spine';
import { Hits } from './hits';
import { isDrawn } from './inspect';
import { staticRules } from './static';
import { type TreeOptions, type Walk, walkTree } from './tree';
import type { Diagnosis, SkeletonInspection } from './types';

/*
 * The dynamic rules: what two looks at a tree find. `watch` notes the counters of every skeleton
 * and the transform, the alpha and the tint of every display object above it. `report` reads
 * them again and names what grew. Nothing here has a timer: the caller decides when to look.
 */

/** How often a counter must grow between two looks for its rule to hit. */
const REPEATS = 2;
/** How many builds or layouts between two looks make their rules hit, and how many a second. */
const CHURN = 3;
const CHURN_RATE = 1;
/** How many entries a 4.3 track must start more than it ends for MARROW025 to hit. */
const CHAIN = 4;

/** What a display object looked like at a look: its transform, its alpha and its tint. */
interface Pose {
    node: Container;
    values: number[];
}

/** What `watch` notes of one skeleton. */
interface Base {
    totals: SkeletonInspection['totals'];
    drawn: boolean;
    /** The skeleton and the display objects above it, up to the first render group. */
    chain: Pose[];
    /** The `start` and `end` events since the look. Counted for a skeleton of Spine 4.3. */
    starts: number;
    ends: number;
    showing: boolean;
    /** How often `sample` found that the image of the idle cache went away. */
    drops: number;
    stop(): void;
}

/** What two looks at a tree return, and the handle to look again. */
export interface Watch {
    /**
     * Notes what changes between frames and has no counter: whether the idle cache shows its
     * image. Call it once per frame when MARROW019 matters. Other rules do not need it.
     */
    sample(): void;
    /**
     * The static and the dynamic causes since `watch` or since the last report. The next report
     * starts from this one.
     */
    report(): Diagnosis;
    /** Removes the listeners that count `start` and `end` events. */
    stop(): void;
}

const poseOf = (node: Container): number[] => [
    node.position.x,
    node.position.y,
    node.scale.x,
    node.scale.y,
    node.rotation,
    node.skew.x,
    node.skew.y,
    node.pivot.x,
    node.pivot.y,
    node.alpha,
    Number(node.tint),
];
/** The first value of a pose that is the alpha: the values before it are the transform. */
const ALPHA_AT = 9;

/** The skeleton and the display objects above it whose changes reach its batch: up to the first render group. */
function chainOf(hero: Container): Pose[] {
    const chain: Pose[] = [];

    for (let node: Container | null | undefined = hero; node != null; node = node.parent) {
        chain.push({ node, values: poseOf(node) });
        if (node.isRenderGroup) break;
    }

    return chain;
}

/** The display object highest above a skeleton whose values changed in a range, or undefined. */
function changed(chain: readonly Pose[], from: number, to: number): Container | undefined {
    let found: Container | undefined;

    for (const { node, values } of chain) {
        const now = poseOf(node);

        for (let i = from; i < to; i++) if (now[i] !== values[i]) found = node;
    }

    return found;
}

function baseOf(hero: MarrowSpine, marrow: SkeletonInspection): Base {
    const base: Base = {
        totals: marrow.totals,
        drawn: isDrawn(hero),
        chain: chainOf(hero),
        starts: 0,
        ends: 0,
        showing: marrow.idle.showing,
        drops: 0,
        stop: () => undefined,
    };

    if (marrow.asset.spine === '4.3') {
        const start = (): void => {
            base.starts++;
        };
        const end = (): void => {
            base.ends++;
        };

        hero.on('start', start);
        hero.on('end', end);
        base.stop = (): void => {
            if (hero.destroyed) return;
            hero.off('start', start);
            hero.off('end', end);
        };
    }

    return base;
}

/** What the dynamic rules read: the tree now, what was noted, and the seconds between. */
interface Window {
    walk: Walk;
    bases: Map<MarrowSpine, Base>;
    seconds: number;
    hits: Hits;
}

/** The path of the display object that causes a hit, or an empty string for the skeleton itself. */
function pathOf(walk: Walk, hero: MarrowSpine, node: Container | undefined): string {
    if (node === undefined || node === hero) return '';
    for (const [path, at] of walk.nodes) if (at === node) return path;

    return '';
}

/** Who changed, for a message. A value that is back where it was at the first look names nobody. */
function whoOf(hero: MarrowSpine, node: Container | undefined, cause: string): string {
    if (node === undefined) return 'The skeleton or a display object above it';

    return node === hero || cause === '' ? 'The skeleton' : `"${cause}"`;
}

/** MARROW001 and MARROW002: something above a batched skeleton moved or changed its tint. */
function movedAbove(path: string, hero: MarrowSpine, now: SkeletonInspection, base: Base, window: Window): void {
    const { totals } = now;
    const replaces = totals.transformReplaces - base.totals.transformReplaces;
    const rewrites = totals.tintRewrites - base.totals.tintRewrites;
    const { walk, hits } = window;

    if (replaces >= REPEATS) {
        const mover = changed(base.chain, 0, ALPHA_AT);
        const cause = pathOf(walk, hero, mover);
        const bytes = totals.uploadBytes.positions - base.totals.uploadBytes.positions;

        hits.add(
            'MARROW001',
            path,
            cause,
            { transformReplaces: replaces, positionBytes: bytes, skips: totals.skips - base.totals.skips },
            `${whoOf(hero, mover, cause)} moved in ${replaces} frames, and each one placed every vertex of the skeleton again.`,
        );
    }
    if (rewrites >= REPEATS) {
        const fader = changed(base.chain, ALPHA_AT, ALPHA_AT + 2);
        const cause = pathOf(walk, hero, fader);
        const bytes = totals.uploadBytes.statics - base.totals.uploadBytes.statics;

        hits.add(
            'MARROW002',
            path,
            cause,
            { tintRewrites: rewrites, staticBytes: bytes },
            `${whoOf(hero, fader, cause)} changed its alpha or tint in ${rewrites} frames, and each one wrote the static data of every vertex again.`,
        );
    }
}

/** MARROW014 and MARROW023: Pixi built the instructions, or the runtime built the layout, again and again. */
function churn(path: string, now: SkeletonInspection, base: Base, { seconds, hits }: Window): void {
    const builds = now.totals.instructionBuilds - base.totals.instructionBuilds;
    const layouts = now.totals.templateBuilds - base.totals.templateBuilds;
    const often = (count: number): boolean => count >= CHURN && count / Math.max(seconds, 1e-3) >= CHURN_RATE;

    if (often(builds)) {
        hits.add(
            'MARROW014',
            path,
            '',
            { instructionBuilds: builds, seconds },
            `Pixi built the instructions of the render group ${builds} times in ${seconds.toFixed(1)} seconds, and each build wrote the skeleton again.`,
            'render group',
        );
    }
    if (often(layouts)) {
        hits.add(
            'MARROW023',
            path,
            '',
            { templateBuilds: layouts, seconds },
            `The runtime laid the vertex ranges out ${layouts} times in ${seconds.toFixed(1)} seconds.`,
        );
    }
}

/** MARROW015, MARROW019 and MARROW025: a hidden skeleton that updates, an idle image that comes and goes, a mix chain. */
function wasted(path: string, hero: MarrowSpine, now: SkeletonInspection, base: Base, { hits }: Window): void {
    const { totals } = now;
    const work = (of: SkeletonInspection['totals']): number => of.skips + of.positionUploads + of.boneUploads;
    const updates = work(totals) - work(base.totals);
    const chain = base.starts - base.ends;

    if (!base.drawn && !isDrawn(hero) && updates > 0) {
        hits.add(
            'MARROW015',
            path,
            '',
            { updates },
            `Pixi does not draw the skeleton, and its view updated ${updates} times: the game calls update() itself.`,
        );
    }
    if (base.drops >= REPEATS) {
        hits.add(
            'MARROW019',
            path,
            '',
            { drops: base.drops },
            `The idle cache dropped its image ${base.drops} times and drew it again.`,
        );
    }
    if (chain >= CHAIN) {
        hits.add(
            'MARROW025',
            path,
            '',
            { starts: base.starts, ends: base.ends },
            `${base.starts} animations started and ${base.ends} ended: the track changes faster than its mix, and every update applies the whole chain.`,
        );
    }
}

/**
 * Notes the counters of every skeleton below a root, to compare them later. Call `report` after
 * some frames: it returns what `diagnose` returns, with the causes that only two looks show.
 *
 * @example
 * const watching = watch(app.stage, { renderer: app.renderer });
 * setTimeout(() => console.table(watching.report().hits), 2000);
 */
export function watch(root: Container, options: TreeOptions = {}): Watch {
    const bases = new Map<MarrowSpine, Base>();
    let since = performance.now();
    const note = (walk: Walk): void => {
        for (const base of bases.values()) base.stop();
        bases.clear();
        for (const { hero, marrow } of walk.skeletons) bases.set(hero, baseOf(hero, marrow));
        since = performance.now();
    };

    note(walkTree(root, options));

    return {
        sample(): void {
            for (const [hero, base] of bases) {
                const showing =
                    !hero.destroyed && hero.children.some((child) => child.label === 'marrow-idle' && child.visible);

                if (base.showing && !showing) base.drops++;
                base.showing = showing;
            }
        },
        report(): Diagnosis {
            const walk = walkTree(root, options);
            const hits = new Hits();
            const { skeletons, scene } = staticRules(walk.dump, hits);
            const window: Window = { walk, bases, seconds: (performance.now() - since) / 1000, hits };

            for (const { hero, node, marrow } of walk.skeletons) {
                const base = bases.get(hero);

                if (base === undefined) continue;
                movedAbove(node.path, hero, marrow, base, window);
                churn(node.path, marrow, base, window);
                wasted(node.path, hero, marrow, base, window);
            }
            note(walk);

            return { skeletons, hits: hits.list(), scene };
        },
        stop(): void {
            for (const base of bases.values()) base.stop();
            bases.clear();
        },
    };
}

/** What `diagnose` takes besides the root. */
export interface DiagnoseOptions extends TreeOptions {
    /** A watch that was started some frames ago. With it the dynamic rules can hit. */
    since?: Watch | undefined;
}

/**
 * Finds every pixi-marrow skeleton below a root and names what costs draw calls, CPU time,
 * uploads or overdraw. Each hit has a stable rule id, the path of the skeleton, the path of the
 * cause, the numbers behind it, a fix and the address of the rule in the docs.
 *
 * One call finds the static causes. Pass `since`, a `watch` started some frames ago, to find
 * the causes that show only over time, such as a parent that moves.
 *
 * @example
 * const { skeletons, hits, scene } = diagnose(app.stage, { renderer: app.renderer });
 * for (const hit of hits) console.log(hit.id, hit.node, hit.cause, hit.fix, hit.docs);
 *
 * @see https://pixi-marrow.schmooky.dev/performance/rules/
 */
export function diagnose(root: Container, options: DiagnoseOptions = {}): Diagnosis {
    if (options.since !== undefined) return options.since.report();
    const hits = new Hits();
    const { skeletons, scene } = staticRules(walkTree(root, options).dump, hits);

    return { skeletons, hits: hits.list(), scene };
}
