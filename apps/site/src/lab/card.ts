import { type LabResult, ms, resultText, verdicts } from './report';

/*
 * What the page shows over the canvas: the status while a run goes, and the result at its end.
 * Every text comes from the run or from the browser, so it is set as text and never as HTML.
 */

/** An element with a class and a text. */
function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text = '',
): HTMLElementTagNameMap[K] {
    const made = document.createElement(tag);

    made.className = className;
    made.textContent = text;

    return made;
}

/** The status line and the bar of progress while a run goes. */
export interface Status {
    /** Shows what runs now, and how much of the run is done, as a share. */
    show(text: string, done: number): void;
}

/** Fills the status box of the page. */
export function status(host: HTMLElement): Status {
    const line = element('p', 'lab-status-line');
    const bar = element('div', 'lab-bar');
    const fill = element('div', 'lab-bar-fill');

    bar.append(fill);
    host.replaceChildren(line, bar);

    return {
        show(text, done) {
            line.textContent = text;
            fill.style.width = `${Math.round(Math.min(1, Math.max(0, done)) * 100)}%`;
        },
    };
}

/**
 * Copies a text. The clipboard of the browser needs a secure page, and a phone that opens the
 * dev server of a computer in the same network has none. So a selected text area is copied there.
 */
async function copy(text: string, area: HTMLTextAreaElement): Promise<boolean> {
    try {
        if (window.isSecureContext) {
            await navigator.clipboard.writeText(text);

            return true;
        }
    } catch {
        // the fallback below
    }
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);

    return document.execCommand('copy');
}

/** What the buttons of the result do besides copy and share. */
export interface CardActions {
    again(): void;
}

/** A box with a name, a big number and a line under it. */
function box(name: string, value: string, parts: string): HTMLElement {
    const made = element('div', 'lab-side');

    made.append(
        element('p', 'lab-side-name', name),
        element('p', 'lab-side-frame', value),
        element('p', 'lab-side-parts', parts),
    );

    return made;
}

/**
 * Shows the result of a run: what it means, the frame rate, the time per frame, the draw calls,
 * the device and the text to copy.
 *
 * @param saved What became of the result on the server that serves the page, or null.
 */
export function showResult(host: HTMLElement, result: LabResult, saved: string | null, actions: CardActions): void {
    const { play } = result;
    const text = resultText(result);
    const card = element('section', 'lab-card');
    const boxes = element('div', 'lab-sides');
    const area = element('textarea', 'lab-text');
    const buttons = element('div', 'lab-buttons');
    const copyButton = element('button', 'lab-button lab-button-main', 'Copy result');
    const again = element('button', 'lab-button', 'Run again');
    const others = element('a', 'lab-button', 'Other tests');
    const device = element(
        'p',
        'lab-device',
        `${result.device.name}. ${result.device.gpu}. ${result.device.refresh} Hz. pixi.js ${result.device.pixi}, ${result.settings.renderer}.`,
    );

    if (result.grows) {
        boxes.append(box(`At ${result.device.refresh} fps`, String(result.count), result.noun));
    }
    boxes.append(
        box(
            'Frame rate',
            `${Math.round(play.fps)} fps`,
            `${play.dropped} of ${play.frames + play.dropped} frames dropped, on a ${result.device.refresh} Hz screen`,
        ),
        box(
            'CPU per frame',
            `${ms(play.cpu)} ms`,
            `update ${ms(play.update)}, render ${ms(play.render)}, 95th percentile ${ms(play.cpuP95)}`,
        ),
        box('Draw calls', String(play.draws), `per frame, with ${result.count} ${result.noun}`),
    );
    area.readOnly = true;
    area.value = text;
    area.rows = 8;
    others.href = '/lab/';
    copyButton.addEventListener('click', () => {
        void copy(text, area).then((done) => {
            copyButton.textContent = done ? 'Copied' : 'Select the text below';
        });
    });
    again.addEventListener('click', () => actions.again());
    buttons.append(copyButton);
    if (typeof navigator.share === 'function' && window.isSecureContext) {
        const share = element('button', 'lab-button', 'Share');

        share.addEventListener('click', () => {
            navigator.share({ title: `pixi-marrow lab: ${result.test}`, text }).catch(() => {});
        });
        buttons.append(share);
    }
    buttons.append(again, others);
    card.append(element('h2', 'lab-card-title', `Result: ${result.title}`));
    for (const line of verdicts(result)) card.append(element('p', 'lab-verdict', line));
    card.append(
        boxes,
        element(
            'p',
            'lab-note',
            'Every skeleton has the settings a game gets when it sets none. The scene played at the rate of the screen. The CPU times are the update of the skeletons and the render call of Pixi.',
        ),
        device,
    );
    if (saved !== null) card.append(element('p', 'lab-note', saved));
    card.append(buttons, area);
    host.replaceChildren(card);
}

/** Shows a run that failed, with its message to copy. */
export function showFailure(host: HTMLElement, message: string, actions: CardActions): void {
    const card = element('section', 'lab-card');
    const again = element('button', 'lab-button lab-button-main', 'Run again');
    const area = element('textarea', 'lab-text');

    area.readOnly = true;
    area.value = `${message}\n${navigator.userAgent}`;
    again.addEventListener('click', () => actions.again());
    card.append(element('h2', 'lab-card-title', 'The run failed'), element('p', 'lab-verdict', message), again, area);
    host.replaceChildren(card);
}
