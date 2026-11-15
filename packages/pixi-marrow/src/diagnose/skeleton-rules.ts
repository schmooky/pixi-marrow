import { counted, type Hits, type Seen } from './hits';
import type { RendererInfo, TreeNode } from './types';

/*
 * The static rules about one skeleton: what its own data and the display objects above it say.
 * Each function looks for one cause and adds a hit when it finds it.
 */

/** The pages one draw samples: a batch, and a draw range of the mesh mode. */
const BATCH_PAGES = 16;
const MESH_PAGES = 8;
/** How many instances of an asset in the mesh mode make MARROW009 hit. */
const MANY = 4;

/** What a rule about one skeleton reads besides the skeleton. */
export interface RuleScene {
    renderer: RendererInfo | null;
    /** Every skeleton of the tree that Pixi draws. */
    drawn: readonly Seen[];
}

const plainBlend = (node: TreeNode): boolean => node.blendMode === 'normal' || node.blendMode === 'inherit';
/** The skeleton and the display objects above it, nearest first. */
const chain = (seen: Seen): TreeNode[] => [seen.node, ...[...seen.above].reverse()];
/** The path of a display object as the cause of a hit: empty for the skeleton itself. */
const causeOf = (seen: Seen, node: TreeNode): string => (node === seen.node ? '' : node.path);
const hasOutlines = ({ marrow }: Seen): boolean => marrow.cuts.outlines !== 'off' && marrow.cuts.outlines !== 'unread';
/** What tells the hit of one asset from the hit of another. */
const assetGroup = ({ marrow }: Seen): string => `asset ${marrow.asset.id}`;

function alphaOrBlend(seen: Seen, hits: Hits): void {
    const { marrow } = seen;
    const cut = hasOutlines(seen) && marrow.cuts.occlusion === 'auto';
    const node = chain(seen).find((at) => at.alpha !== 1 || !plainBlend(at));

    if (node === undefined || !(cut || marrow.idle.setting === 'auto')) return;
    const what = node.alpha !== 1 ? `an alpha of ${node.alpha}` : `the blend mode ${node.blendMode}`;

    hits.add(
        'MARROW003',
        seen.node.path,
        causeOf(seen, node),
        { alpha: node.alpha },
        `"${node.path}" has ${what}, so no slot is left out as covered and the idle cache keeps no image.`,
    );
}

function blendRuns(seen: Seen, hits: Hits): void {
    const { blendSlots, runs } = seen.marrow.render;
    const node = chain(seen).find((at) => !plainBlend(at));

    if (blendSlots > 0) {
        hits.add(
            'MARROW006',
            seen.node.path,
            '',
            { blendSlots, runs },
            `${counted(blendSlots, 'visible slot')} multiply or screen, and each starts a draw of its own.`,
            assetGroup(seen),
        );
    }
    if (node !== undefined) {
        hits.add(
            'MARROW006',
            seen.node.path,
            causeOf(seen, node),
            { runs },
            `"${node.path}" has the blend mode ${node.blendMode}, so the skeleton shares no batch with a neighbour that blends normally.`,
        );
    }
}

function ownPages(seen: Seen, hits: Hits): void {
    const { counts, render } = seen.marrow;
    const limit = render.mode === 'batched' ? BATCH_PAGES : MESH_PAGES;

    if (counts.atlasPages <= limit) return;
    hits.add(
        'MARROW007',
        seen.node.path,
        '',
        { pages: counts.atlasPages, limit },
        `The atlas has ${counts.atlasPages} pages, and one draw of the ${render.mode} mode samples ${limit}.`,
        assetGroup(seen),
    );
}

function refused(seen: Seen, hits: Hits): void {
    const { render, counts } = seen.marrow;

    if (render.modeReason !== 'limit') return;
    hits.add(
        'MARROW008',
        seen.node.path,
        '',
        { pages: counts.atlasPages },
        `The renderer samples fewer textures in a batch than the ${counts.atlasPages} atlas pages need, so the skeleton draws with meshes of its own.`,
        assetGroup(seen),
    );
}

function manyLarge(seen: Seen, hits: Hits, scene: RuleScene): void {
    const { render, asset } = seen.marrow;
    const alike = scene.drawn.filter(
        ({ marrow }) =>
            marrow.asset.id === asset.id && marrow.render.mode === 'mesh' && !marrow.render.instancing.active,
    );

    if (render.mode !== 'mesh' || render.instancing.active || alike.length < MANY) return;
    hits.add(
        'MARROW009',
        seen.node.path,
        '',
        { instances: alike.length, batchVertices: render.batchVertices, drawCalls: render.drawCalls },
        `${alike.length} instances of this skeleton draw in the mesh mode with ${counted(render.drawCalls, 'draw call')} each. Instancing is off for the reason "${render.instancing.why}".`,
        assetGroup(seen),
    );
}

