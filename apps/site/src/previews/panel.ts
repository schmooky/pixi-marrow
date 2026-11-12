/*
 * The controls under the canvas of a preview: a small panel with one row per thing to pick. A
 * row has a label at the left and its choices at the right.
 *
 * - `pick` is one out of few, as joined buttons: a rig, a skin.
 * - `chips` is one out of many, as chips that wrap: the animations.
 * - `toggle` is a switch that is on or off.
 * - `readout` is a line of text of a fixed width.
 *
 * Tab moves from group to group and the arrow keys move inside one, as in a native radio group.
 * A choice is a radio, a switch is a switch, and each says its state with `aria-checked`.
 */

/** How many options joined buttons hold. A pick out of more is shown as chips, which wrap better. */
const FEW = 5;

/** A group of choices of which one is marked. */
interface Picker {
    /** Marks another choice. It does not run `choose`. */
    select(option: string): void;
    /** Empties the row and hides it. The row keeps its place in the panel. */
    remove(): void;
}

/** The controls a preview adds to its panel. A row is named by its label, and rows stand in the order they were first named. */
export interface Controls {
    /**
     * A row with joined buttons of which one is marked: `picked`, or none. `choose` runs when one
     * is pressed. The row hides while there are fewer than two options to pick from, and more
     * than five options are shown as chips.
     */
    pick<T extends string>(
        label: string,
        options: readonly T[],
        choose: (option: T) => void,
        picked?: T | null,
    ): Picker;
    /** A row of chips that wrap, of which one is marked: `picked`, or none. `choose` runs when one is pressed. */
    chips<T extends string>(
        label: string,
        options: readonly T[],
        choose: (option: T) => void,
        picked?: T | null,
    ): Picker;
    /** A switch named `name` in the row `label`. `change` runs when it is flipped. */
    toggle(label: string, name: string, on: boolean, change: (on: boolean) => void): void;
    /** A row with a line of text that is `width` characters wide. Returns the function that sets it. */
    readout(label: string, width: number): (text: string) => void;
}

/** Where a key moves the focus in a group of `count` buttons from the button `at`, or -1 for a key that moves nothing. */
function step(key: string, at: number, count: number): number {
    if (key === 'ArrowRight' || key === 'ArrowDown') return at >= count - 1 ? 0 : at + 1;
    if (key === 'ArrowLeft' || key === 'ArrowUp') return at <= 0 ? count - 1 : at - 1;
    if (key === 'Home') return 0;

    return key === 'End' ? count - 1 : -1;
}

/**
 * Makes a group one stop of the tab key: one button of it can take the focus, and the arrow
 * keys, Home and End move the focus to another one.
 *
 * @param follow True for radios: the button the focus moves to is pressed as well.
 */
function rove(group: HTMLElement, follow: boolean): void {
    group.addEventListener('keydown', (event) => {
        const buttons = [...group.querySelectorAll('button')];
        const at = event.target instanceof HTMLButtonElement ? buttons.indexOf(event.target) : -1;
        const target = buttons[step(event.key, at, buttons.length)];

        if (target === undefined) return;
        event.preventDefault();
        for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
        target.focus();
        if (follow) target.click();
    });
}

/** The controls of one preview with the way to end them. */
export interface Panel extends Controls {
    /** Ends the controls: what a preview adds from now on reaches no page. */
    close(): void;
}

/** The controls of one preview, which write into the panel under its canvas. */
export function panel(bar: HTMLElement): Panel {
    /** Where the rows go: the panel, and an element of no page once the controls were closed. */
    let host = bar;
    /** The choices of a row, which is made when its label is named for the first time. */
    const row = (label: string, kind: string, role: string): HTMLElement => {
        const id = `${bar.id}-${label.toLowerCase()}`;
        let choices = host.querySelector<HTMLElement>(`[data-row="${label}"] > div`);

        if (choices === null) {
            const line = document.createElement('div');
            const name = document.createElement('span');

            choices = document.createElement('div');
            line.className = 'preview-row';
            line.dataset.row = label;
            name.className = 'preview-label';
            name.id = id;
            name.textContent = label;
            line.append(name, choices);
            host.append(line);
            if (role !== '') rove(choices, role === 'radiogroup');
        }
        choices.className = kind;
        choices.setAttribute('aria-labelledby', id);
        if (role !== '') choices.setAttribute('role', role);

        return choices;
    };
    /** @param least The row hides while it has fewer options than this. */
    const radios = <T extends string>(
        kind: string,
        least: number,
        label: string,
        options: readonly T[],
        choose: (option: T) => void,
        picked: T | null | undefined,
    ): Picker => {
        const choices = row(label, kind, 'radiogroup');
        const line = choices.parentElement;
        const select = (option: string): void => {
            const buttons = [...choices.querySelectorAll('button')];
            const marked = buttons.find((button) => button.textContent === option);

            // the marked choice takes the tab key, and the first one where none is marked
            for (const button of buttons) {
                button.setAttribute('aria-checked', String(button === marked));
                button.tabIndex = button === (marked ?? buttons[0]) ? 0 : -1;
            }
        };

        choices.replaceChildren();
        for (const option of options) {
            const button = document.createElement('button');

            button.type = 'button';
            button.setAttribute('role', 'radio');
            button.textContent = option;
            button.addEventListener('click', () => {
                select(option);
                choose(option);
            });
            choices.append(button);
        }
        select(picked ?? '');
        if (line !== null) line.hidden = options.length < least;

        return {
            select,
            remove() {
                choices.replaceChildren();
                if (line !== null) line.hidden = true;
            },
        };
    };

    return {
        close() {
            host = document.createElement('div');
        },
        // with one option there is nothing to pick. One animation is still shown: it says what plays
        pick: (label, options, choose, picked) =>
            radios(options.length > FEW ? 'preview-chips' : 'preview-segments', 2, label, options, choose, picked),
        chips: (label, options, choose, picked) => radios('preview-chips', 1, label, options, choose, picked),
        toggle(label, name, on, change) {
            const choices = row(label, 'preview-switches', 'group');
            const button = document.createElement('button');

            button.type = 'button';
            button.setAttribute('role', 'switch');
            button.setAttribute('aria-checked', String(on));
            button.textContent = name;
            // the first switch of the row takes the tab key
            button.tabIndex = choices.childElementCount === 0 ? 0 : -1;
            button.addEventListener('click', () => {
                const next = button.getAttribute('aria-checked') !== 'true';

                button.setAttribute('aria-checked', String(next));
                change(next);
            });
            choices.append(button);
        },
        readout(label, width) {
            const choices = row(label, 'preview-readout', '');
            // A span and no output element: an output is read aloud each time it changes
            const line = document.createElement('span');

            line.dataset.readout = label;
            line.style.width = `${width}ch`;
            choices.replaceChildren(line);

            return (text) => {
                line.textContent = text;
            };
        },
    };
}
