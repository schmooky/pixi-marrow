import { type PerfEntry, plural, type ReportSource } from './report-base';

/*
 * The rows of `perf.report()` about instanced draws: whether the instance draws instanced, in a
 * run of how many and in how many draw calls, or why it draws alone. They are read from the view
 * when the report is asked for. The run and its draws are those of the last frame Pixi drew.
 */

/** Why a view draws alone, by the reason the view gives, as the reason of the row. */
function alone(source: ReportSource): string {
    const { why } = source.view.instancing;

    if (why === 'batched') return 'the skeleton draws in a batch, and instancing acts on the mesh mode alone';
    if (why === 'off') return 'the option instancing is "off"';
    if (why === 'cpu') {
        return `the option skinning is "${source.perf.skinning}": the CPU places the vertices, and an instanced draw needs the vertex shader to place them`;
    }
    if (why === 'blend') {
        return 'a slot of the skin multiplies or screens, so the skeleton needs more than one draw range. One instanced draw per range would draw the ranges of the next instance before the last range of this one';
    }
    if (why === 'pages') return 'the atlas has more than 8 pages, which one draw cannot sample';
    if (why === 'size') return 'the layout has more attachments than an instanced draw can tell apart';
    if (why === 'clip') {
        return 'a clipping attachment cuts a visible slot, which takes a stencil mask. It draws alone while that lasts';
    }
    if (why === 'attached') return 'a container attached to a slot is drawn between its slots';

    return 'a mesh deforms that the pool of the layout keeps no texels for, so the CPU places it for a view that draws alone';
}

/**
 * The row of instanced draws.
 *
 * @example
 * const row = instancingRow(source);
 * console.log(row.value); // 'on, run of 200, 1 draw call'
 */
export function instancingRow(source: ReportSource): PerfEntry {
    const { why, run, draws, drawnWith, unionVertices, slotBytes } = source.view.instancing;
    const visible = source.view.visible.reduce((sum, slot) => sum + slot.vertices, 0);

    if (why !== null) return { feature: 'instancing', value: 'off', reason: alone(source) };
    const shading = `The vertex shader runs all ${unionVertices} vertices of the layout per instance, ${visible} of them visible, and the slot of the instance in the pool of its layout takes ${slotBytes} bytes`;

    if (run === 0) {
        return {
            feature: 'instancing',
            value: 'on',
            reason: `Pixi has not built the instructions of the render group with the skeleton yet. ${shading}`,
        };
    }
    const own =
        drawnWith > 0 ? `Its own draw holds ${plural(drawnWith, 'instance')}` : 'It drew nothing in the last frame';
    const runs =
        run === 1
            ? 'no instance next to it in the render order draws instanced: Pixi draws something else before and after it'
            : `${run} instances follow each other in the render order. Instances with another layout, draw order or blend mode start another draw`;

    return {
        feature: 'instancing',
        value: run === 1 ? 'on, alone' : `on, run of ${run}, ${plural(draws, 'draw call')}`,
        reason: `${runs}. ${own}. ${shading}`,
    };
}

/**
 * The row of draw calls of a view that draws instanced: it shares the draw of its run.
 *
 * @example
 * const row = instancedDrawRow(source);
 * console.log(row.value); // '1 shared'
 */
export function instancedDrawRow(source: ReportSource): PerfEntry {
    const { drawnWith } = source.view.instancing;

    if (source.stats.drawCalls === 0) return { feature: 'drawCalls', value: '0', reason: 'no slot is visible' };

    return {
        feature: 'drawCalls',
        value: '1 shared',
        reason: `1 instanced draw, shared with ${plural(Math.max(drawnWith - 1, 0), 'other instance')}. See the row instancing`,
    };
}
