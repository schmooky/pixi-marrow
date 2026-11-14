import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * The CPU and the GPU. In each frame the CPU updates the scene, then asks the GPU to draw with
 * draw calls. Every call costs the CPU a fixed amount, whatever it draws, and the GPU starts on
 * a call once the CPU sent it. Pick how many calls a frame takes: with many, the CPU lane fills
 * the frame and the picture is late, though the GPU has little to do. The sizes are drawn to
 * show the shape of the cost, not measured.
 */

const CALLS = { '1 draw call': 1, '20 draw calls': 20, '200 draw calls': 200 } as const;

type CallName = keyof typeof CALLS;

const LEFT = 90;
const FRAME = 560;
const UPDATE = 120;
/** The width of the fixed CPU cost of one call, and of the GPU work, in the units of the drawing. */
const PER_CALL = 3.2;
const GPU_WORK = 180;

export default defineDiagram({
    setup({ svg, pick, say }) {
        const lanes = svgElement('g', {}, svg);
        const show = say;

        for (const [index, name] of ['CPU', 'GPU'].entries()) {
            svgElement(
                'text',
                {
                    x: 20,
                    y: 70 + index * 70,
                    fill: COLORS.result,
                    'font-size': 14,
                    'font-family': 'ui-sans-serif, system-ui',
                },
                svg,
            ).textContent = name;
        }
        svgElement(
            'rect',
            { x: LEFT, y: 30, width: FRAME, height: 150, fill: 'none', stroke: COLORS.line, 'stroke-dasharray': '4 4' },
            svg,
        );
        svgElement(
            'text',
            {
                x: LEFT + FRAME - 4,
                y: 24,
                fill: COLORS.text,
                'font-size': 12,
                'text-anchor': 'end',
                'font-family': 'ui-monospace, monospace',
            },
            svg,
        ).textContent = 'end of the frame';
        const draw = (calls: number): void => {
            lanes.replaceChildren();
            svgElement('rect', { x: LEFT, y: 50, width: UPDATE, height: 30, rx: 3, fill: COLORS.first }, lanes);
            svgElement(
                'text',
                { x: LEFT + 6, y: 70, fill: '#111113', 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
                lanes,
            ).textContent = 'update';
            const callsWidth = calls * PER_CALL;

            for (let call = 0; call < Math.min(calls, 200); call++) {
                svgElement(
                    'rect',
                    {
                        x: LEFT + UPDATE + call * PER_CALL,
                        y: 50,
                        width: Math.max(1, PER_CALL - 0.8),
                        height: 30,
                        fill: COLORS.second,
                    },
                    lanes,
                );
            }
            const gpuStart = LEFT + UPDATE + PER_CALL;
            const gpuEnd = Math.max(gpuStart + GPU_WORK, LEFT + UPDATE + callsWidth + 10);

            svgElement(
                'rect',
                { x: gpuStart, y: 120, width: gpuEnd - gpuStart, height: 30, rx: 3, fill: '#6fd08c', opacity: 0.8 },
                lanes,
            );
            svgElement(
                'text',
                {
                    x: gpuStart + 6,
                    y: 140,
                    fill: '#111113',
                    'font-size': 12,
                    'font-family': 'ui-sans-serif, system-ui',
                },
                lanes,
            ).textContent = 'draws';
            const late = LEFT + UPDATE + callsWidth > LEFT + FRAME;

            show(
                late
                    ? `${calls} calls: the CPU is still sending them when the frame should end, so the picture is late`
                    : `${calls} ${calls === 1 ? 'call' : 'calls'}: the CPU is done early, and the frame has time left`,
            );
        };

        pick('Frame takes', Object.keys(CALLS) as CallName[], (next) => draw(CALLS[next]), '1 draw call');
        draw(1);
    },
});
