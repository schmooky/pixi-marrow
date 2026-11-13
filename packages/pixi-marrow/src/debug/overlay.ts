import { Container } from 'pixi.js';
import { SilkGraphics } from 'pixi-silk';
import { SilkText } from 'pixi-silk/text';
import { enableWebGPU } from 'pixi-silk/webgpu';
import type { MarrowEvent } from '../api/options';
import type { MarrowSpine } from '../api/spine';
import { viewOf } from '../api/view-of';
import { MarrowError } from '../base/errors';
import { createAttachmentLookup } from '../pose/shared/lookup';
import { drawnTriangles } from './drawn';
import { boxBounds, collectShapes, type DebugShapes, type PathShape, type RegionOffsets } from './shapes';

/** One thing the overlays can draw. */
export type DebugLayer =
    | 'bones'
    | 'origin'
    | 'regions'
    | 'meshHulls'
    | 'meshTriangles'
    | 'boundingBoxes'
    | 'clipping'
    | 'paths'
    | 'points'
    | 'events'
    | 'overdraw';

/** Options of {@link MarrowDebug}. */
export interface DebugOptions {
    /** Which layers draw. A layer left out takes its value from {@link DEBUG_LAYERS}. */
    layers?: Partial<Record<DebugLayer, boolean>>;
    /** The color of each layer, as `0xRRGGBB`. A layer left out takes its color from {@link DEBUG_COLORS}. */
    colors?: Partial<Record<DebugLayer, number>>;
    /** The width of lines on the screen, in pixels, whatever the scale of the skeleton. Default 1. */
    lineWidth?: number;
}

/** The layers that draw unless the options say otherwise: the ones the official debug renderer draws, without the noisy ones. */
export const DEBUG_LAYERS: Readonly<Record<DebugLayer, boolean>> = Object.freeze({
    bones: true,
    origin: true,
    regions: true,
    meshHulls: true,
    meshTriangles: false,
    boundingBoxes: true,
    clipping: true,
    paths: true,
    points: true,
    events: false,
    overdraw: false,
});

/** The colors of the layers. Those that the official debug renderer has are its colors. */
export const DEBUG_COLORS: Readonly<Record<DebugLayer, number>> = Object.freeze({
    bones: 0x00eecc,
    origin: 0xff0000,
    regions: 0x0078ff,
    meshHulls: 0x0078ff,
    meshTriangles: 0xffcc00,
    boundingBoxes: 0x00ff00,
    clipping: 0xff00ff,
    paths: 0xff0000,
    points: 0xffffff,
    events: 0xffffff,
    overdraw: 0xff6020,
});

const LAYER_NAMES = Object.keys(DEBUG_LAYERS) as DebugLayer[];
/** How long an event label shows, in milliseconds. */
const LABEL_LIFE = 1000;
/** The alpha of one triangle in the overdraw layer: four layers of triangles reach full color. */
const HEAT_ALPHA = 0.25;

/** Checks a layer name, so that a typo throws instead of drawing nothing. */
function checkLayers(values: Partial<Record<string, unknown>> | undefined, what: string): void {
    for (const name of Object.keys(values ?? {})) {
        if (!LAYER_NAMES.includes(name as DebugLayer)) {
            throw new MarrowError('invalid-data', `MarrowDebug has no layer "${name}" for ${what}.`, {
                fix: `Use one of: ${LAYER_NAMES.join(', ')}.`,
                validNames: LAYER_NAMES,
            });
        }
    }
}

/**
 * Debug overlays of one skeleton: its bones, the shapes of its attachments, its bounding boxes,
 * clipping polygons, paths, point attachments and events, and the triangles it draws. The
 * overlay is a child of the skeleton, on top of what the skeleton draws, in its space. It draws
 * with `SilkGraphics` and `SilkText` of pixi-silk, an optional peer that this entry needs.
 *
 * It draws the pose of the last update with the geometry of the official runtime. It draws again
 * only when the pose, a layer, a color or the scale on the screen changed. A skeleton at rest
 * costs one check per render. Lines keep their width on the screen whatever the scale.
 *
 * The overdraw layer fills every triangle the skeleton draws, after the cuts of overdraw, with a
 * color that adds up. Where it is bright, the GPU paints a pixel many times. Clipping is not applied there.
 *
 * @example
 * const debug = new MarrowDebug(hero, { layers: { meshTriangles: true, overdraw: true } });
 * debug.layers.bones = false;
 * debug.destroy();
 */
