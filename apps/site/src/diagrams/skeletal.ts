import { animate } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * Why skeletal animation. On the left a figure waves its arm from a sprite sheet: eight
 * pictures drawn in advance, shown one after the other, so the motion steps from picture to
 * picture. On the right the same wave comes from a skeleton: two pictures, a body and an arm,
 * and a bone that turns the arm. The runtime computes the angle for every frame, so the motion
 * is smooth at any frame rate, and the files hold two pictures and a few numbers.
 */

/** Pictures in the sprite sheet, and the angles of the arm at both ends of the wave. */
const FRAMES = 8;
const LOW = -35;
const HIGH = 55;

/** Draws the figure into a group: a body, a head, and an arm turned by `angle` degrees at the shoulder. */
function drawFigure(group: SVGGElement, angle: number, scale: number): SVGGElement {
    group.replaceChildren();
    svgElement(
        'rect',
        { x: -14 * scale, y: -10 * scale, width: 28 * scale, height: 40 * scale, rx: 6 * scale, fill: COLORS.first },
        group,
    );
    svgElement('circle', { cx: 0, cy: -22 * scale, r: 12 * scale, fill: COLORS.first }, group);
    const arm = svgElement('g', { transform: `translate(${12 * scale} ${-4 * scale}) rotate(${-angle})` }, group);

    svgElement(
        'rect',
        { x: 0, y: -4 * scale, width: 30 * scale, height: 8 * scale, rx: 4 * scale, fill: COLORS.second },
        arm,
    );

    return arm;
}

/** The angle of the arm at a share of the wave, from 0 to 1. */
const angleAt = (share: number): number => LOW + (HIGH - LOW) * share;

export default defineDiagram({
    setup({ svg, own, readout }) {
        const label = (x: number, y: number, text: string, size = 13): void => {
            svgElement(
                'text',
                { x, y, fill: COLORS.text, 'font-size': size, 'font-family': 'ui-sans-serif, system-ui' },
                svg,
            ).textContent = text;
        };

        label(20, 22, 'Frame by frame: 8 pictures, drawn in advance');
        label(400, 22, 'Skeleton: 2 pictures and a bone');
        // the sprite sheet: every picture of the wave, side by side
        const marker = svgElement(
            'rect',
            { y: 34, width: 40, height: 54, rx: 4, fill: 'none', stroke: COLORS.result, 'stroke-width': 2 },
            svg,
        );

        for (let frame = 0; frame < FRAMES; frame++) {
            const thumb = svgElement('g', { transform: `translate(${40 + frame * 42} 68)` }, svg);

            drawFigure(thumb, angleAt(frame / (FRAMES - 1)), 0.6);
        }
        // the two pictures of the skeleton, apart, and its keys
        drawFigure(svgElement('g', { transform: 'translate(430 68)' }, svg), 0, 0.6);
        label(470, 72, 'body, arm', 12);
        label(560, 72, 'keys: 55 and -35 degrees', 12);
        const sheetView = svgElement('g', { transform: 'translate(180 220)' }, svg);
        const skeletonView = svgElement('g', { transform: 'translate(560 220)' }, svg);
        const bone = svgElement('line', { stroke: COLORS.result, 'stroke-width': 3, 'stroke-linecap': 'round' }, svg);

        svgElement('circle', { cx: 584, cy: 212, r: 5, fill: COLORS.result }, svg);
        const showSheet = readout('Frame by frame', 56);
        const showSkeleton = readout('Skeleton', 56);
        const sheet = { frame: 0 };
        const skeleton = { share: 0 };

        own(
            animate(sheet, {
                frame: FRAMES - 1,
                duration: 900,
                loop: true,
                alternate: true,
                ease: 'linear',
                autoplay: false,
                onUpdate: () => {
                    const frame = Math.round(sheet.frame);

                    drawFigure(sheetView, angleAt(frame / (FRAMES - 1)), 2);
                    marker.setAttribute('x', String(20 + frame * 42));
                    showSheet(`shows picture ${frame + 1} of ${FRAMES}: the arm jumps from one to the next`);
                },
            }),
        );
        own(
            animate(skeleton, {
                share: 1,
                duration: 900,
                loop: true,
                alternate: true,
                ease: 'inOutSine',
                autoplay: false,
                onUpdate: () => {
                    const angle = angleAt(skeleton.share);
                    const tip = (angle * Math.PI) / 180;

                    drawFigure(skeletonView, angle, 2);
                    bone.setAttribute('x1', String(560 + 24));
                    bone.setAttribute('y1', String(220 - 8));
                    bone.setAttribute('x2', String(560 + 24 + Math.cos(tip) * 60));
                    bone.setAttribute('y2', String(220 - 8 - Math.sin(tip) * 60));
                    showSkeleton(`the bone is at ${angle.toFixed(1)} degrees, computed for this frame`);
                },
            }),
        );
    },
});
