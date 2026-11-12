import type { Container } from 'pixi.js';
import type { ConstraintData } from '../model/constraints';
import type { PhysicsMode } from '../pose/engine';
import { type PerfEntry, plural, type ReportSource, slotNames } from './report-base';
import { cutRows } from './report-cuts';

/*
 * The rows of `perf.report()`. Every row is read from the state of the instance when the report
 * is asked for: the model, the pose, the counters of the view and what the view says about itself.
 */

/** The slot blend modes that need a blend state of their own. Indices into `BLEND_MODES`. */
const MULTIPLY = 2;
const SCREEN = 3;

const CONSTRAINT_KINDS: readonly ConstraintData['type'][] = ['ik', 'transform', 'path', 'physics', 'slider'];

const PHYSICS_REASONS: Readonly<Record<PhysicsMode, string>> = {
    update: 'every update advances the physics by the time that passed',
    none: 'mode none leaves the physics out: the bones keep the pose of the animations',
    pose: 'mode pose moves the bones to where the physics is and does not advance it',
    reset: 'mode reset starts the physics from the pose of the animations in every update',
};

/**
 * How many draw ranges the visible slots need. A range ends where the clip, the blend state or
 * the group of pages changes. The blend state and the pages can be left out, to see what each costs.
 */
function countRanges(source: ReportSource, blend: boolean, pages: boolean): number {
    const { blendModes } = source.model.slots;
    let ranges = 0;
    let last = '';

    for (const { slot, clip, pageGroup } of source.view.visible) {
        const mode = Number(blendModes[slot]);
        // normal and additive slots draw with one blend state
        const key = `${clip} ${blend && mode >= MULTIPLY ? mode : 0} ${pages ? pageGroup : 0}`;

        if (ranges === 0 || key !== last) ranges++;
        last = key;
    }

    return ranges;
}

/** Why a view should draw in a mode, as the reason of the row. */
function modeWhy({ option, reason, vertices, limit }: ReportSource['view']['mode']): string {
    const asked = `the option renderMode is "${option}"`;
    const count = `the skeleton has ${vertices} ${vertices === 1 ? 'vertex' : 'vertices'} in a batch`;

    if (reason === 'option') return asked;
    if (reason === 'small') return `${asked}: ${count}, which is at most ${limit}`;
    if (reason === 'large') return `${asked}: ${count}, which is more than ${limit}`;

    return `${asked}, and a batch of the renderer samples fewer textures than the skeleton has atlas pages`;
}

/** What a view does while it should draw with meshes and does not: the code of the mesh mode loads on demand. */
function waitingFor({ meshCode, drawn }: ReportSource['view']['mode']): string {
    const batch = drawn ? 'draws in a batch' : 'cannot draw in a batch: it draws nothing';

    if (meshCode === 'loaded') {
        return `The code of the mesh mode has loaded, and the skeleton changes over with its next update. Until then it ${batch}`;
    }
    if (meshCode === 'failed') {
        return `The code of the mesh mode did not load, so the skeleton ${drawn ? 'stays in a batch' : batch}`;
    }

    return `The code of the mesh mode is loading, and until it is there the skeleton ${batch}`;
}

function renderModeRow({ view }: ReportSource): PerfEntry {
    const { mode, wanted, drawn } = view.mode;
    const does =
        mode === 'batched'
            ? 'It shares draw calls with the skeletons next to it, and the CPU places its vertices'
            : 'It has draw calls of its own, and the GPU places its vertices';

    if (wanted !== mode) {
        return {
            feature: 'renderMode',
            value: drawn ? mode : `${mode}, nothing drawn`,
            reason: `${modeWhy(view.mode)}. ${waitingFor(view.mode)}`,
        };
    }

    return { feature: 'renderMode', value: mode, reason: `${modeWhy(view.mode)}. ${does}` };
}