function clips(seen: Seen, hits: Hits): void {
    const { mode, clips: applied, maskDraws } = seen.marrow.render;

    if (applied === 0) return;
    if (mode === 'batched') {
        hits.add(
            'MARROW010',
            seen.node.path,
            '',
            { clips: applied },
            `The skeleton applies ${counted(applied, 'clipping attachment')}, and the CPU cuts the triangles of the clipped slots.`,
            assetGroup(seen),
        );
    } else if (maskDraws > 0) {
        hits.add(
            'MARROW011',
            seen.node.path,
            '',
            { clips: applied, maskDraws },
            `${counted(applied, 'clipping attachment')} of the skeleton add ${counted(maskDraws, 'mask draw')}, and the skeleton cannot draw instanced.`,
            assetGroup(seen),
        );
    }
}

function attached(seen: Seen, hits: Hits): void {
    const count = seen.marrow.render.attached;

    if (count === 0) return;
    hits.add(
        'MARROW012',
        seen.node.path,
        '',
        { attached: count, drawCalls: seen.marrow.render.drawCalls },
        `The skeleton has ${counted(count, 'container')} attached to a slot. Each ends a draw of the skeleton at its slot and adds its own draws.`,
    );
}

function offScreen(seen: Seen, hits: Hits): void {
    const { pacing } = seen.marrow;

    if (pacing.onScreen !== false || pacing.offscreen !== 'update') return;
    hits.add(
        'MARROW015',
        seen.node.path,
        '',
        {},
        'The skeleton is off the screen and offscreen is "update", so it poses in every frame.',
    );
}

function edgeBend(seen: Seen, hits: Hits, { renderer }: RuleScene): void {
    const { blockedBy } = seen.marrow.cuts;
    const found = blockedBy.find(
        (block) => block === 'roundPixels' || block === 'multisample' || block === 'edge-bend',
    );
    let bend = found;

    if (!hasOutlines(seen)) return;
    if (bend === undefined && renderer?.roundPixels === true) bend = 'roundPixels';
    if (bend === undefined && renderer?.antialias === true) bend = 'multisample';
    if (bend === undefined) return;
    hits.add(
        'MARROW016',
        seen.node.path,
        '',
        { blocked: found === undefined ? 0 : 1 },
        `The renderer moves edges inside a pixel (${bend}), so occlusion and tightMesh are off for this instance.`,
        'renderer',
    );
}

function filterOrMask(seen: Seen, hits: Hits): void {
    const node = chain(seen).find((at) => at.filters > 0 || at.mask);

    if (node === undefined) return;
    hits.add(
        'MARROW017',
        seen.node.path,
        causeOf(seen, node),
        { filters: node.filters, mask: node.mask ? 1 : 0 },
        `"${node.path}" has ${node.filters > 0 ? 'a filter' : 'a mask'}, so the batch ends there and the idle cache keeps no image.`,
    );
}

function cached(seen: Seen, hits: Hits): void {
    const node = chain(seen).find((at) => at.cacheAsTexture);

    if (node === undefined) return;
    hits.add(
        'MARROW018',
        seen.node.path,
        causeOf(seen, node),
        {},
        `"${node.path}" is cached as a texture, so Pixi shows the skeleton as it was at the last updateCacheTexture() call.`,
    );
}

function outlines(seen: Seen, hits: Hits): void {
    const { cuts } = seen.marrow;

    if (hasOutlines(seen)) {
        if (cuts.pageBlocks.length === 0) return;
        hits.add(
            'MARROW021',
            seen.node.path,
            '',
            { pages: cuts.pageBlocks.length },
            `The regions of ${counted(cuts.pageBlocks.length, 'page')} keep their quads (${cuts.pageBlocks.join(', ')}).`,
            assetGroup(seen),
        );

        return;
    }
    hits.add(
        'MARROW020',
        seen.node.path,
        '',
        {},
        `The outlines of the asset are "${cuts.outlines}", so the runtime leaves out no covered slot and no empty region.`,
        assetGroup(seen),
    );
}

function physics(seen: Seen, hits: Hits): void {
    const { physics: state, pacing } = seen.marrow;

    if (state.constraints === 0 || state.mode !== 'update' || pacing.reduced) return;
    hits.add(
        'MARROW022',
        seen.node.path,
        '',
        { constraints: state.constraints },
        `The skeleton simulates ${counted(state.constraints, 'physics constraint')} in every update until the simulation comes to rest.`,
        assetGroup(seen),
    );
}

/**
 * Runs every static rule about one skeleton that Pixi draws.
 *
 * @example
 * for (const seen of drawn) skeletonRules(seen, hits, { renderer: dump.renderer, drawn });
 */
export function skeletonRules(seen: Seen, hits: Hits, scene: RuleScene): void {
    alphaOrBlend(seen, hits);
    blendRuns(seen, hits);
    ownPages(seen, hits);
    refused(seen, hits);
    manyLarge(seen, hits, scene);
    clips(seen, hits);
    attached(seen, hits);
    offScreen(seen, hits);
    edgeBend(seen, hits, scene);
    filterOrMask(seen, hits);
    cached(seen, hits);
    outlines(seen, hits);
    physics(seen, hits);
}
