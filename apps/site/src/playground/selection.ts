import { Container } from 'pixi.js';
import { SilkGraphics } from 'pixi-silk';
import { SilkText } from 'pixi-silk/text';
import type { GizmoMode } from 'pixi-silk/ui/gizmo';
import { backed, layoutRows, makeButton, type RowsSize, TEXT_STYLE, type TextButton } from './kit';
import type { Entry, Scene } from './scene';

/*
 * The controls of the selected skeleton, on the canvas around it, all of them text. A strip above
 * it shows its numbers, and words that copy it, loop it, change its speed and the tool of the
 * gizmo, reset its place, size and turn, open the report and delete it. A strip below it lists
 * its animations and its skin. The report of pixi-marrow opens in a free corner. All of it
 * follows the skeleton on screen.
 */

/** Animations listed at once. More of them come in pages. */
const PAGE = 12;
/** The speeds the speed button steps through. */
const SPEEDS = [1, 0.5, 0.25, 2];
/** The tools the gizmo button steps through. */
const MODES: readonly GizmoMode[] = ['move', 'rotate', 'scale'];
/** Space kept free at the edges of the canvas. The scene says how much the readout takes at the top. */
const MARGIN = 8;
/** Frames between two refreshes of the numbers in the header. */
const HEADER_EVERY = 15;
/** Frames between two refreshes of an open report. */
const REPORT_EVERY = 60;

/** A number kept between two others. A range that is too small keeps the low end. */
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high));

/** Values of a report row that say a feature is off or has nothing to do. */
const QUIET = new Set(['off', 'none', 'no extra range']);

/** Breaks a list after its commas into lines of at most `width` characters. */
function wrapList(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = '';

    for (const word of text.split(' ')) {
        if (line !== '' && line.length + 1 + word.length > width) {
            lines.push(line);
            line = `  ${word}`;
        } else line = line === '' ? word : `${line} ${word}`;
    }

    return line === '' ? lines : [...lines, line];
}

/** The next of some values after one of them, or the first. */
function next<T>(values: readonly T[], value: T): T {
    return values[(values.indexOf(value) + 1) % values.length] ?? value;
}

/** The controls of the selected skeleton. */
export class SelectionControls {
    private readonly scene: Scene;
    private readonly above = new Container({ label: 'selection actions' });
    private readonly below = new Container({ label: 'selection animations' });
    /** The buttons of each bar, over a dark backing that keeps them apart from the scene. */
    private readonly aboveRows = new Container();
    private readonly belowRows = new Container();
    private readonly aboveBack = new SilkGraphics();
    /** The numbers of the selected skeleton, at the top of the bar above it. */
    private readonly header = new SilkText({
        ...TEXT_STYLE,
        fill: 0xe4e4e7,
        outline: null,
        align: 'center',
        anchor: { x: 0.5, y: 0 },
    });
    /** The size of the buttons above, without the header and the backing. */
    private actionsSize: RowsSize = { width: 0, height: 0 };
    private readonly belowBack = new SilkGraphics();
    private readonly report = new Container({ label: 'selection report' });
    private readonly reportBack = new SilkGraphics();
    private readonly reportText = new SilkText({ ...TEXT_STYLE, fill: 0xe4e4e7, outline: null });
    private entry: Entry | null = null;
    private page = 0;
    private reportOpen = false;
    private aboveSize: RowsSize = { width: 0, height: 0 };
    private belowSize: RowsSize = { width: 0, height: 0 };
    private frames = 0;

    constructor(scene: Scene) {
        this.scene = scene;
        this.reportText.position.set(12, 10);
        this.report.addChild(this.reportBack, this.reportText);
        // a press on the card stays on it: it does not reach the canvas, which would let go of the selection
        this.report.eventMode = 'static';
        this.above.addChild(this.aboveBack, this.header, this.aboveRows);
        this.below.addChild(this.belowBack, this.belowRows);
        // the bars catch their presses too: a press between two buttons keeps the selection
        this.above.eventMode = 'static';
        this.below.eventMode = 'static';
        scene.ui.addChild(this.report, this.above, this.below);
        scene.onSelect = (entry) => {
            this.entry = entry;
            this.page = this.pageOf(entry);
            this.later();
        };
        scene.app.ticker.add(() => this.follow());
        this.rebuild();
    }

