import { PHONE_ROW, PHONE_WIDTH, phoneSize } from './layout';
import type { Pose } from './mixing';
import { svgElement } from './runtime';

/*
 * The shapes the diagrams draw: lanes with a square that shows a pose, and a time line with a
 * bar per animation and a line at the time that shows. A lane is a small stage of its own, and the
 * square on it leaves a short trail, so that a still frame shows which way it moves.
 */

/** The colors of the diagrams: the first track or animation, the second one, and their result. */
export const COLORS = { first: '#5fa8ff', second: '#ff8a4c', result: '#f2f2f2', line: '#4a4a55', text: '#b4b4bf' };

/** The side of the square in the setup pose. */
const SIDE = 34;

/** How many frames back each ghost of the trail stands, and how strongly it shows. */
const TRAIL = [
    { back: 5, opacity: 0.3 },
    { back: 10, opacity: 0.17 },
    { back: 15, opacity: 0.08 },
] as const;

/** A lane: a name, a mark where the setup pose stands, and a square that shows a pose. */
interface Lane {
    show(pose: Pose): void;
}

/** Where a lane stands and what it shows. */
interface LaneOptions {
    x: number;
    y: number;
    label: string;
    color: string;
    /** True for a solid square, false for an outline. */
    solid: boolean;
    /** The size of the stage under the label: 200 by 136 unless given. */
    width?: number;
    height?: number;
}

/**
 * Draws a lane. The setup pose stands at its left, x grows to the right and y grows upward.
 *
 * @example
 * const result = lane(svg, { x: 20, y: 40, label: 'Result', color: COLORS.result, solid: true });
 * result.show({ x: 60, y: 0, scale: 1.2 });
 */