export class MarrowDebug extends Container {
    /** Which layers draw. A change shows with the next render. */
    readonly layers: Record<DebugLayer, boolean>;
    /** The color of each layer as `0xRRGGBB`. A change shows with the next render. */
    readonly colors: Record<DebugLayer, number>;
    /** The width of lines on the screen, in pixels. */
    lineWidth: number;
    private readonly spine: MarrowSpine;
    private readonly lines: SilkGraphics;
    private readonly dots: SilkGraphics;
    private readonly heat: SilkGraphics;
    private readonly labels = new Container();
    private readonly offsets: RegionOffsets = new Map();
    /** What the last drawing was made for. */
    private drawnFor = { version: -1, scale: 0, settings: '' };
    private readonly born = new Map<SilkText, number>();
    private readonly onEvent = (event: MarrowEvent): void => this.addLabel(String(event.name));

    constructor(spine: MarrowSpine, options: DebugOptions = {}) {
        super({ label: 'marrow-debug' });
        checkLayers(options.layers, 'layers');
        checkLayers(options.colors, 'colors');
        this.spine = spine;
        this.layers = { ...DEBUG_LAYERS, ...options.layers };
        this.colors = { ...DEBUG_COLORS, ...options.colors };
        this.lineWidth = options.lineWidth ?? 1;
        // the WGSL program of pixi-silk, before its first object, so that a WebGPU renderer draws them too
        enableWebGPU();
        this.lines = new SilkGraphics({ minStrokePx: 1 });
        this.dots = new SilkGraphics();
        this.heat = new SilkGraphics();
        this.heat.blendMode = 'add';
        // the overlay shows what is there, and takes no pointer events away from the skeleton
        this.eventMode = 'none';
        this.addChild(this.heat, this.lines, this.dots, this.labels);
        spine.addChild(this);
        spine.on('event', this.onEvent);
        this.onRender = () => this.refresh();
    }

    /**
     * Draws the overlays now when something changed since the last drawing. Each render calls
     * it, so a game need not. It moves the event labels on too.
     */
    refresh(): void {
        this.age();
        const { state } = this.spine.engine;
        const transform = this.worldTransform;
        const scale = Math.hypot(transform.a, transform.b) || 1;
        const settings = this.settings();
        const last = this.drawnFor;

        if (last.version === state.version && last.scale === scale && last.settings === settings) return;
        this.drawnFor = { version: state.version, scale, settings };
        this.draw(scale);
    }

    override destroy(options?: Parameters<Container['destroy']>[0]): void {
        this.spine.off('event', this.onEvent);
        this.onRender = null;
        this.born.clear();
        super.destroy({ children: true, ...(typeof options === 'object' ? options : {}) });
    }

    /** The layers, colors and width as text, to see when one of them changed. */
    private settings(): string {
        let text = `${this.lineWidth}`;

        for (const name of LAYER_NAMES) text += `${this.layers[name] ? 1 : 0}${this.colors[name]}`;

        return text;
    }

    private draw(scale: number): void {
        const { layers, lines, dots, heat } = this;
        const { asset } = this.spine;
        const { state } = this.spine.engine;
        const shapes = collectShapes(state, createAttachmentLookup(asset.model), asset.atlas, this.offsets);
        const pixel = 1 / scale;

        lines.clear();
        dots.clear();
        heat.clear();
        if (layers.overdraw) this.drawHeat();
        if (layers.regions) this.polygons(shapes.regions, 'regions', pixel);
        if (layers.meshTriangles) this.triangles(shapes, pixel);
        if (layers.meshHulls) this.polygons(shapes.hulls, 'meshHulls', pixel);
        if (layers.clipping) this.polygons(shapes.clips, 'clipping', pixel);
        if (layers.boundingBoxes) this.boxes(shapes.boxes, pixel);
        if (layers.paths) this.paths(shapes.paths, pixel);
        if (layers.points) this.points(shapes.points, pixel);
        if (layers.bones) this.bones(shapes.bones, pixel);
        if (layers.origin) this.drawOrigin(state.x, state.y, pixel);
        this.labels.visible = layers.events;
    }

    private stroke(layer: DebugLayer, pixel: number): void {
        this.lines.stroke({ width: this.lineWidth * pixel, color: this.colors[layer] });
    }

    private polygons(list: readonly Float64Array[], layer: DebugLayer, pixel: number): void {
        if (list.length === 0) return;
        for (const points of list) this.lines.poly(Array.from(points), true);
        this.stroke(layer, pixel);
    }

    private triangles(shapes: DebugShapes, pixel: number): void {
        const { triangles } = shapes;

        if (triangles.length === 0) return;
        for (let i = 0; i + 5 < triangles.length; i += 6) {
            this.lines.poly(triangles.slice(i, i + 6), true);
        }
        this.stroke('meshTriangles', pixel);
    }

    private boxes(boxes: readonly Float64Array[], pixel: number): void {
        this.polygons(boxes, 'boundingBoxes', pixel);
        const around = boxBounds(boxes);

        if (around === null) return;
        this.lines.rect(...around);
        this.stroke('boundingBoxes', pixel);
    }

