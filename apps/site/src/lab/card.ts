import { type LabResult, plural, resultText, verdicts } from './report';

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

/**
 * Shows the result of a run: the verdicts, a box per side, the device and the text to copy.
 *
 * @param saved What became of the result on the server that serves the page, or null.
 */
export function showResult(host: HTMLElement, result: LabResult, saved: string | null, actions: CardActions): void {
    const text = resultText(result);
    const card = element('section', 'lab-card');
    const sides = element('div', 'lab-sides');
    const area = element('textarea', 'lab-text');
    const buttons = element('div', 'lab-buttons');
    const copyButton = element('button', 'lab-button lab-button-main', 'Copy result');
    const again = element('button', 'lab-button', 'Run again');
    const others = element('a', 'lab-button', 'Other tests');
    const device = element(
        'p',
        'lab-device',
        `${result.device.name}. ${result.device.gpu}. ${result.device.refresh} Hz.`,
    );

    for (const side of result.sides) {
        const box = element('div', 'lab-side');

        box.append(
            element('p', 'lab-side-name', side.name),
            element('p', 'lab-side-frame', `${side.frame.toFixed(2)} ms`),
            element(
                'p',
                'lab-side-parts',
                `update ${side.update.toFixed(2)}, submit ${side.submit.toFixed(2)}, wait ${side.wait.toFixed(2)}, ${plural(side.draws, 'draw')}`,
            ),
        );
        sides.append(box);
    }
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
        sides,
        element('p', 'lab-note', 'Milliseconds per frame without vsync: update, submit and the wait for the GPU.'),
    );
    card.append(device);
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
