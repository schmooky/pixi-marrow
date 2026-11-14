import { Container } from 'pixi.js';
import { SilkGraphics } from 'pixi-silk';
import { SilkText } from 'pixi-silk/text';
import type { RigProblem } from './files';
import { backed, layoutRows, makeButton, type RowsSize, TEXT_STYLE } from './kit';
import type { Scene } from './scene';

/*
 * The word under the readout in the top left corner switches the skinning of every skeleton
 * between the CPU and the GPU. Under it a line says what is going on, and the skeletons that
 * could not load say why. Files come in by a drop anywhere on the page.
 */

/** Where the strip starts, and the most problems listed by name. */
const LEFT = 8;
const PROBLEMS_SHOWN = 4;

/** The strip, the status line and the list of problems. */
export class Toolbar {
    private readonly scene: Scene;
    private readonly strip = new Container({ label: 'toolbar' });
    private readonly back = new SilkGraphics();
    private readonly rows = new Container();
    private readonly notes = new SilkText({ ...TEXT_STYLE, fill: 0xa1a1aa, wordWrap: true });
    private size: RowsSize = { width: 0, height: 0 };
    private skinning: 'cpu' | 'gpu' = 'cpu';
    private status = '';
    private problems: string[] = [];
    /** The width of the canvas the strip was laid out for. */
    private laidFor = 0;

    constructor(scene: Scene) {
        this.scene = scene;
        this.strip.addChild(this.back, this.rows);
        // a press on the strip stays on it, between two words too
        this.strip.eventMode = 'static';
        scene.ui.addChild(this.strip, this.notes);
        scene.app.ticker.add(() => this.follow());
        this.rebuild();
    }

    /** Says what is going on, such as a load. */
    say(text: string): void {
        this.status = text;
        this.writeNotes();
    }

    /** Lists the skeletons that could not load, the first few by name. */
    showProblems(problems: readonly RigProblem[]): void {
        const named = problems.slice(0, PROBLEMS_SHOWN).map((problem) => `${problem.name}: ${problem.reason}`);
        const more = problems.length > PROBLEMS_SHOWN ? [`and ${problems.length - PROBLEMS_SHOWN} more`] : [];

        this.problems = [...named, ...more];
        this.writeNotes();
    }

    private writeNotes(): void {
        this.notes.text = [this.status, ...this.problems].filter((line) => line !== '').join('\n');
    }

    /** Makes the words again after the press that asked for it has ended. */
    private later(act: () => void): void {
        queueMicrotask(() => {
            act();
            this.rebuild();
        });
    }

    /** Makes every skeleton again with the skinning of the strip. */
    private remake(): void {
        this.scene.remake(this.skinning === 'gpu' ? { skinning: 'gpu', renderMode: 'mesh' } : {});
    }

    private rebuild(): void {
        const { scene } = this;
        const words = [
            makeButton(`skinning ${this.skinning}`, () =>
                this.later(() => {
                    this.skinning = this.skinning === 'gpu' ? 'cpu' : 'gpu';
                    this.remake();
                }),
            ),
        ];

        this.laidFor = scene.app.screen.width;
        this.size = backed(
            this.back,
            this.rows,
            layoutRows(this.rows, words, Math.min(this.laidFor - 2 * LEFT - 16, 560), 'left'),
            null,
            'left',
        );
        this.follow();
    }

    /** Keeps the strip under the readout, and lays it out again when the canvas changes width. */
    private follow(): void {
        const { scene } = this;
        const { width } = scene.app.screen;

        if (width !== this.laidFor) {
            this.rebuild();

            return;
        }
        const top = scene.readoutBottom + 6;

        this.strip.position.set(LEFT, Math.round(top));
        this.notes.wordWrapWidth = Math.min(width - 2 * LEFT, 560);
        this.notes.position.set(LEFT + 4, Math.round(top + this.size.height + 6));
        // the controls of a selected skeleton and the report stay below all of it
        scene.topInset = Math.round(this.notes.y + (this.notes.text === '' ? 0 : this.notes.height) + 10);
    }
}
