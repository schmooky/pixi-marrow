import type { Pose } from './mixing';
import { svgElement } from './runtime';

/*
 * The shapes the diagrams draw: lanes with a square that shows a pose, and a time line with a
 * bar per animation and a line at the time that shows.
 */

/** The colors of the diagrams: the first track or animation, the second one, and their result. */
export const COLORS = { first: '#5fa8ff', second: '#ff8a4c', result: '#f2f2f2', line: '#3a3a42', text: '#a0a0ab' };

/** The side of the square in the setup pose. */
const SIDE = 34;

/** A lane: a name, a mark where the setup pose stands, and a square that shows a pose. */
export interface Lane {
    show(pose: Pose): void;
}

/** Where a lane stands and what it shows. */
export interface LaneOptions {
    x: number;
    y: number;
    label: string;
    color: string;
    /** True for a solid square, false for an outline. */
    solid: boolean;
}

/**
 * Draws a lane. The setup pose stands at its left, x grows to the right and y grows upward.
 *
 * @example
 * const result = lane(svg, { x: 20, y: 40, label: 'Result', color: COLORS.result, solid: true });
 * result.show({ x: 60, y: 0, scale: 1.2 });
 */
export function lane(svg: SVGSVGElement, options: LaneOptions): Lane {
    const { x, y, label, color, solid } = options;
    const baseX = x + SIDE;
    const baseY = y + 120;

    svgElement(
        'text',
        { x, y: y + 14, fill: COLORS.text, 'font-size': 13, 'font-family': 'ui-sans-serif, system-ui' },
        svg,
    ).textContent = label;
    svgElement(
        'line',
        {
            x1: x,
            y1: baseY + SIDE / 2 + 6,
            x2: x + 200,
            y2: baseY + SIDE / 2 + 6,
            stroke: COLORS.line,
            'stroke-width': 1,
        },
        svg,
    );
    svgElement(
        'rect',
        {
            x: baseX - SIDE / 2,
            y: baseY - SIDE / 2,
            width: SIDE,
            height: SIDE,
            rx: 4,
            fill: 'none',
            stroke: COLORS.line,
            'stroke-dasharray': '3 3',
        },
        svg,
    );
    const square = svgElement('rect', { x: -SIDE / 2, y: -SIDE / 2, width: SIDE, height: SIDE, rx: 4 }, svg);

    if (solid) square.setAttribute('fill', color);
    else {
        square.setAttribute('fill', 'none');
        square.setAttribute('stroke', color);
        square.setAttribute('stroke-width', '2.5');
    }

    return {
        show(pose) {
            square.setAttribute('transform', `translate(${baseX + pose.x} ${baseY - pose.y}) scale(${pose.scale})`);
        },
    };
}

/** A bar of a time line: when an animation plays, and where a mix into it runs. */
interface Bar {
    from: number;
    to: number;
    color: string;
    label: string;
    /** Seconds from `from` during which the animation mixes in. */
    mixIn?: number;
}

/** A time line: bars over a span of seconds, and a line at the time that shows. */
export interface Timeline {
    draw(bars: readonly Bar[]): void;
    show(time: number): void;
}

/**
 * Draws a time line over `seconds` seconds, `width` wide.
 *
 * @example
 * const line = timeline(svg, 20, 200, 680, 4);
 * line.draw([{ from: 0, to: 2, color: COLORS.first, label: 'A' }]);
 */
export function timeline(svg: SVGSVGElement, x: number, y: number, width: number, seconds: number): Timeline {
    const group = svgElement('g', {}, svg);
    const head = svgElement('line', { y1: y - 6, y2: y + 30, stroke: COLORS.result, 'stroke-width': 1.5 }, svg);
    const xOf = (time: number): number => x + (time / seconds) * width;

    for (let second = 0; second <= seconds; second++) {
        svgElement(
            'text',
            {
                x: xOf(second),
                y: y + 44,
                fill: COLORS.text,
                'font-size': 11,
                'text-anchor': 'middle',
                'font-family': 'ui-monospace, monospace',
            },
            svg,
        ).textContent = `${second} s`;
    }

    return {
        draw(bars) {
            group.replaceChildren();
            for (const [index, bar] of bars.entries()) {
                const top = y + (index % 2) * 13;

                svgElement(
                    'rect',
                    {
                        x: xOf(bar.from),
                        y: top,
                        width: xOf(bar.to) - xOf(bar.from),
                        height: 11,
                        rx: 2,
                        fill: bar.color,
                        opacity: 0.75,
                    },
                    group,
                );
                if (bar.mixIn !== undefined && bar.mixIn > 0) {
                    svgElement(
                        'rect',
                        {
                            x: xOf(bar.from),
                            y: y - 3,
                            width: xOf(bar.from + bar.mixIn) - xOf(bar.from),
                            height: 30,
                            fill: COLORS.result,
                            opacity: 0.12,
                        },
                        group,
                    );
                }
                svgElement(
                    'text',
                    {
                        x: xOf(bar.from) + 4,
                        y: top + 9,
                        fill: '#111113',
                        'font-size': 9,
                        'font-family': 'ui-monospace, monospace',
                    },
                    group,
                ).textContent = bar.label;
            }
        },
        show(time) {
            head.setAttribute('x1', String(xOf(time)));
            head.setAttribute('x2', String(xOf(time)));
        },
    };
}
