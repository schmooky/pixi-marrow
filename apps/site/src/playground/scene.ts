import { Application, Container, type FederatedPointerEvent, Rectangle, UPDATE_PRIORITY } from 'pixi.js';
import { type MarrowAsset, MarrowSpine, type MarrowSpineOptions } from 'pixi-marrow';
import { SilkText } from 'pixi-silk/text';
import { Camera } from 'pixi-silk/ui/camera';
import { type GizmoMode, TransformGizmo } from 'pixi-silk/ui/gizmo';
import { CanvasGrid } from 'pixi-silk/ui/grid';
import { countDraws } from '../lab/measure';
import { TEXT_STYLE } from './kit';
import { panOnDrag } from './pan';
import { firstAnimation, firstPicture } from './start';

/*
 * The scene of the playground. A camera of pixi-silk pans and zooms the world over its grid.
 * Every skeleton stands in the world with a small label of its numbers under it, drawn with
 * the text of pixi-silk in screen space, so it keeps its size at any zoom. A click selects a
 * skeleton and a drag moves it. The gizmo of pixi-silk then rotates and scales it too.
 *
 * The skeletons do not update themselves: the scene updates each one and times it.
 */

/** The canvas colour, the card colour of the site. */
const BACKGROUND = 0x111113;
/** Space between skeletons that are placed side by side, as a share of the larger one. */
const GAP = 0.25;
/** A label hides when its skeleton is narrower than this on screen, in CSS pixels. */
const LABEL_MIN_WIDTH = 72;
/** Above this many skeletons no label shows. */
const MAX_LABELS = 150;
/** Frames between two refreshes of the text of the labels and the readout. */
const TEXT_EVERY = 15;

/** One skeleton of the scene, with what the panel shows and changes of it. */
export interface Entry {
    readonly id: number;
    readonly name: string;
    readonly asset: MarrowAsset;
    spine: MarrowSpine;
    readonly label: SilkText;
    /** The box of the setup pose in skeleton units. */
    readonly frame: Rectangle;
    /** Where the skeleton was placed, by its load, its copy or Arrange. A reset puts it back there. */
    home: { x: number; y: number };
    animation: string | null;
    loop: boolean;
    speed: number;
    skin: string | null;
    /** The update of the last frames in milliseconds, smoothed. */
    updateMs: number;
}

/** The numbers of the whole scene for the readout. */
interface Totals {
    fps: number;
    update: number;
    render: number;
    draws: number;
}

/** The scene: the app, the camera, the grid, the skeletons and the gizmo. */
export class Scene {
    readonly app: Application;
    readonly camera: Camera;
    readonly gizmo: TransformGizmo;
    readonly entries: Entry[] = [];
    /** The options every skeleton is made with. */
    options: MarrowSpineOptions = {};
    /** Space at the top of the canvas that the readout and the strip under it take, in CSS pixels. */
    topInset = 64;
    /** Called when the selection changes. */
    onSelect: (entry: Entry | null) => void = () => {};
    /** Screen space above the skeletons and the gizmo, for the buttons of the playground. */
    readonly ui = new Container({ label: 'ui' });
    private readonly world = new Container({ label: 'world' });
    private readonly labels = new Container({ label: 'labels' });
    private readonly readout: SilkText;
    private readonly draws = countDraws();
    private readonly totals: Totals = { fps: 0, update: 0, render: 0, draws: 0 };
    private selected: Entry | null = null;
    private nextId = 1;
    private frames = 0;

    private constructor(app: Application) {
        this.app = app;
        // as in Figma: a scroll pans, a pinch or Ctrl and the wheel zoom. A trackpad pans with two fingers
        this.camera = new Camera({ world: this.world, element: app.canvas, wheel: 'pan', ticker: app.ticker });
        const grid = new CanvasGrid({ camera: this.camera, axes: true, ticker: app.ticker });

        this.gizmo = new TransformGizmo({ mode: 'move', transition: 'glide', ticker: app.ticker });
        this.readout = new SilkText({ ...TEXT_STYLE, fill: 0xe4e4e7 });
        this.readout.position.set(12, 12);
        app.stage.addChild(grid, this.world, this.labels, this.gizmo, this.ui, this.readout);
        panOnDrag(app, this.camera, () => this.select(null));
        app.ticker.add(() => this.step(), undefined, UPDATE_PRIORITY.HIGH);
        // the render is timed: it is taken off the ticker and called here
        app.ticker.remove(app.render, app);
        app.ticker.add(() => this.render(), undefined, UPDATE_PRIORITY.LOW);
    }