/** The row that says how much of the skeleton moved, and whether the view had anything to do. */
function motionRow({ model, stats, view }: ReportSource): PerfEntry {
    const { skipped, bones, slots } = view.motion;
    const rested = `${plural(stats.skips, 'update')} of the view found nothing to do so far`;

    if (skipped) {
        return {
            feature: 'motion',
            value: 'at rest',
            reason: `the pose is the one the view drew last, so the last update placed no vertex and uploaded nothing. ${rested}`,
        };
    }

    return {
        feature: 'motion',
        value: `${bones} of ${model.bones.count} bones, ${slots} of ${model.slots.count} slots`,
        reason: `the pose engine marked them as changed for the last update. The view placed the vertices of ${stats.placedSlots} of ${plural(view.visible.length, 'visible slot')} and wrote the colors of ${stats.coloredSlots}. ${rested}`,
    };
}

/** How a container is named in a reason: by its label, else by its class. */
const labelOf = (container: Container): string => `"${container.label || container.constructor.name}"`;

/** The row about the containers of the user: the ones on a slot, the ones behind a bone, and what they cost. */
function linksRow({ model, stats, view, links, attachCode }: ReportSource): PerfEntry {
    const attached = links.filter((link) => link.slot >= 0);
    const following = links.filter((link) => link.slot < 0);
    const row = (reason: string): PerfEntry => ({
        feature: 'links',
        value: links.length === 0 ? 'none' : `${attached.length} attached, ${following.length} following`,
        reason,
    });

    if (links.length === 0) return row('no container is attached to a slot or follows a bone');
    const on = attached.map((link) => `${labelOf(link.container)} on slot "${model.slots.names[link.slot]}"`);
    const behind = following.map((link) => `${labelOf(link.container)} behind bone "${model.bones.names[link.bone]}"`);
    const free =
        following.length === 0 ? '' : `${behind.join(', ')}: a container that follows a bone costs no draw call`;

    if (attached.length === 0) return row(free);
    const names = `${on.join(', ')}. `;

    if (attachCode !== 'loaded') {
        const why =
            attachCode === 'failed'
                ? 'did not load. Check the network, and that the bundler wrote the chunks of pixi-marrow next to its entry and the server sends them'
                : 'is loading';

        return row(`${names}The attached containers are hidden: the chunk of pixi-marrow that draws them ${why}`);
    }
    const unit = view.mode.mode === 'batched' ? 'a batch' : 'a draw range';
    const cost = `Each one that is drawn ends ${unit} of the skeleton at its slot: the skeleton is ${plural(stats.drawCalls, 'draw call')} now, and each container adds its own`;

    return row(`${names}${cost}${free === '' ? '' : `. ${free}`}`);
}

/** The row about draw calls of a view that draws in batches. */
function batchRow({ stats, view }: ReportSource): PerfEntry {
    const { batches, sharedBy } = view.mode;
    const others = sharedBy - 1;
    let reason = 'Pixi has not built the instructions of the render group with the skeleton yet';

    // a skeleton that shows nothing is in no batch
    if (stats.drawCalls === 0) return { feature: 'drawCalls', value: '0', reason: 'no slot is visible' };
    if (batches === 1) {
        reason = `1 batch of the render group, shared with ${plural(others, 'other skeleton')}: the visible slots share one blend state and one group of pages`;
    } else if (batches > 1) {
        reason = `${batches} batches of the render group: a batch ends where the blend state or the group of 16 pages changes. The first one is shared with ${plural(others, 'other skeleton')}`;
    }

    return { feature: 'drawCalls', value: `${stats.drawCalls} shared`, reason };
}

function drawCallRow(source: ReportSource): PerfEntry {
    const { stats } = source;

    if (source.view.mode.mode === 'batched') return batchRow(source);
    const ranges = stats.drawCalls - stats.maskDraws;
    const masks = stats.maskDraws > 0 ? ` and ${plural(stats.maskDraws, 'mask draw')}` : '';
    let reason = 'no slot is visible';

    if (ranges === 1) reason = `1 draw range${masks}: the visible slots share one blend state and one group of pages`;
    else if (ranges > 1) {
        reason = `${ranges} draw ranges${masks}: a range ends where the blend state, the group of 8 pages or the clip changes`;
    }

    return { feature: 'drawCalls', value: String(stats.drawCalls), reason };
}