function lane(svg: SVGSVGElement, options: LaneOptions): Lane {
    const { x, y, label, color, solid, width = 200, height = 136 } = options;
    const baseX = x + SIDE;
    const baseY = y + height - 16;
    const paint = (shape: SVGRectElement, opacity: number): void => {
        if (solid) {
            shape.setAttribute('fill', color);
            shape.setAttribute('fill-opacity', String(opacity));
        } else {
            shape.setAttribute('fill', 'none');
            shape.setAttribute('stroke', color);
            shape.setAttribute('stroke-width', '2.5');
            shape.setAttribute('stroke-opacity', String(opacity));
        }
    };

    svgElement('circle', { cx: x + 5, cy: y + 9.5, r: 4.5, fill: color }, svg);
    svgElement(
        'text',
        { x: x + 16, y: y + 14, fill: '#dcdce4', 'font-size': 13, 'font-weight': 500 },
        svg,
    ).textContent = label;
    svgElement(
        'rect',
        {
            x,
            y: y + 24,
            width,
            height,
            rx: 8,
            fill: '#ffffff',
            'fill-opacity': 0.025,
            stroke: '#ffffff',
            'stroke-opacity': 0.06,
        },
        svg,
    );
    svgElement(
        'line',
        {
            x1: x + 8,
            y1: baseY + SIDE / 2 + 6,
            x2: x + width - 8,
            y2: baseY + SIDE / 2 + 6,
            stroke: COLORS.line,
            'stroke-width': 1,
        },
        svg,
    );
    // the setup pose, where the square stands when nothing moves it
    svgElement(
        'rect',
        {
            x: baseX - SIDE / 2,
            y: baseY - SIDE / 2,
            width: SIDE,
            height: SIDE,
            rx: 4,
            fill: 'none',
            stroke: '#6a6a76',
            'stroke-dasharray': '3 3',
        },
        svg,
    );
    const ghosts = TRAIL.map((ghost) => {
        const shape = svgElement('rect', { x: -SIDE / 2, y: -SIDE / 2, width: SIDE, height: SIDE, rx: 4 }, svg);

        paint(shape, ghost.opacity);

        return shape;
    });
    const square = svgElement('rect', { x: -SIDE / 2, y: -SIDE / 2, width: SIDE, height: SIDE, rx: 4 }, svg);
    const past: string[] = [];

    paint(square, 1);

    return {
        show(pose) {
            const place = `translate(${baseX + pose.x} ${baseY - pose.y}) scale(${pose.scale})`;

            square.setAttribute('transform', place);
            past.unshift(place);
            past.length = Math.min(past.length, (TRAIL.at(-1)?.back ?? 0) + 1);
            for (const [index, ghost] of TRAIL.entries()) {
                ghosts[index]?.setAttribute('transform', past[Math.min(ghost.back, past.length - 1)] ?? place);
            }
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
    svgElement(
        'rect',
        { x: x - 6, y: y - 6, width: width + 12, height: 38, rx: 6, fill: '#ffffff', 'fill-opacity': 0.03 },
        svg,
    );
    const group = svgElement('g', {}, svg);
    const head = svgElement('line', { y1: y - 10, y2: y + 34, stroke: COLORS.result, 'stroke-width': 2 }, svg);
    const xOf = (time: number): number => x + (time / seconds) * width;

    for (let second = 0; second <= seconds; second++) {
        svgElement(
            'text',
            {
                x: xOf(second),
                y: y + 50,
                fill: COLORS.text,
                'font-size': 12,
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
                        height: 12,
                        rx: 2,
                        fill: bar.color,
                        opacity: 0.85,
                    },
                    group,
                );
                if (bar.mixIn !== undefined && bar.mixIn > 0) {
                    const left = xOf(bar.from);
                    const band = xOf(bar.from + bar.mixIn) - left;

                    svgElement(
                        'rect',
                        { x: left, y: y - 3, width: band, height: 31, fill: COLORS.result, opacity: 0.16 },
                        group,
                    );
                    svgElement(
                        'line',
                        {
                            x1: left,
                            y1: y + 28,
                            x2: left + band,
                            y2: y - 3,
                            stroke: COLORS.result,
                            'stroke-opacity': 0.5,
                            'stroke-width': 1,
                        },
                        group,
                    );
                }
                svgElement(
                    'text',
                    {
                        x: xOf(bar.from) + 4,
                        y: top + 9.5,
                        fill: '#111113',
                        'font-size': 10.5,
                        'font-weight': 600,
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

/** What a lane of a row shows: its place comes from the row. */
type LaneSpec = Omit<LaneOptions, 'x' | 'y' | 'width' | 'height'>;

/** A row of lanes, one per spec, and the way to draw a time line under them. */
export interface Lanes<T extends readonly LaneSpec[]> {
    lanes: { [K in keyof T]: Lane };
    /** Draws a time line of `seconds` seconds under the lanes. */
    timeline(seconds: number): Timeline;
}

/**
 * Draws lanes side by side, or one under the other when `narrow` is true. The narrow drawing
 * takes the size `phoneSize` gives, which `Diagram` reserves on a phone.
 *
 * @example
 * const { lanes: [first, second], timeline: line } = lanes(svg, [a, b], narrow, true);
 */
export function lanes<const T extends readonly LaneSpec[]>(
    svg: SVGSVGElement,
    specs: T,
    narrow: boolean,
    withTimeline: boolean,
): Lanes<T> {
    if (narrow) {
        const [width, height] = phoneSize(specs.length, withTimeline);

        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    const made = specs.map((spec, index) =>
        narrow
            ? lane(svg, { ...spec, x: 20, y: 10 + index * PHONE_ROW, width: PHONE_WIDTH - 40, height: 120 })
            : lane(svg, { ...spec, x: 20 + index * 240, y: 10 }),
    );

    return {
        lanes: made as { [K in keyof T]: Lane },
        timeline: (seconds) =>
            narrow
                ? timeline(svg, 20, 24 + specs.length * PHONE_ROW, PHONE_WIDTH - 40, seconds)
                : timeline(svg, 20, 200, 680, seconds),
    };
}