    /** The curves of the paths and the lines to their handles, as the official debug renderer draws them. */
    private paths(paths: readonly PathShape[], pixel: number): void {
        if (paths.length === 0) return;
        const { lines } = this;
        const handles: number[] = [];

        for (const { points: world, closed } of paths) {
            const at = (i: number): number => world[i] ?? 0;
            let n = world.length;
            let [x1, y1] = [at(2), at(3)];

            if (closed) {
                lines.moveTo(x1, y1).bezierCurveTo(at(0), at(1), at(n - 2), at(n - 1), at(n - 4), at(n - 3));
                handles.push(x1, y1, at(0), at(1), at(n - 4), at(n - 3), at(n - 2), at(n - 1));
            }
            n -= 4;
            for (let i = 4; i < n; i += 6) {
                const [x2, y2] = [at(i + 4), at(i + 5)];

                lines.moveTo(x1, y1).bezierCurveTo(at(i), at(i + 1), at(i + 2), at(i + 3), x2, y2);
                handles.push(x1, y1, at(i), at(i + 1), x2, y2, at(i + 2), at(i + 3));
                [x1, y1] = [x2, y2];
            }
        }
        this.stroke('paths', pixel);
        for (let i = 0; i + 3 < handles.length; i += 4) {
            lines.moveTo(handles[i] ?? 0, handles[i + 1] ?? 0).lineTo(handles[i + 2] ?? 0, handles[i + 3] ?? 0);
        }
        this.stroke('paths', pixel);
    }

    /** A dot and a short line in the direction of the rotation of every point attachment. */
    private points(points: readonly number[], pixel: number): void {
        if (points.length === 0) return;
        const { lines, dots } = this;
        const reach = 12 * pixel;

        for (let i = 0; i + 3 < points.length; i += 4) {
            const [x, y, dx, dy] = [points[i] ?? 0, points[i + 1] ?? 0, points[i + 2] ?? 0, points[i + 3] ?? 0];

            lines.moveTo(x, y).lineTo(x + dx * reach, y + dy * reach);
            dots.circle(x, y, 2.5 * pixel);
        }
        this.stroke('points', pixel);
        dots.fill(this.colors.points);
    }

    /** A line along every bone and a dot at its start. A bone without length is a dot. */
    private bones(bones: readonly number[], pixel: number): void {
        if (bones.length === 0) return;
        const { lines, dots } = this;

        for (let i = 0; i + 3 < bones.length; i += 4) {
            const [x, y, tipX, tipY] = [bones[i] ?? 0, bones[i + 1] ?? 0, bones[i + 2] ?? 0, bones[i + 3] ?? 0];

            if (tipX !== x || tipY !== y) lines.moveTo(x, y).lineTo(tipX, tipY);
            dots.circle(x, y, 2 * pixel);
        }
        this.lines.stroke({ width: 2 * this.lineWidth * pixel, color: this.colors.bones });
        dots.fill(this.colors.bones);
    }

    /** A cross at the origin of the skeleton. */
    private drawOrigin(x: number, y: number, pixel: number): void {
        const size = 8 * pixel;

        this.lines
            .moveTo(x - size, y)
            .lineTo(x + size, y)
            .moveTo(x, y - size)
            .lineTo(x, y + size);
        this.stroke('origin', pixel);
    }

    /** Every triangle the skeleton draws, filled with a color that adds up where they overlap. */
    private drawHeat(): void {
        const view = viewOf(this.spine);

        if (view === undefined) return;
        const triangles = drawnTriangles(view);
        const style = { color: this.colors.overdraw, alpha: HEAT_ALPHA };

        // one fill per triangle, so that overlapping triangles of one slot add up too
        for (let i = 0; i + 5 < triangles.length; i += 6) this.heat.poly(triangles.slice(i, i + 6), true).fill(style);
    }

    /** Shows the name of an event that fired, at the origin of the skeleton. It rises and fades. */
    private addLabel(name: string): void {
        if (!this.layers.events) return;
        const transform = this.worldTransform;
        const pixel = 1 / (Math.hypot(transform.a, transform.b) || 1);
        const text = new SilkText({
            text: name,
            fontSize: 16,
            fontWeight: 600,
            fill: this.colors.events,
            outline: { width: 2, color: 0x000000 },
        });

        text.scale.set(pixel);
        text.position.set(this.spine.engine.state.x, this.spine.engine.state.y);
        this.labels.addChild(text);
        this.born.set(text, performance.now());
    }

    /** Moves the event labels up, fades them, and lets the old ones go. */
    private age(): void {
        if (this.born.size === 0) return;
        const now = performance.now();

        for (const [text, born] of this.born) {
            const age = (now - born) / LABEL_LIFE;

            if (age >= 1) {
                this.born.delete(text);
                text.destroy();
                continue;
            }
            text.alpha = 1 - age;
            text.y = this.spine.engine.state.y - age * 40 * text.scale.y;
        }
    }
}
