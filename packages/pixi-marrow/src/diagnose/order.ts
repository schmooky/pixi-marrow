import type { Hits, Seen } from './hits';
import type { TreeNode } from './types';

/*
 * The rules about the draw order: what lies between two batched skeletons, which batcher a
 * skeleton needs, and how many atlas pages the skeletons of one batch use together.
 */

/** One step of the draw order of a tree. */
export interface OrderItem {
    /** `batched`: a skeleton in the batched mode. `other`: something else that draws. `break`: the batch ends here. */
    kind: 'batched' | 'other' | 'break';
    node: TreeNode;
    seen?: Seen;
    /** Whether the parent sorts its children by `zIndex`. */
    sorted: boolean;
}

/** What the scan knows of the batch that is open. */
interface Open {
    /** The batched skeleton before this one, when nothing ended the batch since. */
    last: Seen | undefined;
    /** What drew since that skeleton. */
    between: OrderItem[];
    /** Whether the open batch has dark colors. */
    batcher: 'none' | 'plain' | 'dark';
    /** The atlas pages of the assets in the open batch, by the id of the asset. */
    pages: Map<number, number>;
}

/** MARROW004 and MARROW005: something else draws between two batched skeletons. */
function between(open: Open, item: OrderItem, seen: Seen, hits: Hits): void {
    const [first] = open.between;

    if (open.last === undefined || first === undefined) return;
    const sorted = first.sorted || item.sorted;
    const what = first.seen === undefined ? first.node.type : 'a skeleton in the mesh mode';

    hits.add(
        sorted ? 'MARROW005' : 'MARROW004',
        seen.node.path,
        first.node.path,
        { between: open.between.length },
        `"${first.node.path}" (${what}) draws between this skeleton and "${open.last.node.path}", so the batch ends and this skeleton starts a new draw call.`,
        `${first.node.path}|${seen.node.path}`,
    );
}

/** MARROW013: a skeleton with dark colors follows one without them in the open batch. */
function darkSwitch(open: Open, seen: Seen, hits: Hits): void {
    const dark = seen.marrow.render.darkTint;

    if (dark && open.batcher === 'plain' && open.last !== undefined) {
        hits.add(
            'MARROW013',
            seen.node.path,
            open.last.node.path,
            {},
            `This skeleton has dark colors and "${open.last.node.path}" before it has none, so it starts a new batch.`,
        );
    }
    // a skeleton without dark colors joins an open batch that has them
    if (dark || open.batcher !== 'dark') open.batcher = dark ? 'dark' : 'plain';
}

/** MARROW007 for neighbours: the skeletons of the open batch use more pages together than a batch samples. */
function sharedPages(open: Open, seen: Seen, limit: number, hits: Hits): void {
    const { id } = seen.marrow.asset;
    const pages = seen.marrow.counts.atlasPages;
    let used = 0;

    if (open.pages.has(id)) return;
    for (const count of open.pages.values()) used += count;
    if (used > 0 && used + pages > limit && open.last !== undefined) {
        hits.add(
            'MARROW007',
            seen.node.path,
            open.last.node.path,
            { pages: used + pages, limit },
            `This skeleton and the batched skeletons before it use ${used + pages} atlas pages together, and a batch samples ${limit}. It starts a new draw call.`,
        );
        open.pages.clear();
    }
    open.pages.set(id, pages);
}

/**
 * Runs the rules of the draw order over the steps of a tree.
 *
 * @param limit The most textures a batch samples.
 *
 * @example
 * scanOrder(items, 16, hits);
 */
export function scanOrder(items: readonly OrderItem[], limit: number, hits: Hits): void {
    const open: Open = { last: undefined, between: [], batcher: 'none', pages: new Map() };

    for (const item of items) {
        const { seen } = item;

        if (item.kind === 'batched' && seen !== undefined) {
            between(open, item, seen, hits);
            if (open.between.length > 0) {
                open.batcher = 'none';
                open.pages.clear();
            }
            darkSwitch(open, seen, hits);
            sharedPages(open, seen, limit, hits);
            open.last = seen;
            open.between = [];
        } else if (item.kind === 'other') {
            if (open.last !== undefined) open.between.push(item);
        } else {
            open.last = undefined;
            open.between = [];
            open.batcher = 'none';
            open.pages.clear();
        }
    }
}