    /** Makes the app in an element and the scene in it. */
    static async create(host: HTMLElement): Promise<Scene> {
        const app = new Application();

        await app.init({
            resizeTo: host,
            background: BACKGROUND,
            preference: 'webgl',
            antialias: true,
            autoDensity: true,
            resolution: Math.min(window.devicePixelRatio, 2),
        });
        host.append(app.canvas);

        return new Scene(app);
    }

    /** Where the readout in the top left corner ends, in CSS pixels. */
    get readoutBottom(): number {
        return this.readout.y + this.readout.height;
    }

    /** The renderer, as the readout names it. */
    get rendererName(): string {
        return 'gl' in this.app.renderer ? 'WebGL2' : 'WebGPU';
    }

    /** Makes a skeleton of an asset with the options of the scene. */
    private make(asset: MarrowAsset): MarrowSpine {
        return new MarrowSpine(asset, { ...this.options, autoUpdate: false });
    }

    /** Makes a skeleton clickable: a press selects it and starts a move. */
    private wire(entry: Entry): void {
        const { spine } = entry;

        spine.eventMode = 'static';
        spine.interactiveChildren = false;
        spine.cursor = 'grab';
        spine.hitArea = entry.frame;
        spine.on('pointerdown', (event: FederatedPointerEvent) => {
            if (event.button !== 0) return;
            this.select(entry);
            this.gizmo.grab(event, 'move-free');
        });
        // The gizmo ends a drag when it hears the release itself. Pixi sends the release to what
        // was pressed, the skeleton here, so the skeleton hands it on
        const release = (event: FederatedPointerEvent): void => {
            this.gizmo.emit('pointerup', event);
        };

        spine.on('pointerup', release);
        spine.on('pointerupoutside', release);
        spine.on('pointercancel', release);
    }

    /**
     * Adds a skeleton of an asset at a point of the world, or right of what stands there.
     *
     * @returns The entry of the skeleton.
     */
    add(name: string, asset: MarrowAsset, at?: { x: number; y: number }): Entry {
        const spine = this.make(asset);
        const { frame, skin } = firstPicture(spine);
        const label = new SilkText({ ...TEXT_STYLE, fill: 0xd4d4d8, align: 'center', anchor: { x: 0.5, y: 0 } });
        const entry: Entry = {
            id: this.nextId++,
            name,
            asset,
            spine,
            label,
            frame,
            animation: firstAnimation(spine),
            loop: true,
            speed: 1,
            skin,
            updateMs: 0,
            home: at ?? { x: this.rightEdge() - frame.x, y: -frame.y - frame.height / 2 },
        };
        const place = entry.home;

        spine.position.set(place.x, place.y);
        if (entry.animation !== null) spine.play(entry.animation, { loop: true });
        this.wire(entry);
        this.world.addChild(spine);
        this.labels.addChild(label);
        this.entries.push(entry);

        return entry;
    }

    /** Where the next skeleton goes: right of every skeleton that stands, with a gap. */
    private rightEdge(): number {
        let right = 0;

        for (const { spine, frame } of this.entries) {
            right = Math.max(right, spine.x + (frame.x + frame.width * (1 + GAP)) * Math.abs(spine.scale.x));
        }

        return right;
    }

    /**
     * Places every skeleton in rows, each in a box of its own size with a gap, so that none
     * overlaps and a small rig does not get the cell of a big one. The rows are about as wide as
     * the canvas is wide for their height. Every skeleton keeps its own size.
     */
    arrange(): void {
        const boxes = this.entries.map(({ frame }) => ({
            width: frame.width * (1 + GAP),
            height: frame.height * (1 + GAP),
        }));
        const area = boxes.reduce((sum, box) => sum + box.width * box.height, 0);
        const aspect = this.app.screen.width / Math.max(1, this.app.screen.height);
        const rowWidth = Math.max(Math.sqrt(area * aspect), ...boxes.map((box) => box.width));
        let x = 0;
        let y = 0;
        let rowHeight = 0;

        for (const [index, entry] of this.entries.entries()) {
            const { frame } = entry;
            const box = boxes[index] ?? { width: 0, height: 0 };

            if (x > 0 && x + box.width > rowWidth) {
                x = 0;
                y += rowHeight;
                rowHeight = 0;
            }
            entry.home = {
                x: x + box.width / 2 - frame.x - frame.width / 2,
                y: y + box.height / 2 - frame.y - frame.height / 2,
            };
            this.resetTransform(entry);
            x += box.width;
            rowHeight = Math.max(rowHeight, box.height);
        }
        this.fit();
    }

