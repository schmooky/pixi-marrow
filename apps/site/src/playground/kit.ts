import { Container, Rectangle } from 'pixi.js';
import type { SilkGraphics } from 'pixi-silk';
import { SilkText } from 'pixi-silk/text';

/*
 * The look of the playground on the canvas: the text of pixi-silk and nothing else. A button
 * is a word that lights up under the pointer, laid out in rows on a flat dark strip.
 */

const MONO = 'ui-monospace, SF Mono, Menlo, Consolas, monospace';

/** The text of the readout, the labels and the report: monospace, which stays crisp at small sizes. */
export const TEXT_STYLE = {
    fontSize: 12,
    fontFamily: MONO,
    lineHeight: 15,
    tabularNumbers: true,
    outline: { width: 2, color: 0x000000, alpha: 0.7 },
} as const;

/** The height of a row of buttons, and the space between two buttons of a row. */
const ROW_HEIGHT = 22;
const GAP = 18;
/** Space between the rows of a strip and its edge. */
const PAD = 8;

/** What a button is: a plain one, one that is on, or one that deletes. */
export type ButtonKind = 'plain' | 'on' | 'danger';

/** The colour of each kind of button at rest and under the pointer. */
const COLORS: Record<ButtonKind, readonly [rest: number, hover: number]> = {
    plain: [0xa1a1aa, 0xffffff],
    on: [0xfb923c, 0xfdba74],
    danger: [0xf87171, 0xfecaca],
};

/** A word that acts when it is tapped. It is centred on its origin. */
export class TextButton extends Container {
    /** The width of the word. */
    readonly itemWidth: number;

    constructor(label: string, press: () => void, kind: ButtonKind = 'plain') {
        super({ label: `button ${label}` });
        const [rest, hover] = COLORS[kind];
        const text = new SilkText({
            text: label,
            fontSize: 13,
            fontFamily: MONO,
            fontWeight: 600,
            fill: rest,
            anchor: { x: 0.5, y: 0.5 },
        });

        this.addChild(text);
        this.itemWidth = Math.ceil(text.width);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        // the gap and the row height count, so a finger that lands a little off still hits
        this.hitArea = new Rectangle(-this.itemWidth / 2 - GAP / 2, -ROW_HEIGHT / 2, this.itemWidth + GAP, ROW_HEIGHT);
        this.on('pointerover', () => text.set({ fill: hover }));
        this.on('pointerout', () => text.set({ fill: rest }));
        this.on('pointertap', () => press());
    }
}

/**
 * A text button.
 *
 * @example
 * const remove = makeButton('delete', () => scene.remove(entry), 'danger');
 */
export const makeButton = (label: string, press: () => void, kind: ButtonKind = 'plain'): TextButton =>
    new TextButton(label, press, kind);

/** The size of what {@link layoutRows} laid out. */
export interface RowsSize {
    width: number;
    height: number;
}

/**
 * Puts buttons into a container in rows no wider than `maxWidth`, from y = 0 down. The rows are
 * centred on x = 0, or start at x = 0 with `left`. Buttons that leave the container are destroyed.
 */
export function layoutRows(
    host: Container,
    buttons: readonly TextButton[],
    maxWidth: number,
    align: 'center' | 'left' = 'center',
): RowsSize {
    const rows: TextButton[][] = [[]];
    let rowWidth = 0;

    for (const button of buttons) {
        const row = rows[rows.length - 1] ?? [];

        if (row.length > 0 && rowWidth + GAP + button.itemWidth > maxWidth) {
            rows.push([button]);
            rowWidth = button.itemWidth;
        } else {
            row.push(button);
            rowWidth += (row.length > 1 ? GAP : 0) + button.itemWidth;
        }
    }
    let widest = 0;

    for (const [index, row] of rows.entries()) {
        const width = row.reduce((sum, button) => sum + button.itemWidth, 0) + GAP * Math.max(0, row.length - 1);
        let x = align === 'center' ? -width / 2 : 0;

        widest = Math.max(widest, width);
        for (const button of row) {
            button.position.set(x + button.itemWidth / 2, index * ROW_HEIGHT + ROW_HEIGHT / 2);
            x += button.itemWidth + GAP;
        }
    }
    for (const child of host.removeChildren()) {
        if (!buttons.includes(child as TextButton)) child.destroy({ children: true });
    }
    if (buttons.length > 0) host.addChild(...buttons);

    return { width: widest, height: buttons.length === 0 ? 0 : rows.length * ROW_HEIGHT };
}

/**
 * Draws the flat dark strip behind some rows, with a line of text above them where one is
 * given, and moves the rows inside it.
 *
 * @returns The size of the strip, from its top edge down, centred on x = 0 or starting there.
 */
export function backed(
    back: SilkGraphics,
    rows: Container,
    size: RowsSize,
    header: SilkText | null = null,
    align: 'center' | 'left' = 'center',
): RowsSize {
    back.clear();
    if (size.width === 0) return size;
    const head = header === null ? 0 : header.height + 4;
    const outer = {
        width: Math.max(size.width, header?.width ?? 0) + 2 * PAD,
        height: size.height + head + 2 * PAD - 4,
    };
    const left = align === 'center' ? -outer.width / 2 : 0;
    const inner = align === 'center' ? 0 : PAD;

    header?.position.set(inner, PAD);
    rows.position.set(inner, PAD + head - 2);
    back.roundRect(left, 0, outer.width, outer.height, 6).fill({ color: 0x09090b, alpha: 0.88 });

    return outer;
}
