import type { PageBlock } from '../render/cuts';
import type { OutlinesState } from './asset';
import { type PerfEntry, plural, type ReportSource, slotNames } from './report-base';

/*
 * The rows of the perf report about the cuts of overdraw: polygons in place of quads, slots
 * that an opaque slot covers, and the outlines both need.
 */

const PAGE_BLOCKS: Readonly<Record<PageBlock, string>> = {
    size: 'its texture has another pixel size than the atlas states',
    mipmaps: 'its texture has mipmaps',
    anisotropy: 'its texture is filtered anisotropically',
    repeat: 'its texture repeats and the atlas page does not',
    premultiplied: 'its texture holds a premultiplied image and the atlas page is straight',
};

const OUTLINES: Readonly<Record<OutlinesState, string>> = {
    given: 'the load got them, as a file or as an object',
    scanned: 'read from the page images after the load',
    scanning: 'the page images are being read in idle time',
    unread: 'the scan could read no page image, so every region keeps its quad',
    off: 'the asset was loaded with outlines "off"',
};

/** Why the view has no outlines to cut with. */
const NO_OUTLINES: Readonly<Record<OutlinesState, string>> = {
    given: 'the view takes the outlines of the asset with its next update',
    scanned: 'the view takes the outlines of the asset with its next update',
    scanning: 'the page images are still being read for outlines',
    unread: 'the scan could read no page image',
    off: OUTLINES.off,
};

const MARGIN = 'is below the 0.5 pixels that bilinear filtering needs';

/** The pages whose regions keep their quads, each with what its texture does. Empty when no page does. */
function pageNotes({ atlas, view }: ReportSource): string {
    const notes = view.cuts.pages.flatMap((block, index) =>
        block === null ? [] : [`page "${atlas.pages[index]?.name}" keeps its quads: ${PAGE_BLOCKS[block]}`],
    );

    return notes.length === 0 ? '' : `. ${notes.join('. ')}`;
}

/** Why both cuts are off for the view, or null when they can run. */
function cutsOff({ view, outlinesState }: ReportSource): string | null {
    const { cuts } = view;

    if (!cuts.outlines) return NO_OUTLINES[outlinesState];
    if (!cuts.hostile) return null;
    const stays = 'Both cuts stay off for this instance';

    if (cuts.bend === 'roundPixels') return `the renderer rounds positions to pixels (roundPixels). ${stays}`;
    if (cuts.bend === 'multisample') return `the skeleton was drawn to a multisampled target. ${stays}`;

    return `a draw moved edges inside a pixel. ${stays}`;
}

function tightMeshRow(source: ReportSource): PerfEntry {
    const { cuts, visible } = source.view;
    const off = (reason: string): PerfEntry => ({ feature: 'tightMesh', value: 'off', reason });

    if (cuts.tightMesh === 'off') return off('the option tightMesh is "off": every region is a quad');
    const blocked = cutsOff(source);

    if (blocked !== null) return off(blocked);
    const hollow = visible.filter(({ shape }) => shape === 'hollow').length;
    const polygons = visible.filter(({ shape }) => shape === 'polygon').length;
    const regions = visible.filter(({ shape }) => shape !== 'mesh').length;
    const verb = hollow === 1 ? 'has' : 'have';
    const skipped =
        hollow === 0 ? '' : `. ${plural(hollow, 'visible region')} without a visible pixel ${verb} no vertex`;

    if (cuts.tightMesh === 'auto') {
        return {
            feature: 'tightMesh',
            value: 'auto',
            reason: `the option tightMesh is "auto": regions keep their quads${skipped}${pageNotes(source)}`,
        };
    }
    if (!cuts.polygonMargin) return off(`the margin of the outlines ${MARGIN}`);

    return {
        feature: 'tightMesh',
        value: 'on',
        reason: `${polygons} of ${plural(regions, 'visible region')} are polygons${skipped}${pageNotes(source)}`,
    };
}

function occlusionRow(source: ReportSource): PerfEntry {
    const { model, view } = source;
    const { cuts } = view;
    const row = (value: string, reason: string): PerfEntry => ({ feature: 'occlusion', value, reason });

    if (cuts.occlusion === 'off') return row('off', 'the option occlusion is "off": every slot is drawn');
    const blocked = cutsOff(source);

    if (blocked !== null) return row('off', blocked);
    if (!cuts.opaqueMargin) return row('off', `the margin of the opaque rectangles ${MARGIN}`);
    const none = '0 covered slots';

    if (view.opaqueRects === 0) {
        return row(none, `no attachment of the layout has an opaque rectangle${pageNotes(source)}`);
    }
    if (!view.plain) {
        return row(
            none,
            'an ancestor has an alpha below 1 or a blend mode of its own, so an opaque slot shows what is behind it',
        );
    }
    const covered = view.visible.filter((slot) => slot.covered).map(({ slot }) => slot);
    const rects = plural(view.opaqueRects, 'opaque rectangle');

    if (covered.length === 0) {
        return row(
            none,
            `the test found no visible slot behind the opaque part of a later slot. The layout has ${rects}`,
        );
    }

    const verbs = covered.length === 1 ? ['lies', 'adds'] : ['lie', 'add'];

    return row(
        plural(covered.length, 'covered slot'),
        `${slotNames(model, covered)} ${verbs[0]} behind the opaque part of a later slot and ${verbs[1]} no index. The layout has ${rects}`,
    );
}

function outlinesRow(source: ReportSource): PerfEntry {
    const { outlines, outlinesState } = source;
    let reason = OUTLINES[outlinesState];

    if (outlines !== undefined) {
        const found = outlines.regions.filter((region) => region !== null).length;

        reason += `: ${found} of ${plural(outlines.regions.length, 'region')} have an outline`;
    } else if (outlinesState === 'unread') reason += pageNotes(source);

    return { feature: 'outlines', value: outlinesState, reason };
}

/**
 * The rows about the cuts of overdraw: `tightMesh`, `occlusion` and `outlines`.
 *
 * @example
 * const [tightMesh, occlusion, outlines] = cutRows(source);
 * console.log(tightMesh?.value, occlusion?.value, outlines?.value);
 */
export function cutRows(source: ReportSource): PerfEntry[] {
    return [tightMeshRow(source), occlusionRow(source), outlinesRow(source)];
}
