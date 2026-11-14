import { createTimeline } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * How a display list becomes draw calls. The renderer walks the list from the first object to
 * the last and adds each one to the current batch while it fits: the same shader, the same
 * blend, room for its textures. An object that does not fit sends the batch to the GPU as one
 * draw call and starts a new one. Turn on a text between the skeletons, or a skeleton that
 * multiplies, and count the calls.
 */

interface Item {
    name: string;
    /** What the batch must share with it: the kind of shader and the blend. */
    kind: 'skeleton' | 'text';
    blend: 'normal' | 'multiply';
}

const BATCH_COLORS = [COLORS.first, COLORS.second, '#6fd08c', '#b48cff', '#ffd84a'];

export default defineDiagram({
    setup({ svg, own, toggle, readout }) {
        const show = readout('Draw calls', 60);
        const options = { text: false, multiply: false };
        let timeline = createTimeline({ loop: true, autoplay: false });
        /** The display list for the switches. */
        const list = (): Item[] => {
            const items: Item[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({
                name,
                kind: 'skeleton',
                blend: 'normal',
            }));

            if (options.multiply) items[4] = { name: 'E', kind: 'skeleton', blend: 'multiply' };
            if (options.text) items.splice(3, 0, { name: 'x2', kind: 'text', blend: 'normal' });

            return items;
        };
        /** Walks the list into batches, and animates the walk. */
        const build = (): void => {
            timeline.pause();
            svg.replaceChildren();
            timeline = createTimeline({ loop: true, autoplay: false });
            const items = list();
            let batch = -1;
            let previous: Item | undefined;

            svgElement(
                'text',
                { x: 20, y: 22, fill: COLORS.text, 'font-size': 12, 'font-family': 'ui-sans-serif, system-ui' },
                svg,
            ).textContent = 'the display list, first to last';
            for (const [index, item] of items.entries()) {
                const fits = previous !== undefined && previous.kind === item.kind && previous.blend === item.blend;

                if (!fits) batch++;
                previous = item;
                const x = 20 + index * 96;
                const box = svgElement(
                    'rect',
                    { x, y: 40, width: 84, height: 60, rx: 8, fill: '#26262c', stroke: COLORS.line },
                    svg,
                );

                svgElement(
                    'text',
                    {
                        x: x + 42,
                        y: 76,
                        fill: COLORS.result,
                        'font-size': 14,
                        'text-anchor': 'middle',
                        'font-family': 'ui-sans-serif, system-ui',
                    },
                    svg,
                ).textContent = item.kind === 'text' ? 'text' : `${item.name}${item.blend === 'multiply' ? ' x' : ''}`;
                const color = BATCH_COLORS[batch % BATCH_COLORS.length] ?? COLORS.first;
                const call = batch;

                timeline.call(() => {
                    box.setAttribute('fill', color);
                    box.setAttribute('fill-opacity', '0.45');
                    show(
                        `${item.kind === 'text' ? 'a text' : `skeleton ${item.name}`}: ${fits ? `joins draw call ${call + 1}` : `starts draw call ${call + 1}`}`,
                    );
                }, index * 600);
            }
            const calls = batch + 1;

            timeline.call(
                () => show(`${calls} draw ${calls === 1 ? 'call' : 'calls'} for ${items.length} objects`),
                items.length * 600,
            );
            timeline.call(
                () => {
                    for (const box of svg.querySelectorAll('rect')) box.setAttribute('fill', '#26262c');
                },
                items.length * 600 + 2200,
            );
            timeline.play();
        };

        own({ play: () => timeline.play(), pause: () => timeline.pause() });
        toggle('Add', 'a text between', false, (on) => {
            options.text = on;
            build();
        });
        toggle('Add', 'a skeleton that multiplies', false, (on) => {
            options.multiply = on;
            build();
        });
        build();
    },
});
