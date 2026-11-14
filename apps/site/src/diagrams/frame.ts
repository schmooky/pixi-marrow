import { createTimeline } from 'animejs';
import { defineDiagram, svgElement } from './runtime';
import { COLORS } from './shapes';

/*
 * One frame of a runtime, from the time to the pixels, on a two-bone arm that holds a picture.
 * Six panels light up in turn: the time of the frame, the value the animation gives at that
 * time, the bones posed from it, the corners of the picture placed by the bones, the numbers
 * handed to the GPU, and the pixels the GPU fills. In `slow` the frame steps through the
 * stages. In `as a game does` all six run in every frame.
 */

const PANEL_WIDTH = 118;
const PANEL_HEIGHT = 150;
const TOP = 52;
const STAGES = ['Time', 'Animation', 'Bones', 'Vertices', 'Buffer', 'Pixels'] as const;
/** What each stage does, said under the drawing while it is lit. */
const SAYS = [
    (frame: Frame) => `the frame is at ${frame.time.toFixed(2)} s of the animation`,
    (frame: Frame) => `the keys around that time give a rotation of ${frame.turn.toFixed(1)} degrees`,
    () => 'the bones turn by it, and each takes the turn of its parent along',
    () => 'the picture on the second bone puts its 4 corners where the bone is',
    () => 'the corners become 8 numbers in a buffer, which goes to the GPU',
    (frame: Frame) => `the GPU fills the ${frame.pixels} pixels that its 2 triangles cover`,
] as const;
/** Seconds of the animation, and the times of the frames the slow mode steps through. */
const LENGTH = 1.33;
const STEPS = [0, 0.33, 0.67, 1];
/** Milliseconds each stage stays lit in the slow mode. */
const STAGE_MS = 1100;
/** The pixel grid of the last panel. */
const COLUMNS = 13;
const ROWS = 16;

/** What a frame computed, stage by stage. */
interface Frame {
    time: number;
    turn: number;
    joints: [number, number][];
    corners: [number, number][];
    pixels: number;
}

/** A point turned by `degrees` around the origin, y up, then moved. */
function turned(x: number, y: number, degrees: number, by: [number, number]): [number, number] {
    const angle = (degrees * Math.PI) / 180;

    return [by[0] + x * Math.cos(angle) - y * Math.sin(angle), by[1] - (x * Math.sin(angle) + y * Math.cos(angle))];
}

/** Whether a point lies inside a convex polygon. */
function inside(point: [number, number], polygon: [number, number][]): boolean {
    let sign = 0;

    for (let i = 0; i < polygon.length; i++) {
        const [ax, ay] = polygon[i] ?? [0, 0];
        const [bx, by] = polygon[(i + 1) % polygon.length] ?? [0, 0];
        const cross = (bx - ax) * (point[1] - ay) - (by - ay) * (point[0] - ax);

        if (cross !== 0) {
            if (sign !== 0 && Math.sign(cross) !== sign) return false;
            sign = Math.sign(cross);
        }
    }

    return true;
}

/** Computes a frame at a time: the animation, the bones, the corners and the pixels. */
function compute(time: number): Frame {
    const turn = 40 * Math.sin((2 * Math.PI * time) / LENGTH);
    const root: [number, number] = [26, 112];
    const elbow = turned(46, 0, turn, root);
    const childTurn = turn + 20 + turn * 0.6;
    const hand = turned(36, 0, childTurn, elbow);
    const corners = [
        turned(4, -9, childTurn, elbow),
        turned(40, -9, childTurn, elbow),
        turned(40, 9, childTurn, elbow),
        turned(4, 9, childTurn, elbow),
    ];
    let pixels = 0;

    for (let row = 0; row < ROWS; row++) {
        for (let column = 0; column < COLUMNS; column++) {
            if (inside(cellCenter(column, row), corners)) pixels++;
        }
    }

    return { time, turn, joints: [root, elbow, hand], corners, pixels };
}

