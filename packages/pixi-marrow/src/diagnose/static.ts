import { Hits, type Seen } from './hits';
import { type OrderItem, scanOrder } from './order';
import { skeletonRules } from './skeleton-rules';
import type { Diagnosis, SceneTotals, TreeDump, TreeNode } from './types';

/*
 * The static rules: what one look at a tree dump finds. This module and the ones it imports
 * need no Pixi, so the command line tool runs them in Node on a dump that a browser wrote.
 */

/** The draws of the mesh mode that the shared uniform buffer of Pixi holds on WebGPU, less the room the runtime keeps free. */
const UNIFORM_DRAWS = 1791;
/** The first pixi.js 8 minor whose buffers upload a stretch. */
const RANGED_MINOR = 23;
/** From this many batched skeletons, one stretch per buffer can cost more than a stretch for each. */
const MANY_BATCHED = 8;

/** A tree in draw order: the skeletons Pixi draws, the steps of the order, and all skeletons. */
interface Flat {
    drawn: Seen[];
    items: OrderItem[];
    skeletons: number;
}

function countSkeletons(node: TreeNode): number {
    return (node.marrow === undefined ? 0 : 1) + node.children.reduce((sum, child) => sum + countSkeletons(child), 0);
}

/** The children of a display object in the order Pixi draws them. */
function drawOrder(node: TreeNode): TreeNode[] {
    if (!node.sortableChildren) return node.children;

    // the sort of Pixi is stable too
    return [...node.children].sort((a, b) => a.zIndex - b.zIndex);
}

/** Lists what a tree draws, in draw order. */
function flatten(root: TreeNode): Flat {
    const flat: Flat = { drawn: [], items: [], skeletons: countSkeletons(root) };
    const visit = (node: TreeNode, above: TreeNode[], sorted: boolean): void => {
        // Pixi collects a display object with an alpha of 0 too: it still ends a batch, and a batched
        // skeleton still fills its triangles. Only `visible` and `renderable` take it out of the build
        if (!node.visible || !node.renderable) return;
        // Pixi ends the batch around a render group, a filter and a mask
        const ends = node !== root && (node.renderGroup || node.cacheAsTexture || node.filters > 0 || node.mask);

        if (ends) flat.items.push({ kind: 'break', node, sorted });
        if (node.marrow !== undefined) {
            const seen: Seen = { node, marrow: node.marrow, above };

            flat.drawn.push(seen);
            flat.items.push({ kind: node.marrow.render.mode === 'batched' ? 'batched' : 'other', node, seen, sorted });
        } else {
            if (node.draws) flat.items.push({ kind: 'other', node, sorted });
            for (const child of drawOrder(node)) visit(child, [...above, node], node.sortableChildren);
        }
        if (ends) flat.items.push({ kind: 'break', node, sorted });
    };

    visit(root, [], false);

    return flat;
}

/** MARROW024 and MARROW026: what the renderer and the version of Pixi do with the draws and the uploads. */
function sceneRules(dump: TreeDump, drawn: readonly Seen[], scene: SceneTotals, hits: Hits): void {
    const meshes = drawn.filter(({ marrow }) => marrow.render.mode === 'mesh');
    const alone = meshes.filter(({ marrow }) => !marrow.render.instancing.active);
    const draws = alone.reduce((sum, { marrow }) => sum + marrow.render.drawCalls, 0);
    const [major = 0, minor = 0] = dump.pixi.split('.').map(Number);
    const [first] = meshes;

    const batched = drawn.filter(({ marrow }) => marrow.render.mode === 'batched').length;

    // one stretch per buffer costs more only when several skeletons of a batch change in a frame
    if (major === 8 && minor < RANGED_MINOR && batched >= MANY_BATCHED && dump.renderer?.type !== 'webgpu') {
        hits.add(
            'MARROW026',
            dump.root.path,
            '',
            { skeletons: batched },
            `pixi.js ${dump.pixi} on WebGL uploads one stretch per buffer for the ${batched} batched skeletons, from the first change to the last.`,
        );
    }
    if (first === undefined) return;
    if (dump.renderer?.type === 'webgpu' && draws > UNIFORM_DRAWS) {
        hits.add(
            'MARROW024',
            dump.root.path,
            '',
            { meshDrawCalls: scene.meshDrawCalls, limit: UNIFORM_DRAWS },
            `The skeletons in the mesh mode take ${draws} draws in a frame, more than the ${UNIFORM_DRAWS} that share the uniform buffer of Pixi on WebGPU.`,
        );
    }
}

/** The totals over the skeletons that Pixi draws. */
function totals(drawn: readonly Seen[]): SceneTotals {
    const scene: SceneTotals = {
        drawn: drawn.length,
        batched: 0,
        mesh: 0,
        instanced: 0,
        assets: new Set(drawn.map(({ marrow }) => marrow.asset.id)).size,
        vertices: 0,
        indices: 0,
        meshDrawCalls: 0,
        frameBytes: 0,
        instanceBytes: 0,
        gpuBufferBytes: 0,
    };

    for (const { marrow } of drawn) {
        const { render, counts, frame, memory } = marrow;

        if (render.mode === 'batched') scene.batched++;
        else {
            scene.mesh++;
            scene.meshDrawCalls += render.drawCalls;
        }
        if (render.instancing.active) scene.instanced++;
        scene.vertices += counts.vertices;
        scene.indices += counts.indices;
        scene.frameBytes += frame.uploadBytes;
        scene.instanceBytes += memory.instance;
        scene.gpuBufferBytes += memory.gpuBuffers;
    }

    return scene;
}

/**
 * Whether a value has the shape of a tree dump: the kind, a version this code reads and a root.
 *
 * @example
 * const dump: unknown = JSON.parse(text);
 * if (isTreeDump(dump)) console.log(diagnoseTree(dump).hits.length);
 */
export function isTreeDump(value: unknown): value is TreeDump {
    if (typeof value !== 'object' || value === null) return false;
    const { kind, version, pixi, root } = value as Partial<TreeDump>;

    return (
        kind === 'pixi-marrow/tree' &&
        version === 1 &&
        typeof pixi === 'string' &&
        typeof root === 'object' &&
        root !== null &&
        Array.isArray(root.children)
    );
}

/**
 * Runs the static rules into a list of hits, and returns the totals of the scene.
 *
 * @example
 * const hits = new Hits();
 * const { skeletons, scene } = staticRules(dump, hits);
 */
export function staticRules(dump: TreeDump, hits: Hits): { skeletons: number; scene: SceneTotals } {
    const { drawn, items, skeletons } = flatten(dump.root);
    const scene = totals(drawn);

    for (const seen of drawn) skeletonRules(seen, hits, { renderer: dump.renderer, drawn });
    scanOrder(items, dump.renderer?.maxBatchTextures ?? 16, hits);
    sceneRules(dump, drawn, scene, hits);

    return { skeletons, scene };
}

/**
 * Finds the causes of cost that one look at a tree dump shows. It needs no Pixi and no browser:
 * pass the JSON that `serializeTree` wrote. The rules that compare two moments need `watch`.
 *
 * @example
 * const { hits } = diagnoseTree(JSON.parse(pasted));
 * for (const hit of hits) console.log(hit.id, hit.node, hit.message, hit.docs);
 */
export function diagnoseTree(dump: TreeDump): Diagnosis {
    const hits = new Hits();
    const { skeletons, scene } = staticRules(dump, hits);

    return { skeletons, hits: hits.list(), scene };
}