    /** Puts a skeleton back where it was placed, at its own size and not turned. */
    resetTransform(entry: Entry): void {
        entry.spine.position.set(entry.home.x, entry.home.y);
        entry.spine.scale.set(1);
        entry.spine.rotation = 0;
    }

    /** Frames every skeleton. */
    fit(): void {
        // room for the readout above and the labels below
        if (this.entries.length > 0)
            this.camera.fit(this.world, { top: this.topInset + 16, right: 32, bottom: 72, left: 32 }, true);
    }

    /** Frames one skeleton. */
    focus(entry: Entry): void {
        const box = entry.spine.getBounds();
        const corner = this.camera.screenToWorld({ x: box.minX, y: box.minY });
        const far = this.camera.screenToWorld({ x: box.maxX, y: box.maxY });

        // a wide margin: the skeleton fills about half of the canvas and moves inside it
        const margin = Math.min(this.app.screen.width, this.app.screen.height) / 4;

        this.camera.fit({ x: corner.x, y: corner.y, width: far.x - corner.x, height: far.y - corner.y }, margin, true);
    }

    /** Adds copies of a skeleton around it, with its animation, skin and speed. */
    duplicate(entry: Entry, copies: number): void {
        const { spine, frame } = entry;
        const columns = Math.ceil(Math.sqrt(copies + 1));
        const stepX = frame.width * 0.6 * Math.abs(spine.scale.x);
        const stepY = frame.height * 0.6 * Math.abs(spine.scale.y);

        for (let i = 1; i <= copies; i++) {
            const copy = this.add(entry.name, entry.asset, {
                x: spine.x + (i % columns) * stepX,
                y: spine.y + Math.floor(i / columns) * stepY,
            });

            copy.spine.scale.copyFrom(spine.scale);
            copy.spine.rotation = spine.rotation;
            copy.speed = entry.speed;
            if (entry.skin !== null) this.setSkin(copy, entry.skin);
            if (entry.animation !== null) this.play(copy, entry.animation, entry.loop);
            // copies start at other points of the loop, as a crowd does
            copy.spine.update(i * 0.137);
        }
    }

    /** Takes a skeleton away. */
    remove(entry: Entry): void {
        const at = this.entries.indexOf(entry);

        if (at === -1) return;
        if (this.selected === entry) this.select(null);
        this.entries.splice(at, 1);
        entry.spine.destroy();
        entry.label.destroy();
    }

    /** Takes every skeleton away. */
    clear(): void {
        for (const entry of [...this.entries]) this.remove(entry);
    }

    /** Selects a skeleton, or none. The gizmo follows the selection. */
    select(entry: Entry | null): void {
        if (this.selected === entry) return;
        this.selected = entry;
        this.gizmo.attach(entry?.spine ?? null);
        this.onSelect(entry);
    }

    get selection(): Entry | null {
        return this.selected;
    }