/** The middle of a cell of the pixel grid, in the space of a panel. */
const cellCenter = (column: number, row: number): [number, number] => [
    4 + (column + 0.5) * ((PANEL_WIDTH - 8) / COLUMNS),
    8 + (row + 0.5) * ((PANEL_HEIGHT - 16) / ROWS),
];

/** Writes a line of numbers into a panel. */
function text(group: SVGGElement, x: number, y: number, value: string): void {
    svgElement(
        'text',
        { x, y, fill: COLORS.result, 'font-size': 12, 'font-family': 'ui-monospace, monospace' },
        group,
    ).textContent = value;
}

/** The x of a time of the animation in a panel. */
const xOfTime = (seconds: number): number => 8 + (seconds / LENGTH) * (PANEL_WIDTH - 16);
/** The height of the curve of the animation at a time, in a panel. */
const yOfTurn = (seconds: number): number => 75 - 40 * Math.sin((2 * Math.PI * seconds) / LENGTH) * 0.8;
/** The points of a list, as an SVG attribute. */
const points = (list: readonly [number, number][]): string => list.map((point) => point.join(' ')).join(' ');

/** Panel 1: the time of the frame on the length of the animation. */
function drawTime(group: SVGGElement, frame: Frame): void {
    svgElement('line', { x1: 8, y1: 75, x2: PANEL_WIDTH - 8, y2: 75, stroke: COLORS.line, 'stroke-width': 3 }, group);
    svgElement('circle', { cx: xOfTime(frame.time), cy: 75, r: 6, fill: COLORS.result }, group);
    text(group, 8, 110, `t = ${frame.time.toFixed(2)} s`);
}

/** Panel 2: the curve of the animation, its keys, and the value at the time of the frame. */
function drawCurve(group: SVGGElement, frame: Frame): void {
    let path = '';

    for (let step = 0; step <= 40; step++) {
        const seconds = (step / 40) * LENGTH;

        path += `${step === 0 ? 'M' : 'L'}${xOfTime(seconds)} ${yOfTurn(seconds)}`;
    }
    svgElement('path', { d: path, fill: 'none', stroke: COLORS.first, 'stroke-width': 2 }, group);
    for (const key of [0, LENGTH / 4, LENGTH / 2, (3 * LENGTH) / 4, LENGTH]) {
        svgElement('circle', { cx: xOfTime(key), cy: yOfTurn(key), r: 3.5, fill: COLORS.first }, group);
    }
    svgElement(
        'line',
        { x1: xOfTime(frame.time), y1: 30, x2: xOfTime(frame.time), y2: 120, stroke: COLORS.result },
        group,
    );
    text(group, 8, 140, `${frame.turn.toFixed(1)} deg`);
}

/** Panel 3: the two bones and their joints. */
function drawBones(group: SVGGElement, frame: Frame): void {
    svgElement(
        'polyline',
        {
            points: points(frame.joints),
            fill: 'none',
            stroke: COLORS.second,
            'stroke-width': 4,
            'stroke-linecap': 'round',
        },
        group,
    );
    for (const joint of frame.joints)
        svgElement('circle', { cx: joint[0], cy: joint[1], r: 4, fill: COLORS.result }, group);
}

/** Panel 4: the picture on the second bone, with its 4 corners. */
function drawVertices(group: SVGGElement, frame: Frame): void {
    svgElement(
        'polyline',
        { points: points(frame.joints), fill: 'none', stroke: COLORS.line, 'stroke-width': 3 },
        group,
    );
    svgElement(
        'polygon',
        { points: points(frame.corners), fill: COLORS.second, opacity: 0.35, stroke: COLORS.second },
        group,
    );
    for (const corner of frame.corners)
        svgElement('circle', { cx: corner[0], cy: corner[1], r: 3.5, fill: COLORS.result }, group);
}

/** Panel 5: the corners as the numbers of a buffer. */
function drawBuffer(group: SVGGElement, frame: Frame): void {
    for (const [index, corner] of frame.corners.entries()) {
        text(group, 10, 30 + index * 26, `${corner[0].toFixed(0).padStart(3)} ${corner[1].toFixed(0).padStart(3)}`);
    }
    text(group, 10, 140, '8 numbers');
}

