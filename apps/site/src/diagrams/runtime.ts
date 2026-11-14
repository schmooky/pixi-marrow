import { type Controls, panel } from '../previews/panel';

/*
 * The runtime of the diagrams: small animations in SVG that show one idea on plain shapes. A
 * diagram is a module of this folder:
 *
 *   export default defineDiagram({ setup({ svg, onFrame, pick }) { ... } });
 *
 * A diagram starts when it scrolls into view and stops while it is off screen or the tab is
 * hidden. Its controls are the rows of the panel of the previews, under the drawing.
 */

/** Something that plays over time and can stop, such as a timeline of anime.js. */
interface Playable {
    play(): unknown;
    pause(): unknown;
}

/** What a diagram builds itself with: its drawing, its clock and the controls under it. */
interface DiagramContext extends Controls {
    svg: SVGSVGElement;
    /** Calls `step` in every animation frame while the diagram is in view, with the seconds since the frame before. */
    onFrame(step: (seconds: number) => void): void;
    /** Plays an animation while the diagram is in view, and pauses it while it is not. */
    own(playable: Playable): void;
}

/** A diagram: the function that builds it. */
export interface Diagram {
    setup(context: DiagramContext): void;
}

/** Types a diagram module. */
export const defineDiagram = (diagram: Diagram): Diagram => diagram;

/** The diagram modules by name. Each is a chunk of its own, loaded when its frame comes into view. */
const DIAGRAMS: Record<string, () => Promise<{ default: Diagram }>> = {
    skeletal: () => import('./skeletal'),
    frame: () => import('./frame'),
    'mix-layers': () => import('./mix-layers'),
    'mix-same': () => import('./mix-same'),
    'mix-time': () => import('./mix-time'),
    'mix-queue': () => import('./mix-queue'),
};

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Makes an SVG element with attributes, and adds it to a parent when one is given.
 *
 * @example
 * const box = svgElement('rect', { width: 20, height: 20 }, svg);
 */
export function svgElement<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string | number> = {},
    parent?: Element,
): SVGElementTagNameMap[K] {
    const made = document.createElementNS(SVG, tag);

    for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, String(value));
    parent?.append(made);

    return made;
}

/** Starts one diagram, and runs its frames while it is in view and the tab is visible. */
async function start(frame: HTMLElement, svg: SVGSVGElement, bar: HTMLElement): Promise<void> {
    const load = DIAGRAMS[frame.dataset.diagram ?? ''];

    if (load === undefined) return;
    const steps: ((seconds: number) => void)[] = [];
    const owned: Playable[] = [];
    const diagram = (await load()).default;
    let visible = false;
    let last = 0;
    let running = false;

    diagram.setup({ svg, ...panel(bar), onFrame: (step) => steps.push(step), own: (playable) => owned.push(playable) });
    /** Plays the owned animations while the diagram shows, and pauses them otherwise. */
    const sync = (): void => {
        for (const playable of owned) {
            if (visible && !document.hidden) playable.play();
            else playable.pause();
        }
    };
    const tick = (now: number): void => {
        if (!visible || document.hidden) {
            running = false;

            return;
        }
        // a long pause, such as a hidden tab, does not jump the diagram
        const seconds = last === 0 ? 0 : Math.min((now - last) / 1000, 0.1);

        last = now;
        for (const step of steps) step(seconds);
        requestAnimationFrame(tick);
    };
    const run = (): void => {
        if (running || !visible || document.hidden) return;
        running = true;
        last = 0;
        requestAnimationFrame(tick);
    };

    new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        run();
        sync();
    }).observe(frame);
    document.addEventListener('visibilitychange', () => {
        run();
        sync();
    });
}

/** Starts every diagram of the page once its frame comes near the view. */
export function mountDiagrams(): void {
    for (const frame of document.querySelectorAll<HTMLElement>('[data-diagram]')) {
        if (frame.dataset.mounted === 'true') continue;
        frame.dataset.mounted = 'true';
        const svg = frame.querySelector('svg');
        const bar = frame.querySelector<HTMLElement>('[data-diagram-bar]');

        if (svg === null || bar === null) continue;
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                observer.disconnect();
                void start(frame, svg, bar);
            },
            { rootMargin: '200px' },
        );

        observer.observe(frame);
    }
}
