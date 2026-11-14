import { animate } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Units and the scale of the container. A skeleton has a bone 100 units to the right of its
 * origin. Pick a scale for the container: the picture grows and shrinks, the bone stays at 100
 * units in the space of the skeleton, and only its place on the stage changes.
 */

const SCALES = { '0.5': 0.5, '1': 1, '2': 2 } as const;

type ScaleName = keyof typeof SCALES;

const ORIGIN_X = 80;
const ORIGIN_Y = 150;

export default defineDiagram({
    setup({ svg, pick, readout }) {
        svgElement('line', { x1: 20, y1: ORIGIN_Y, x2: 700, y2: ORIGIN_Y, stroke: COLORS.line }, svg);
        for (let px = 0; px <= 600; px += 100) {
            svgElement(
                'text',
                {
                    x: ORIGIN_X + px,
                    y: ORIGIN_Y + 22,
                    fill: COLORS.text,
                    'font-size': 11,
                    'text-anchor': 'middle',
                    'font-family': 'ui-monospace, monospace',
                },
                svg,
            ).textContent = `${px} px`;
        }
        const container = svgElement('g', {}, svg);

        svgElement(
            'rect',
            { x: 0, y: -40, width: 120, height: 80, rx: 8, fill: COLORS.first, opacity: 0.85 },
            container,
        );
        svgElement('circle', { cx: 0, cy: 0, r: 5, fill: COLORS.result }, container);
        svgElement('circle', { cx: 100, cy: 0, r: 6, fill: COLORS.second }, container);
        svgElement(
            'text',
            {
                x: 100,
                y: -10,
                fill: COLORS.result,
                'font-size': 11,
                'text-anchor': 'middle',
                'font-family': 'ui-monospace, monospace',
            },
            container,
        ).textContent = 'bone';
        const showBone = readout('bone.worldX', 60);
        const showStage = readout('On the stage', 60);
        const state = { scale: 1 };
        const apply = (): void => {
            container.setAttribute('transform', `translate(${ORIGIN_X} ${ORIGIN_Y}) scale(${state.scale})`);
        };

        apply();
        pick(
            'Scale',
            Object.keys(SCALES) as ScaleName[],
            (next) => {
                const scale = SCALES[next];

                animate(state, { scale, duration: 500, ease: 'outCubic', onUpdate: apply });
                showBone('100: in units of the skeleton, the same at every scale');
                showStage(`${(100 * scale).toFixed(0)} px right of the origin: toGlobal applies the scale ${scale}`);
            },
            '1',
        );
        showBone('100: in units of the skeleton, the same at every scale');
        showStage('100 px right of the origin: toGlobal applies the scale 1');
    },
});
