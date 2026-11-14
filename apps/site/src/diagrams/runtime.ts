import { type Controls, panel } from '../previews/panel';

/*
 * The runtime of the diagrams: small animations in SVG that show one idea on plain shapes. A
 * diagram is a module of this folder:
 *
 *   export default defineDiagram({ setup({ svg, onFrame, pick }) { ... } });
 *
 * A diagram starts when it scrolls into view and stops while it is off screen or the tab is
 * hidden. Under the drawing is a line that says what happens now, as subtitles do, with a button
 * that pauses the diagram and one that slows it down. Its other controls are the rows of the panel
 * of the previews, under that line.
 */

/** Something that plays over time and can stop, such as a timeline of anime.js. */
interface Playable {
    play(): unknown;
    pause(): unknown;
    /** The rate it plays at, 1 for its own pace. The runtime sets it when the reader slows the diagram down. */
    speed?: number;
}

/** What a diagram builds itself with: its drawing, its clock and the controls under it. */
interface DiagramContext extends Controls {
    svg: SVGSVGElement;
    /**
     * Calls `step` in every animation frame while the diagram is in view and plays, with the
     * seconds since the frame before, times the speed the reader picked.
     */
    onFrame(step: (seconds: number) => void): void;
    /** Plays an animation while the diagram is in view and plays, and pauses it otherwise. */
    own(playable: Playable): void;
    /**
     * Says what happens now, in the line under the drawing. A part written `{first:A}`,
     * `{second:B}` or `{result:the result}` takes the color of that part of the drawing.
     */
    say(text: string): void;
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
    'play-loop': () => import('./play-loop'),
    'play-speed': () => import('./play-speed'),
    'play-finished': () => import('./play-finished'),
    'events-keys': () => import('./events-keys'),
    'events-life': () => import('./events-life'),
    'assets-share': () => import('./assets-share'),
    'assets-pool': () => import('./assets-pool'),
    'size-box': () => import('./size-box'),
    'size-units': () => import('./size-units'),
    'skins-sets': () => import('./skins-sets'),
    'follow-attach': () => import('./follow-attach'),
    'anatomy-order': () => import('./anatomy-order'),
    'animation-curves': () => import('./animation-curves'),
    'pose-chain': () => import('./pose-chain'),
    'vertices-weights': () => import('./vertices-weights'),
    'vertices-uv': () => import('./vertices-uv'),
    'batches-calls': () => import('./batches-calls'),
    'batches-blend': () => import('./batches-blend'),
    'fast-change': () => import('./fast-change'),
    'perf-pacing': () => import('./perf-pacing'),
    'pixels-grid': () => import('./pixels-grid'),
    'frames-budget': () => import('./frames-budget'),
    'transform-order': () => import('./transform-order'),
    triangles: () => import('./triangles'),
    'texture-sample': () => import('./texture-sample'),
    'cpu-gpu': () => import('./cpu-gpu'),
    overdraw: () => import('./overdraw'),
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

/** The speeds a reader can pick, in the order the button steps through them. */
const SPEEDS: readonly number[] = [1, 0.5, 0.25];

/** The colors `say` gives to its marked parts, the same as the colors of the drawings. */
const TONES = new Set(['first', 'second', 'result']);

/**
 * Writes `text` into `line` as a sentence, with each part marked `{tone:words}` in a span of that
 * tone. A line that starts with code, such as `skins = [...]`, keeps its case.
 */
function subtitle(line: HTMLElement, said: string): void {
    const text = /^[a-z]+(?![\w ]*[=.([])/.test(said) ? said.charAt(0).toUpperCase() + said.slice(1) : said;
    const parts: (string | HTMLElement)[] = [];
    let at = 0;

    for (const match of text.matchAll(/\{(\w+):([^}]*)\}/g)) {
        const [whole, tone = '', words = ''] = match;

        parts.push(text.slice(at, match.index));
        if (TONES.has(tone)) {
            const span = document.createElement('span');

            span.className = `diagram-tone diagram-tone-${tone}`;
            span.textContent = words;
            parts.push(span);
        } else parts.push(words);
        at = match.index + whole.length;
    }
    parts.push(text.slice(at));
    line.replaceChildren(...parts);
}

/** The line under a drawing: what happens now, and the buttons that pause it and slow it down. */
interface Transport {
    say(text: string): void;
    playing(): boolean;
    speed(): number;
}

/** Makes the line under a drawing. `change` runs when the reader pauses, plays or picks a speed. */
function transport(bar: HTMLElement, change: () => void): Transport {
    const line = bar.querySelector<HTMLElement>('[data-diagram-say]');
    const pause = bar.querySelector<HTMLButtonElement>('[data-diagram-pause]');
    const slow = bar.querySelector<HTMLButtonElement>('[data-diagram-speed]');
    // a reader who asked for less motion sees the first frame, and plays it when they want to
    let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let speed = 1;
    let said = '';
    const label = (): void => {
        pause?.setAttribute('aria-pressed', String(!playing));
        pause?.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        if (slow !== null) {
            slow.textContent = speed === 1 ? '1x' : speed === 0.5 ? '½x' : '¼x';
            slow.setAttribute('aria-label', `Speed: ${slow.textContent}`);
        }
    };

    pause?.addEventListener('click', () => {
        playing = !playing;
        label();
        change();
    });
    slow?.addEventListener('click', () => {
        speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
        label();
        change();
    });
    label();

    return {
        say: (text) => {
            // most frames say what the frame before said
            if (line === null || text === said) return;
            said = text;
            subtitle(line, text);
        },
        playing: () => playing,
        speed: () => speed,
    };
}

/** Starts one diagram, and runs its frames while it is in view, the tab is visible and the reader lets it play. */
async function start(frame: HTMLElement, svg: SVGSVGElement, bar: HTMLElement): Promise<void> {
    const load = DIAGRAMS[frame.dataset.diagram ?? ''];
    const strip = frame.querySelector<HTMLElement>('[data-diagram-strip]');

    if (load === undefined || strip === null) return;
    const steps: ((seconds: number) => void)[] = [];
    const owned: Playable[] = [];
    const diagram = (await load()).default;
    let visible = false;
    let last = 0;
    let running = false;
    const live = (): boolean => visible && !document.hidden && controls.playing();
    /** Plays the owned animations while the diagram runs, at the speed picked, and pauses them otherwise. */
    const sync = (): void => {
        for (const playable of owned) {
            if ('speed' in playable) playable.speed = controls.speed();
            if (live()) playable.play();
            else playable.pause();
        }
    };
    const tick = (now: number): void => {
        if (!live()) {
            running = false;

            return;
        }
        // a long pause, such as a hidden tab, does not jump the diagram
        const seconds = last === 0 ? 0 : Math.min((now - last) / 1000, 0.1) * controls.speed();

        last = now;
        for (const step of steps) step(seconds);
        requestAnimationFrame(tick);
    };
    const run = (): void => {
        sync();
        if (running || !live()) return;
        running = true;
        last = 0;
        requestAnimationFrame(tick);
    };
    const controls = transport(strip, run);

    diagram.setup({
        svg,
        ...panel(bar),
        onFrame: (step) => steps.push(step),
        own: (playable) => owned.push(playable),
        say: controls.say,
    });
    // the first frame is drawn even while the diagram waits, so that a paused one shows something
    for (const step of steps) step(0);
    // a diagram that changes only when the reader picks something has nothing to pause
    if (steps.length === 0 && owned.length === 0) strip.dataset.still = 'true';
    new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        run();
    }).observe(frame);
    document.addEventListener('visibilitychange', run);
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
