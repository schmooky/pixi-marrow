import type { Container } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { formatHit } from './hits';
import { inspect } from './inspect';
import { DOCS, RULES } from './rules-data';
import { diagnoseTree } from './static';
import { isMarrowSpine, type RendererLike, serializeTree, walkTree } from './tree';
import type { Diagnosis, PerfRule, SkeletonInspection, TreeDump } from './types';
import { diagnose, type Watch, watch } from './watch';

/*
 * The global hook `__PIXI_MARROW__`: what a coding agent or a person calls in the console of a
 * running game. The package registers nothing at import, so the hook exists only after a game
 * calls `installDevtools`. It finds the skeletons by a walk from a root, and keeps no list.
 */

/** A ticker as the dev warnings use it. A Pixi `Ticker` is one. */
interface WarnTicker {
    add(fn: () => void): unknown;
    remove(fn: () => void): unknown;
}

/** What `installDevtools` takes. */
export interface DevtoolsOptions {
    /**
     * True prints each hit to the console once per rule and skeleton, with `console.warn`.
     * Default false: the hook returns data and prints nothing.
     */
    warn?: boolean;
    /** The root to walk when a call names none. Default: `globalThis.__PIXI_APP__.stage`. */
    root?: Container;
    /** The renderer of the game. Default: `globalThis.__PIXI_APP__.renderer`. */
    renderer?: RendererLike;
    /**
     * With `warn`: a ticker that drives the warnings. The hook then watches the root and reports
     * every `every` ticks. Without it, a warning prints when the game calls `diagnose` or `report`.
     */
    ticker?: WarnTicker;
    /** The ticks between two reports of the ticker. Default 120. */
    every?: number;
}

/** The global hook, as `globalThis.__PIXI_MARROW__` after `installDevtools`. */
export interface MarrowDevtools {
    /** The version of the shape of the hook and of its data. */
    readonly version: 1;
    /** The address of the docs page of the rules. */
    readonly docs: string;
    /** The catalogue of the rules. */
    readonly rules: readonly PerfRule[];
    /** The path of every skeleton below a root. */
    instances(root?: Container): string[];
    /** Every skeleton below a root as plain data. A `MarrowSpine` as the root gives a list of one. */
    inspect(root?: Container): SkeletonInspection[];
    /** The tree below a root as plain data, for `diagnoseTree`. */
    tree(root?: Container): TreeDump;
    /** The static causes of cost below a root. */
    diagnose(root?: Container): Diagnosis;
    /** Starts to watch a root. Its `report` adds the causes that show over time. */
    watch(root?: Container): Watch;
    /** The static rules on a tree dump, as `diagnoseTree` runs them. */
    diagnoseTree(dump: TreeDump): Diagnosis;
    /** Removes the hook and stops its ticker. */
    uninstall(): void;
}

/** The app that PixiJS DevTools reads, when a game sets it. */
interface GlobalApp {
    stage?: Container;
    renderer?: RendererLike;
}

const HOOK = '__PIXI_MARROW__';
const EVERY = 120;

/** The app a game put on `globalThis` for PixiJS DevTools, or undefined. */
function globalApp(): GlobalApp | undefined {
    const app: unknown = Reflect.get(globalThis, '__PIXI_APP__');

    return typeof app === 'object' && app !== null ? app : undefined;
}

/** Prints the hits that were not printed before for their rule and skeleton. */
function warnNew(result: Diagnosis, printed: Set<string>): Diagnosis {
    for (const hit of result.hits) {
        const key = `${hit.id}|${hit.node}`;

        if (printed.has(key)) continue;
        printed.add(key);
        console.warn(formatHit(hit));
    }

    return result;
}

/**
 * Puts the hook `__PIXI_MARROW__` on `globalThis` and returns it. Call it in a development
 * build, once the app exists. A coding agent that can run code in the page then reads every
 * skeleton with `__PIXI_MARROW__.diagnose()`.
 *
 * The hook walks from `options.root`, else from `__PIXI_APP__.stage`. A call without a root
 * throws a `MarrowError` when neither exists.
 *
 * @example
 * if (import.meta.env.DEV) installDevtools({ root: app.stage, renderer: app.renderer });
 * // in the console: __PIXI_MARROW__.diagnose().hits
 *
 * @see https://pixi-marrow.schmooky.dev/performance/rules/
 */
export function installDevtools(options: DevtoolsOptions = {}): MarrowDevtools {
    const printed = new Set<string>();
    const rootOf = (root?: Container): Container => {
        const found = root ?? options.root ?? globalApp()?.stage;

        if (found === undefined) {
            throw new MarrowError('invalid-option', 'The devtools hook has no root to walk.', {
                fix: 'Pass a container, or call installDevtools({ root: app.stage }).',
                docs: DOCS,
            });
        }

        return found;
    };
    const tree = (): { renderer: RendererLike | undefined } => ({
        renderer: options.renderer ?? globalApp()?.renderer,
    });
    const told = (result: Diagnosis): Diagnosis => (options.warn === true ? warnNew(result, printed) : result);
    const { ticker } = options;
    let watching: Watch | undefined;
    let ticks = 0;
    const tick = (): void => {
        watching ??= watch(rootOf(), tree());
        watching.sample();
        if (++ticks % (options.every ?? EVERY) === 0) told(watching.report());
    };
    const hook: MarrowDevtools = {
        version: 1,
        docs: DOCS,
        rules: RULES,
        instances: (root) => walkTree(rootOf(root), tree()).skeletons.map(({ node }) => node.path),
        inspect(root) {
            const from = rootOf(root);

            return isMarrowSpine(from) ? [inspect(from)] : walkTree(from, tree()).skeletons.map(({ marrow }) => marrow);
        },
        tree: (root) => serializeTree(rootOf(root), tree()),
        diagnose: (root) => told(diagnose(rootOf(root), tree())),
        watch(root) {
            const inner = watch(rootOf(root), tree());

            return { sample: () => inner.sample(), report: () => told(inner.report()), stop: () => inner.stop() };
        },
        diagnoseTree,
        uninstall(): void {
            if (options.warn === true) ticker?.remove(tick);
            watching?.stop();
            watching = undefined;
            if (Reflect.get(globalThis, HOOK) === hook) Reflect.deleteProperty(globalThis, HOOK);
        },
    };

    if (options.warn === true) ticker?.add(tick);
    Reflect.set(globalThis, HOOK, hook);

    return hook;
}