function blendRow(source: ReportSource): PerfEntry {
    const { model, view } = source;
    const using = (mode: number): number[] =>
        view.visible.filter(({ slot }) => model.slots.blendModes[slot] === mode).map(({ slot }) => slot);
    const multiply = using(MULTIPLY);
    const screen = using(SCREEN);
    const extra = countRanges(source, true, true) - countRanges(source, false, true);
    const value = extra > 0 ? plural(extra, 'extra range') : 'no extra range';

    if (multiply.length + screen.length === 0) {
        return { feature: 'blend', value, reason: 'no visible slot blends with multiply or screen' };
    }
    const parts: string[] = [];

    if (multiply.length > 0)
        parts.push(`${slotNames(model, multiply)} ${multiply.length === 1 ? 'uses' : 'use'} multiply`);
    if (screen.length > 0) parts.push(`${slotNames(model, screen)} ${screen.length === 1 ? 'uses' : 'use'} screen`);

    return { feature: 'blend', value, reason: parts.join(', ') };
}

function pagesRow(source: ReportSource): PerfEntry {
    const count = source.atlas.pages.length;
    const groups = new Set(source.view.visible.map(({ pageGroup }) => pageGroup)).size;
    const extra = countRanges(source, true, true) - countRanges(source, true, false);
    const batched = source.view.mode.mode === 'batched';
    const samples = batched ? 'a batch samples up to 16' : 'a draw range samples up to 8';
    const used = groups > 1 ? `, and the visible slots use ${groups} groups of ${batched ? 16 : 8}` : '';

    return {
        feature: 'pages',
        value: extra > 0 ? plural(extra, 'extra range') : 'no extra range',
        reason: `the atlas has ${plural(count, 'page')} and ${samples}${used}`,
    };
}

function clippingRow(source: ReportSource): PerfEntry {
    const { stats, model, view, info } = source;

    if (!info.features.includes('clipping')) {
        return { feature: 'clipping', value: 'off', reason: 'the skeleton has no clipping attachment' };
    }
    if (stats.clips === 0) {
        return { feature: 'clipping', value: 'off', reason: 'no clipping attachment is applied at the moment' };
    }
    const cutting = [...new Set(view.visible.filter(({ clip }) => clip >= 0).map(({ clip }) => clip))];

    if (view.mode.mode === 'batched') {
        const { clipVertices, clipIndices } = view.mode;

        return {
            feature: 'clipping',
            value: `${plural(stats.clips, 'clip')}, cut on the CPU`,
            reason:
                cutting.length === 0
                    ? 'no visible slot is cut'
                    : `the clipping attachment of ${slotNames(model, cutting)} cuts visible slots: their triangles are cut as the official runtime cuts them and stay in the batch, which keeps room for ${clipVertices} vertices and ${clipIndices} indices of cut triangles`,
        };
    }
    const reason =
        cutting.length === 0
            ? 'no visible slot is cut, so no mask is drawn'
            : `the clipping attachment of ${slotNames(model, cutting)} cuts visible slots: a mask is drawn twice and its slots get draw ranges of their own`;

    return {
        feature: 'clipping',
        value: `${plural(stats.clips, 'clip')}, ${plural(stats.maskDraws, 'mask draw')}`,
        reason,
    };
}

function darkTintRow({ model }: ReportSource): PerfEntry {
    const dark = model.slots.hasDark.includes(1);

    return {
        feature: 'darkTint',
        value: dark ? 'on' : 'off',
        reason: dark ? 'a slot has a dark color: every vertex carries 4 more bytes' : 'no slot has a dark color',
    };
}

function physicsRow({ model, physics, resetPending }: ReportSource): PerfEntry {
    const count = model.constraints.filter((constraint) => constraint.type === 'physics').length;

    if (count === 0) return { feature: 'physics', value: 'off', reason: 'the skeleton has no physics constraint' };

    return {
        feature: 'physics',
        value: `${plural(count, 'constraint')}, mode ${physics}`,
        reason: resetPending
            ? `the next update resets the physics, then mode ${physics} returns`
            : PHYSICS_REASONS[physics],
    };
}

