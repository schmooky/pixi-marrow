import { RULES } from './rules-data';
import type { PerfRule, RuleHit, SkeletonInspection, TreeNode } from './types';

/*
 * The list of causes a diagnosis gathers. Skeletons that share a cause share one hit: 50 symbols
 * below one container that fades are one hit with 50 paths, not 50 hits.
 */

const BY_ID: ReadonlyMap<string, PerfRule> = new Map(RULES.map((rule) => [rule.id, rule]));

/** A skeleton of a tree dump, with the display objects above it from the root down. */
export interface Seen {
    node: TreeNode;
    marrow: SkeletonInspection;
    above: TreeNode[];
}

/**
 * A count with its noun: `1 slot`, `2 slots`.
 *
 * @example
 * counted(2, 'container'); // '2 containers'
 */
export function counted(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The rule with an id. Throws for an id that the catalogue does not hold.
 *
 * @example
 * console.log(ruleOf('MARROW004').fix);
 */
export function ruleOf(id: string): PerfRule {
    const rule = BY_ID.get(id);

    if (rule === undefined) throw new Error(`pixi-marrow has no rule ${id}`);

    return rule;
}

/**
 * Gathers hits. A hit with the id and the group of an earlier one adds its path to that one.
 *
 * @example
 * const hits = new Hits();
 * hits.add('MARROW012', 'stage/hero', '', { attached: 1 }, 'One container is attached to a slot.');
 * console.log(hits.list()[0]?.docs);
 */
export class Hits {
    private readonly groups = new Map<string, RuleHit>();

    /**
     * @param cause The path of the display object that causes the hit, or an empty string.
     * @param group What tells this cause from another one of the same rule. Default: the cause, else the path.
     */
    add(
        id: string,
        node: string,
        cause: string,
        measured: Record<string, number>,
        message: string,
        group: string = cause || node,
    ): void {
        const key = `${id}|${group}`;
        const found = this.groups.get(key);
        const rule = ruleOf(id);

        if (found !== undefined) {
            if (!found.nodes.includes(node)) found.nodes.push(node);
            found.measured.skeletons = found.nodes.length;

            return;
        }
        this.groups.set(key, {
            id,
            slug: rule.slug,
            severity: rule.severity,
            node,
            nodes: [node],
            cause,
            cost: [...rule.cost],
            measured: { skeletons: 1, ...measured },
            message,
            fix: rule.fix,
            docs: rule.docs,
        });
    }

    /** The hits: `warn` before `info`, each kind in the order it was found. */
    list(): RuleHit[] {
        const hits = [...this.groups.values()];

        return [...hits.filter((hit) => hit.severity === 'warn'), ...hits.filter((hit) => hit.severity !== 'warn')];
    }
}

/**
 * A hit as one line of text, as the dev warnings and the command line tool print it.
 *
 * @example
 * console.warn(formatHit(hit)); // [pixi-marrow:MARROW004] "stage/reels/MarrowSpine" ... Fix: ... https://...
 */
export function formatHit(hit: RuleHit): string {
    const more = hit.nodes.length > 1 ? ` and ${hit.nodes.length - 1} more` : '';

    return `[pixi-marrow:${hit.id}] "${hit.node}"${more} ${hit.message} Fix: ${hit.fix} ${hit.docs}`;
}
