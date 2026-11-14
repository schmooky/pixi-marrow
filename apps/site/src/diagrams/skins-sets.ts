import { animate } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Skins as sets of attachments. Three slots: hat, shirt and hand. Skin `cap` has a hat and a
 * shirt, skin `knight` has a hat and a sword. Pick the active skins: each slot shows the
 * attachment of the last skin in the list that has one for it, and a slot no skin fills stays
 * empty.
 */

const SLOTS = ['hat', 'shirt', 'hand'] as const;

type SlotName = (typeof SLOTS)[number];

/** What a skin stores per slot: a name and a color. */
const SKINS: Record<string, Partial<Record<SlotName, { name: string; color: string }>>> = {
    cap: { hat: { name: 'red cap', color: '#ff6b6b' }, shirt: { name: 'blue shirt', color: '#5fa8ff' } },
    knight: { hat: { name: 'helmet', color: '#c0c0c8' }, hand: { name: 'sword', color: '#ffd84a' } },
};
const CHOICES = {
    cap: ['cap'],
    knight: ['knight'],
    'cap, knight': ['cap', 'knight'],
    'knight, cap': ['knight', 'cap'],
} as const;

type Choice = keyof typeof CHOICES;

export default defineDiagram({
    setup({ svg, pick, say }) {
        const text = (x: number, y: number, value: string, color = COLORS.text): SVGTextElement => {
            const node = svgElement(
                'text',
                { x, y, fill: color, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
                svg,
            );

            node.textContent = value;

            return node;
        };

        text(110, 20, 'skin cap');
        text(260, 20, 'skin knight');
        text(470, 20, 'what shows');
        const result = svgElement('g', {}, svg);
        const show = say;

        for (const [row, slot] of SLOTS.entries()) {
            const y = 40 + row * 50;

            text(20, y + 24, slot, COLORS.result);
            for (const [column, skin] of ['cap', 'knight'].entries()) {
                const item = SKINS[skin]?.[slot];
                const x = 110 + column * 150;

                svgElement('rect', { x, y, width: 120, height: 36, rx: 6, fill: 'none', stroke: COLORS.line }, svg);
                if (item !== undefined) {
                    svgElement('rect', { x: x + 6, y: y + 6, width: 24, height: 24, rx: 4, fill: item.color }, svg);
                    text(x + 38, y + 23, item.name);
                }
            }
        }
        /** Shows each slot with the attachment the active skins give it. */
        const draw = (active: readonly string[]): void => {
            result.replaceChildren();
            for (const [row, slot] of SLOTS.entries()) {
                const y = 40 + row * 50;
                const from = [...active].reverse().find((skin) => SKINS[skin]?.[slot] !== undefined);
                const item = from === undefined ? undefined : SKINS[from]?.[slot];
                const cellNode = svgElement('g', { opacity: 0 }, result);

                svgElement(
                    'rect',
                    { x: 470, y, width: 200, height: 36, rx: 6, fill: 'none', stroke: COLORS.result },
                    cellNode,
                );
                if (item === undefined) {
                    svgElement(
                        'text',
                        {
                            x: 480,
                            y: y + 23,
                            fill: COLORS.text,
                            'font-size': 12,
                            'font-family': 'ui-sans-serif, system-ui',
                        },
                        cellNode,
                    ).textContent = 'empty';
                } else {
                    svgElement('rect', { x: 476, y: y + 6, width: 24, height: 24, rx: 4, fill: item.color }, cellNode);
                    svgElement(
                        'text',
                        {
                            x: 508,
                            y: y + 23,
                            fill: COLORS.result,
                            'font-size': 12,
                            'font-family': 'ui-sans-serif, system-ui',
                        },
                        cellNode,
                    ).textContent = `${item.name}, from ${from}`;
                }
                animate(cellNode, { opacity: [0, 1], duration: 300, delay: row * 80 });
            }
        };

        pick(
            'Skins',
            Object.keys(CHOICES) as Choice[],
            (next) => {
                draw(CHOICES[next]);
                show(
                    `skins = [${CHOICES[next].map((skin) => `'${skin}'`).join(', ')}]: a later skin wins where both have one`,
                );
            },
            'cap',
        );
        draw(CHOICES.cap);
        show("skins = ['cap']: a later skin wins where both have one");
    },
});