    /** The page of chips that holds the animation a skeleton plays. */
    private pageOf(entry: Entry | null): number {
        if (entry === null || entry.animation === null) return 0;
        const at = entry.spine.info.animations.findIndex((animation) => animation.name === entry.animation);

        return Math.max(0, Math.floor(at / PAGE));
    }

    /**
     * Builds the buttons again after the press that asked for it has ended: a button must not be
     * destroyed while it runs its own press.
     */
    private later(act: () => void = () => {}): void {
        queueMicrotask(() => {
            act();
            this.rebuild();
        });
    }

    /** Makes the buttons and chips of the selected skeleton. */
    private rebuild(): void {
        const { entry, scene } = this;
        const shown = entry !== null && scene.entries.includes(entry);

        this.above.visible = shown;
        this.below.visible = shown;
        this.report.visible = shown && this.reportOpen;
        if (!shown) {
            this.aboveSize = layoutRows(this.aboveRows, [], 0);
            this.belowSize = layoutRows(this.belowRows, [], 0);

            return;
        }
        const width = Math.min(scene.app.screen.width - 2 * MARGIN, 640);

        this.header.text = scene.describe(entry);
        this.actionsSize = layoutRows(this.aboveRows, this.actions(entry), width);
        this.aboveSize = backed(this.aboveBack, this.aboveRows, this.actionsSize, this.header);
        this.belowSize = backed(this.belowBack, this.belowRows, layoutRows(this.belowRows, this.chips(entry), width));
        if (this.reportOpen) this.refreshReport();
        this.follow();
    }

    /** The words above a skeleton. */
    private actions(entry: Entry): TextButton[] {
        const { scene } = this;
        const mode = scene.gizmoMode;

        return [
            makeButton('copy', () => this.later(() => scene.duplicate(entry, 1))),
            makeButton('copy x10', () => this.later(() => scene.duplicate(entry, 10))),
            makeButton(
                'loop',
                () => this.later(() => entry.animation !== null && scene.play(entry, entry.animation, !entry.loop)),
                entry.loop ? 'on' : 'plain',
            ),
            makeButton(`speed ${entry.speed}x`, () => this.later(() => (entry.speed = next(SPEEDS, entry.speed)))),
            makeButton(`tool ${mode}`, () => this.later(() => scene.setGizmoMode(next(MODES, mode)))),
            makeButton('reset', () => scene.resetTransform(entry)),
            makeButton(
                'report',
                () => this.later(() => (this.reportOpen = !this.reportOpen)),
                this.reportOpen ? 'on' : 'plain',
            ),
            makeButton('delete', () => this.later(() => scene.remove(entry)), 'danger'),
        ];
    }

    /** The words below a skeleton: a page of its animations, the next page, and its skin. */
    private chips(entry: Entry): TextButton[] {
        const { scene } = this;
        const { animations, skins } = entry.spine.info;
        const pages = Math.ceil(animations.length / PAGE);
        const words = animations
            .slice(this.page * PAGE, (this.page + 1) * PAGE)
            .map(({ name }) =>
                makeButton(
                    name,
                    () => this.later(() => scene.play(entry, name, entry.loop)),
                    name === entry.animation ? 'on' : 'plain',
                ),
            );

        if (pages > 1) {
            words.push(
                makeButton(`more, ${this.page + 1} of ${pages}`, () =>
                    this.later(() => (this.page = (this.page + 1) % pages)),
                ),
            );
        }
        if (skins.length > 1) {
            const skin = entry.skin ?? skins[0] ?? 'default';

            words.push(makeButton(`skin ${skin}`, () => this.later(() => scene.setSkin(entry, next(skins, skin)))));
        }

        return words;
    }

