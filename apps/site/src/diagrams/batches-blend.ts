import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Blending one pixel. A pixel of the screen holds a color, here a dark blue. A slot paints an
 * orange pixel over it, half covering. With premultiplied alpha the color already carries its
 * alpha, and normal blending is: new + old times (1 - alpha). An additive slot writes alpha 0,
 * so the same rule gives new + old. Multiply needs another rule, new times old, so it needs
 * another blend state and its own draw call.
 */

const MODES = ['normal', 'additive', 'multiply'] as const;

type Mode = (typeof MODES)[number];

/** The pixel under, the color painted and its alpha, in 0 to 1 per channel. */
const OLD = [0.1, 0.2, 0.45];
const NEW = [1, 0.55, 0.3];
const ALPHA = 0.5;

/** The result of a blend per channel. */
function blend(mode: Mode): number[] {
    const painted = NEW.map((value) => value * ALPHA);

    if (mode === 'normal') return painted.map((value, i) => value + (OLD[i] ?? 0) * (1 - ALPHA));
    if (mode === 'additive') return painted.map((value, i) => Math.min(1, value + (OLD[i] ?? 0)));

    return NEW.map((value, i) => (OLD[i] ?? 0) * (1 - ALPHA + value * ALPHA));
}

const css = (color: number[]): string => `rgb(${color.map((value) => Math.round(value * 255)).join(' ')})`;

export default defineDiagram({
    setup({ svg, pick, readout }) {
        const swatch = (x: number, label: string): SVGRectElement => {
            svgElement(
                'text',
                { x, y: 30, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
                svg,
            ).textContent = label;

            return svgElement('rect', { x, y: 40, width: 120, height: 120, rx: 10 }, svg);
        };

        swatch(30, 'on the screen').setAttribute('fill', css(OLD));
        swatch(200, 'painted, at alpha 0.5').setAttribute('fill', css(NEW));
        svgElement(
            'text',
            { x: 172, y: 108, fill: COLORS.result, 'font-size': 26, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = '+';
        svgElement(
            'text',
            { x: 342, y: 108, fill: COLORS.result, 'font-size': 26, 'font-family': 'ui-sans-serif, system-ui' },
            svg,
        ).textContent = '=';
        const result = swatch(380, 'the result');
        const rule = svgElement(
            'text',
            { x: 530, y: 100, fill: COLORS.result, 'font-size': 14, 'font-family': 'ui-monospace, monospace' },
            svg,
        );
        const show = readout('Blend state', 60);

        pick(
            'Slot',
            MODES,
            (mode) => {
                result.setAttribute('fill', css(blend(mode)));
                rule.textContent =
                    mode === 'normal' ? 'new + old x (1 - a)' : mode === 'additive' ? 'new + old x 1' : 'new x old';
                show(
                    mode === 'multiply'
                        ? 'another rule: a blend state of its own, so a new draw call'
                        : 'the same rule for both: they share one draw call',
                );
            },
            'normal',
        );
        result.setAttribute('fill', css(blend('normal')));
        rule.textContent = 'new + old x (1 - a)';
        show('the same rule for both: they share one draw call');
    },
});