    /** The box of a skeleton on screen, in CSS pixels: its setup frame, moved, turned and scaled. */
    screenBox(entry: Entry): Rectangle {
        const { spine, frame } = entry;
        const corners = [
            spine.toGlobal({ x: frame.x, y: frame.y }),
            spine.toGlobal({ x: frame.x + frame.width, y: frame.y }),
            spine.toGlobal({ x: frame.x, y: frame.y + frame.height }),
            spine.toGlobal({ x: frame.x + frame.width, y: frame.y + frame.height }),
        ];
        const xs = corners.map((corner) => corner.x);
        const ys = corners.map((corner) => corner.y);
        const left = Math.min(...xs);
        const top = Math.min(...ys);

        return new Rectangle(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
    }

    /** The tools the gizmo shows. */
    get gizmoMode(): GizmoMode {
        return this.gizmo.state.mode.value;
    }

    /** Switches the tools of the gizmo. */
    setGizmoMode(mode: GizmoMode): void {
        this.gizmo.state.mode.value = mode;
    }

    /** Plays an animation on a skeleton. */
    play(entry: Entry, animation: string, loop: boolean): void {
        entry.animation = animation;
        entry.loop = loop;
        entry.spine.play(animation, { loop });
    }

    /** Shows a skin of a skeleton. */
    setSkin(entry: Entry, skin: string): void {
        entry.skin = skin;
        entry.spine.skin = skin;
    }

    /**
     * Makes every skeleton again with other options: the skinning and the preset are fixed when a
     * skeleton is made. Each keeps its place, animation, skin and speed.
     */
    remake(options: MarrowSpineOptions): void {
        this.options = options;
        for (const entry of this.entries) {
            const old = entry.spine;
            const spine = this.make(entry.asset);

            spine.position.copyFrom(old.position);
            spine.scale.copyFrom(old.scale);
            spine.rotation = old.rotation;
            entry.spine = spine;
            if (entry.skin !== null) spine.skin = entry.skin;
            if (entry.animation !== null) spine.play(entry.animation, { loop: entry.loop });
            this.wire(entry);
            this.world.addChildAt(spine, this.world.getChildIndex(old));
            old.destroy();
        }
        if (this.selected !== null) this.gizmo.attach(this.selected.spine);
    }

    /** One frame: updates and times every skeleton, then places the labels. */
    private step(): void {
        const seconds = Math.min(this.app.ticker.deltaMS / 1000, 0.1);
        let total = 0;

        for (const entry of this.entries) {
            const start = performance.now();

            entry.spine.update(seconds * entry.speed);
            const ms = performance.now() - start;

            total += ms;
            entry.updateMs += (ms - entry.updateMs) * 0.1;
        }
        this.totals.update += (total - this.totals.update) * 0.1;
        this.frames++;
        const refresh = this.frames % TEXT_EVERY === 0;

        for (const entry of this.entries) this.placeLabel(entry, refresh);
        this.unstackLabels();
        if (refresh) this.writeReadout();
    }

    /**
     * Hides every label that would cover one shown before it, so that close skeletons do not
     * pile their numbers up. A crowd shows no labels, and neither does a scene with a selected
     * skeleton: its controls show its numbers, and nothing else sits under them.
     */
    private unstackLabels(): void {
        const { selected } = this;

        if (selected !== null || this.entries.length > MAX_LABELS) {
            for (const entry of this.entries) entry.label.visible = false;

            return;
        }
        const shown: Rectangle[] = [];

        for (const { label } of this.entries) {
            if (!label.visible) continue;
            const box = label.getBounds().rectangle;

            if (shown.some((other) => other.intersects(box))) label.visible = false;
            else shown.push(box.clone());
        }
    }

    /** Puts the label of a skeleton under it on screen, and writes its numbers now and then. */
    private placeLabel(entry: Entry, refresh: boolean): void {
        const { spine, frame, label } = entry;
        const left = spine.toGlobal({ x: frame.x, y: frame.y + frame.height });
        const right = spine.toGlobal({ x: frame.x + frame.width, y: frame.y + frame.height });
        const wide = Math.hypot(right.x - left.x, right.y - left.y) >= LABEL_MIN_WIDTH;

        label.visible = wide;
        if (!label.visible) return;
        label.position.set(Math.round((left.x + right.x) / 2), Math.round(Math.max(left.y, right.y) + 6));
        if (!refresh) return;
        label.text = this.describe(entry);
    }

    /** The numbers of a skeleton in three short lines: name and version, size, and cost. */
    describe(entry: Entry): string {
        const { info, stats } = entry.spine;

        return [
            `${entry.name}  ${info.version}`,
            `${info.bones.length} bones, ${stats.vertices} vertices`,
            `${stats.renderMode}, ${stats.drawCalls} draw${stats.drawCalls === 1 ? '' : 's'}, ${entry.updateMs.toFixed(3)} ms`,
        ].join('\n');
    }

    /** Writes the numbers of the whole scene in the corner. */
    private writeReadout(): void {
        const { totals } = this;
        const vertices = this.entries.reduce((sum, entry) => sum + entry.spine.stats.vertices, 0);
        const skinning = this.options.skinning === 'gpu' ? 'GPU skinning' : 'CPU skinning';

        totals.fps = this.app.ticker.FPS;
        // a narrow canvas breaks the lines of the readout
        this.readout.wordWrap = true;
        this.readout.wordWrapWidth = this.app.screen.width - 24;
        this.readout.text = [
            `${totals.fps.toFixed(0)} fps, update ${totals.update.toFixed(2)} ms, render ${totals.render.toFixed(2)} ms`,
            `${totals.draws} draw calls with labels and buttons, ${this.entries.length} skeletons, ${vertices} vertices`,
            `${this.rendererName}, ${String(this.options.perf ?? 'exact')}, ${skinning}`,
        ].join('\n');
    }

    /** Renders and times the render, and counts its draw calls. */
    private render(): void {
        const start = performance.now();

        this.draws.count = 0;
        this.app.render();
        this.totals.render += (performance.now() - start - this.totals.render) * 0.1;
        this.totals.draws = this.draws.count;
    }
}