    /**
     * Puts the report in a corner of the canvas that touches neither strip: the top corners first,
     * the one away from the skeleton first, then the bottom ones. Where every
     * corner touches a bar it takes the one that covers least, and the bars are drawn over it.
     */
    private placeReport(centre: number): void {
        const { width, height } = this.scene.app.screen;
        const card = { width: this.report.width, height: this.report.height };
        const left = MARGIN;
        const right = Math.max(MARGIN, width - card.width - MARGIN);
        const top = this.scene.topInset;
        const bottom = Math.max(top, height - card.height - MARGIN);
        const sides = centre > width / 2 ? [left, right] : [right, left];
        const corners = [top, bottom].flatMap((y) => sides.map((x) => ({ x, y })));
        const bars = [
            { x: this.above.x - this.aboveSize.width / 2, y: this.above.y, ...this.aboveSize },
            { x: this.below.x - this.belowSize.width / 2, y: this.below.y, ...this.belowSize },
        ];
        const covered = ({ x, y }: { x: number; y: number }): number =>
            bars.reduce((sum, bar) => {
                const w = Math.min(x + card.width, bar.x + bar.width) - Math.max(x, bar.x);
                const h = Math.min(y + card.height, bar.y + bar.height) - Math.max(y, bar.y);

                return sum + (w > 0 && h > 0 ? w * h : 0);
            }, 0);
        const best = corners.reduce((chosen, corner) => (covered(corner) < covered(chosen) ? corner : chosen));

        this.report.position.set(Math.round(best.x), Math.round(best.y));
    }

    /** Writes the report of pixi-marrow into the card, and sizes the card to it. */
    private refreshReport(): void {
        const { entry } = this;

        if (entry === null) return;
        void entry.spine.perf.report().then((rows) => {
            if (entry !== this.entry || this.reportText.destroyed) return;
            // the features that are off or empty share one line, so the card stays short
            const quiet = rows.filter((row) => QUIET.has(row.value)).map((row) => row.feature);
            const said = rows.filter((row) => !QUIET.has(row.value));
            const width = Math.max(...said.map((row) => row.feature.length));

            this.reportText.text = [
                `${entry.name}: what pixi-marrow decided`,
                '',
                ...said.map((row) => `${row.feature.padEnd(width)}  ${row.value}`),
                ...(quiet.length > 0 ? ['', ...wrapList(`off or none: ${quiet.join(', ')}`, 52)] : []),
            ].join('\n');
            this.reportBack
                .clear()
                .roundRect(0, 0, this.reportText.width + 24, this.reportText.height + 20, 6)
                .fill({ color: 0x09090b, alpha: 0.9 });
        });
    }

    /**
     * Where the two strips go, as their top edges: the actions above the skeleton and the
     * animations below it. Where one side has no room, both go to the other side, the actions
     * first, so that neither covers the skeleton. Where neither side has room they are kept
     * inside the canvas.
     */
    private stripsAt(box: { y: number; height: number }, top: number, bottom: number): [number, number] {
        const above = this.aboveSize.height;
        const below = this.belowSize.height;
        const under = box.y + box.height + 10;
        const over = box.y - 12;

        if (over - above >= top && under + below <= bottom) return [over - above, under];
        if (under + above + 6 + below <= bottom) return [under, under + above + 6];
        if (over - below - 6 - above >= top) return [over - below - 6 - above, over - below];

        return [clamp(over - above, top, bottom - above), clamp(under, top, bottom - below)];
    }

    /** Puts the controls around the selected skeleton, inside the canvas. */
    private follow(): void {
        const { entry, scene } = this;

        if (entry === null || !this.above.visible) return;
        if (!scene.entries.includes(entry)) {
            this.entry = null;
            this.rebuild();

            return;
        }
        this.frames++;
        if (this.frames % HEADER_EVERY === 0) {
            this.header.text = scene.describe(entry);
            this.aboveSize = backed(this.aboveBack, this.aboveRows, this.actionsSize, this.header);
        }
        const { width, height } = scene.app.screen;
        const box = scene.screenBox(entry);
        const centre = box.x + box.width / 2;
        const half = (size: RowsSize): number => size.width / 2 + MARGIN;
        const top = scene.topInset;

        const [aboveY, belowY] = this.stripsAt(box, top, height - MARGIN);

        this.above.position.set(
            Math.round(clamp(centre, half(this.aboveSize), width - half(this.aboveSize))),
            Math.round(aboveY),
        );
        this.below.position.set(
            Math.round(clamp(centre, half(this.belowSize), width - half(this.belowSize))),
            Math.round(belowY),
        );
        if (!this.report.visible) return;
        this.placeReport(centre);
        if (this.frames % REPORT_EVERY === 0) this.refreshReport();
    }
}
