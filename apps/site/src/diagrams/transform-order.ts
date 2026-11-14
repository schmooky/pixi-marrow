import { createTimeline } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * A transform in three steps. A square starts at the origin. It is scaled, then turned, then
 * moved. Each step works on the result of the one before, and the grey outline keeps where the
 * square was. The three steps together are one transform, which the GPU applies to every
 * vertex as one small matrix.
 */

const ORIGIN: [number, number] = [120, 170];
const STEPS = [
    { name: 'start', scale: 1, turn: 0, x: 0, y: 0, says: 'a square of 60 at the origin' },
    {
        name: 'scale 1.5',
        scale: 1.5,
        turn: 0,
        x: 0,
        y: 0,
        says: 'scaled: every corner is 1.5 times as far from the origin',
    },
    {
        name: 'turn 30',
        scale: 1.5,
        turn: 30,
        x: 0,
        y: 0,
        says: 'turned 30 degrees around the origin, clockwise as in Pixi',
    },
    {
        name: 'move 300, -40',
        scale: 1.5,
        turn: 30,
        x: 300,
        y: -40,
        says: 'moved 300 right and 40 up, since y grows down: every corner shifts alike',
    },
] as const;

export default defineDiagram({
    setup({ svg, own, say }) {
        svgElement('line', { x1: 20, y1: ORIGIN[1], x2: 700, y2: ORIGIN[1], stroke: COLORS.line }, svg);
        svgElement('line', { x1: ORIGIN[0], y1: 20, x2: ORIGIN[0], y2: 250, stroke: COLORS.line }, svg);
        svgElement(
            'text',
            {
                x: ORIGIN[0] + 6,
                y: ORIGIN[1] + 16,
                fill: COLORS.text,
                'font-size': 12,
                'font-family': 'ui-monospace, monospace',
            },
            svg,
        ).textContent = 'origin';
        const ghost = svgElement(
            'rect',
            {
                x: -30,
                y: -30,
                width: 60,
                height: 60,
                rx: 4,
                fill: 'none',
                stroke: COLORS.text,
                'stroke-dasharray': '4 3',
            },
            svg,
        );
        const square = svgElement('rect', { x: -30, y: -30, width: 60, height: 60, rx: 4, fill: COLORS.second }, svg);
        const matrix = svgElement(
            'text',
            { x: 430, y: 230, fill: COLORS.result, 'font-size': 13, 'font-family': 'ui-monospace, monospace' },
            svg,
        );
        const show = say;
        const state = { scale: 1, turn: 0, x: 0, y: 0 };
        const apply = (): void => {
            square.setAttribute(
                'transform',
                `translate(${ORIGIN[0] + state.x} ${ORIGIN[1] + state.y}) rotate(${state.turn}) scale(${state.scale})`,
            );
            const radians = (state.turn * Math.PI) / 180;
            const a = state.scale * Math.cos(radians);
            const b = state.scale * Math.sin(radians);

            matrix.textContent = `a ${a.toFixed(2)}  b ${b.toFixed(2)}  c ${(-b).toFixed(2)}  d ${a.toFixed(2)}  tx ${state.x.toFixed(0)}  ty ${state.y.toFixed(0)}`;
        };
        const timeline = createTimeline({ loop: true, autoplay: false });

        for (const [index, step] of STEPS.entries()) {
            const at = index * 1600;

            timeline.call(() => {
                show(`${step.name}: ${step.says}`);
                ghost.setAttribute('transform', square.getAttribute('transform') ?? '');
            }, at);
            timeline.add(
                state,
                {
                    scale: step.scale,
                    turn: step.turn,
                    x: step.x,
                    y: step.y,
                    duration: 900,
                    ease: 'inOutCubic',
                    onUpdate: apply,
                },
                at,
            );
        }
        timeline.add(
            state,
            { scale: 1, turn: 0, x: 0, y: 0, duration: 600, onUpdate: apply },
            STEPS.length * 1600 + 800,
        );
        apply();
        own(timeline);
    },
});
