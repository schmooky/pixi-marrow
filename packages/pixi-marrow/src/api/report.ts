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
 * the group of 8 pages changes. The blend state and the pages can be left out, to see what each costs.
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

function drawCallRow({ stats }: ReportSource): PerfEntry {
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
    const used = groups > 1 ? `, and the visible slots use ${groups} groups of 8` : '';

    return {
        feature: 'pages',
        value: extra > 0 ? plural(extra, 'extra range') : 'no extra range',
        reason: `the atlas has ${plural(count, 'page')} and a draw range samples up to 8${used}`,
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
                ? 'every bone is posed in every update'
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