/** Panel 6: the pixels the picture covers. */
function drawPixels(group: SVGGElement, frame: Frame): void {
    for (let row = 0; row < ROWS; row++) {
        for (let column = 0; column < COLUMNS; column++) {
            const [cx, cy] = cellCenter(column, row);

            svgElement(
                'rect',
                {
                    x: cx - 3.6,
                    y: cy - 3.6,
                    width: 7.2,
                    height: 7.2,
                    fill: inside([cx, cy], frame.corners) ? COLORS.second : '#26262c',
                },
                group,
            );
        }
    }
}

/** What each panel draws, in the order of the stages. */
const PAINTERS = [drawTime, drawCurve, drawBones, drawVertices, drawBuffer, drawPixels] as const;

export default defineDiagram({
    setup({ svg, onFrame, own, pick, say }) {
        const panels = STAGES.map((name, index) => {
            const x = 8 + index * (PANEL_WIDTH + 6);
            const frame = svgElement(
                'rect',
                {
                    x,
                    y: TOP,
                    width: PANEL_WIDTH,
                    height: PANEL_HEIGHT,
                    rx: 8,
                    fill: '#18181c',
                    stroke: COLORS.line,
                    'stroke-width': 1.5,
                },
                svg,
            );

            svgElement(
                'text',
                {
                    x: x + 6,
                    y: TOP - 10,
                    fill: COLORS.text,
                    'font-size': 13,
                    'font-family': 'ui-sans-serif, system-ui',
                },
                svg,
            ).textContent = `${index + 1} ${name}`;

            return { frame, body: svgElement('g', { transform: `translate(${x} ${TOP})` }, svg) };
        });
        /** Draws what each panel shows for a frame. */
        const draw = (frame: Frame): void => {
            for (const [index, drawPanel] of PAINTERS.entries()) {
                const group = panels[index]?.body;

                if (group === undefined) continue;
                group.replaceChildren();
                drawPanel(group, frame);
            }
        };
        /** Lights one stage, or all of them with -1, and says what it does. */
        const light = (stage: number, frame: Frame): void => {
            for (const [index, panel] of panels.entries()) {
                const lit = stage === -1 || index === stage;

                panel.frame.setAttribute('stroke', lit ? COLORS.result : COLORS.line);
                panel.body.setAttribute('opacity', lit || index < stage ? '1' : '0.25');
            }
            say(
                stage === -1
                    ? 'all six stages run in every frame, 60 times a second'
                    : `${stage + 1} ${STAGES[stage]}: ${SAYS[stage]?.(frame) ?? ''}`,
            );
        };
        const timeline = createTimeline({ loop: true, autoplay: false });

        for (const [step, time] of STEPS.entries()) {
            const frame = compute(time);

            for (let stage = 0; stage < STAGES.length; stage++) {
                timeline.call(
                    () => {
                        draw(frame);
                        light(stage, frame);
                    },
                    (step * STAGES.length + stage) * STAGE_MS,
                );
            }
        }
        timeline.call(() => {}, STEPS.length * STAGES.length * STAGE_MS);
        let mode: 'slow' | 'as a game does' = 'slow';
        let time = 0;

        own({
            play: () => (mode === 'slow' ? timeline.play() : undefined),
            pause: () => timeline.pause(),
            get speed() {
                return timeline.speed;
            },
            set speed(next: number) {
                timeline.speed = next;
            },
        });
        pick(
            'Speed',
            ['slow', 'as a game does'] as const,
            (next) => {
                mode = next;
                if (next === 'slow') timeline.play();
                else timeline.pause();
            },
            'slow',
        );
        onFrame((seconds) => {
            if (mode === 'slow') return;
            time = (time + seconds) % LENGTH;
            const frame = compute(time);

            draw(frame);
            light(-1, frame);
        });
        draw(compute(0));
    },
});
