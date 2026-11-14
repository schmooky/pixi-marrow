import { createTimeline } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Draw order is painting order. Three slots of a skeleton are painted one after the other, and
 * each paints over what is already there. Pick an order: the same three pictures overlap
 * differently, because the last one painted covers the others.
 */

const ORDERS = {
    'wing, body, face': ['wing', 'body', 'face'],
    'body, wing, face': ['body', 'wing', 'face'],
    'face, body, wing': ['face', 'body', 'wing'],
} as const;

type OrderName = keyof typeof ORDERS;

/** The three slots: where each picture lies and its color. */
const PARTS: Record<string, { x: number; y: number; w: number; h: number; color: string }> = {
    wing: { x: 300, y: 40, w: 150, h: 70, color: '#9fd0ff' },
    body: { x: 260, y: 70, w: 140, h: 120, color: COLORS.second },
    face: { x: 330, y: 95, w: 90, h: 70, color: COLORS.result },
};

export default defineDiagram({
    setup({ svg, own, pick, say }) {
        const canvas = svgElement('g', {}, svg);
        const show = say;
        let timeline = createTimeline({ loop: true, autoplay: false });
        let rate = 1;
        /** Paints the slots in an order, one after the other, then starts again. */
        const paint = (order: readonly string[]): void => {
            timeline.pause();
            timeline = createTimeline({ loop: true, autoplay: false });
            timeline.speed = rate;
            const nodes = order.map((name) => {
                const part = PARTS[name] ?? { x: 0, y: 0, w: 0, h: 0, color: '#000' };
                const group = svgElement('g', { opacity: 0 }, canvas);

                svgElement(
                    'rect',
                    { x: part.x, y: part.y, width: part.w, height: part.h, rx: 10, fill: part.color },
                    group,
                );
                svgElement(
                    'text',
                    {
                        x: part.x + 8,
                        y: part.y + 18,
                        fill: '#111113',
                        'font-size': 12,
                        'font-weight': 600,
                        'font-family': 'ui-sans-serif, system-ui',
                    },
                    group,
                ).textContent = name;

                return group;
            });

            canvas.replaceChildren(...nodes);
            for (const [index, node] of nodes.entries()) {
                timeline.call(
                    () => show(`Step ${index + 1} of 3: the ${order[index]} is painted over what is already there.`),
                    index * 900,
                );
                timeline.add(node, { opacity: [0, 1], duration: 400 }, index * 900);
            }
            timeline.call(
                () =>
                    show(
                        `Done. The ${order[order.length - 1]} was painted last, so it covers the others where they overlap.`,
                    ),
                2700,
            );
            timeline.add(nodes, { opacity: 0, duration: 300 }, 4600);
            timeline.play();
        };

        own({
            play: () => timeline.play(),
            pause: () => timeline.pause(),
            get speed() {
                return rate;
            },
            set speed(next: number) {
                rate = next;
                timeline.speed = next;
            },
        });
        pick('Order', Object.keys(ORDERS) as OrderName[], (next) => paint(ORDERS[next]), 'wing, body, face');
        paint(ORDERS['wing, body, face']);
    },
});