function constraintsRow({ model }: ReportSource): PerfEntry {
    const kinds = CONSTRAINT_KINDS.map((kind) => ({
        kind,
        count: model.constraints.filter((constraint) => constraint.type === kind).length,
    })).filter(({ count }) => count > 0);

    if (kinds.length === 0) return { feature: 'constraints', value: 'none', reason: 'the skeleton has no constraint' };

    return {
        feature: 'constraints',
        value: kinds.map(({ kind, count }) => `${count} ${kind}`).join(', '),
        reason: 'every update solves the active ones in the order of the skeleton. A constraint is active with its bones, and with its skin when it needs one',
    };
}

function bonesRow({ model, state }: ReportSource): PerfEntry {
    const total = model.bones.count;
    const posed = state.active.reduce((sum, active) => sum + active, 0);

    return {
        feature: 'bones',
        value: `${posed} of ${total} posed`,
        reason:
            posed === total
                ? 'every bone is posed in an update that moves the skeleton'
                : `${plural(total - posed, 'bone')} need a skin that is not active`,
    };
}

function slotsRow({ model, view }: ReportSource): PerfEntry {
    const total = model.slots.count;
    const visible = view.visible.length;

    return {
        feature: 'slots',
        value: `${visible} of ${total} visible`,
        reason:
            visible === total
                ? 'every slot shows a region or a mesh'
                : 'the others show no region or mesh, are transparent or sit on a bone that is not posed',
    };
}

function verticesRow({ stats, view }: ReportSource): PerfEntry {
    const visible = view.visible.reduce((sum, slot) => sum + slot.vertices, 0);
    const bits = stats.vertices > 65535 ? 32 : 16;

    if (view.mode.mode === 'batched') {
        return {
            feature: 'vertices',
            value: `${stats.vertices} vertices, ${stats.indices} indices`,
            reason: `${visible} of the vertices are visible. The batch holds the largest attachment of every slot, ${view.mode.batchBytes} bytes for this skeleton`,
        };
    }

    return {
        feature: 'vertices',
        value: `${stats.vertices} vertices, ${stats.indices} indices`,
        reason: `${visible} of the vertices are visible. The buffers hold every attachment the slots can show with the skin, with ${bits}-bit indices`,
    };
}

function uploadsRow({ stats }: ReportSource): PerfEntry {
    const updates = stats.positionUploads;
    const rate = (uploads: number): number => Math.round((uploads / updates) * 100) / 100;

    if (updates === 0) return { feature: 'uploads', value: 'none', reason: 'no update has drawn a slot' };
    const masks = stats.maskUploads > 0 ? `, ${plural(stats.maskUploads, 'mask upload')}` : '';

    return {
        feature: 'uploads',
        value: `1 position, ${rate(stats.colorUploads)} color, ${rate(stats.uvUploads)} uv per update`,
        reason: `${stats.positionUploads} position, ${stats.colorUploads} color and ${stats.uvUploads} uv uploads in ${plural(updates, 'update')} that drew, ${plural(stats.indexRebuilds, 'rewrite')} of the index buffers${masks}`,
    };
}

function layoutRow({ stats }: ReportSource): PerfEntry {
    return {
        feature: 'layout',
        value: plural(stats.templateBuilds, 'layout'),
        reason: 'the vertex ranges are laid out once, and again when the skin, the outlines or a page texture changes',
    };
}

/**
 * The rows of the perf report of one instance, in a fixed order.
 *
 * @example
 * const rows = buildReport(source);
 * console.log(rows.find((row) => row.feature === 'drawCalls')?.value);
 */
export function buildReport(source: ReportSource): PerfEntry[] {
    return [
        renderModeRow(source),
        motionRow(source),
        linksRow(source),
        drawCallRow(source),
        blendRow(source),
        pagesRow(source),
        clippingRow(source),
        ...cutRows(source),
        darkTintRow(source),
        physicsRow(source),
        constraintsRow(source),
        bonesRow(source),
        slotsRow(source),
        verticesRow(source),
        uploadsRow(source),
        layoutRow(source),
    ];
}
