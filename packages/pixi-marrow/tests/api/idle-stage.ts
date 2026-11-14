import { Container, type Matrix, type Renderer, type RenderTexture } from 'pixi.js';
import { viewOf } from '../../src/api/view-of';
import type { MarrowSpine } from '../../src/index';
import type { ImageBody } from '../../src/render/batch-image';
import { FRAME } from './helpers';

/*
 * A stage for the tests of the idle cache: a renderer as far as the cache uses one, and frames
 * of an update and a render. Pixi calls the `onRender` callbacks of a render group at the start
 * of a render, and so does `frame` here. What a real render draws is the business of the scenes
 * `idle-` of the render check.
 */

/** What the fake renderer was asked to draw. */
interface FakeRender {
    readonly target: RenderTexture;
    readonly transform: Matrix;
    /** Whether the view container was the only child of the container that was rendered. */
    readonly viewInside: boolean;
    readonly clear: boolean | undefined;
}

/** A renderer that records its draws, and whose WebGL context can be lost and restored. */
export interface FakeRenderer {
    readonly renderer: Renderer;
    readonly renders: FakeRender[];
    /** Loses the context, or gives it back and tells the listeners as Pixi does. */
    lose(): void;
    restore(): void;
}

/**
 * A renderer for the idle cache: a target with a resolution, a context to lose, the runner that
 * tells about a restored context, and a `render` that records what it was given.
 */
export function fakeRenderer(spine: MarrowSpine, resolution = 1, antialias = false): FakeRenderer {
    const listeners: { contextChange(): void }[] = [];
    const renders: FakeRender[] = [];
    const context = { lost: false };
    const view = viewOf(spine)?.container;
    const fake = {
        gl: { isContextLost: () => context.lost },
        renderTarget: { renderTarget: { resolution, colorTextures: [{ antialias }] } },
        // the pipe of the batched mode, which the body of an image draws through, is put in here
        renderPipes: {},
        runners: {
            contextChange: { add: (item: { contextChange(): void }) => listeners.push(item) },
            destroy: { add: () => {} },
            prerender: { add: () => {} },
        },
        render(options: { container: Container; target: RenderTexture; transform: Matrix; clear?: boolean }): void {
            const { container, target, transform, clear } = options;

            renders.push({
                target,
                transform: transform.clone(),
                viewInside: container.children.length === 1 && container.children[0] === view,
                clear,
            });
        },
    };

    return {
        renderer: fake as unknown as Renderer,
        renders,
        lose(): void {
            context.lost = true;
        },
        restore(): void {
            context.lost = false;
            for (const listener of listeners) listener.contextChange();
        },
    };
}

/**
 * The label of the body of an image: `IDLE_LABEL` of `idle-image.ts`. It is written out here,
 * because a test of a chunk that does not load cannot import that module.
 */
const IDLE_LABEL = 'marrow-idle';

/** The body that shows the image of a display object, once it has one. */
export function idleSprite(spine: MarrowSpine): ImageBody | undefined {
    return spine.children.find((child): child is ImageBody => child.label === IDLE_LABEL);
}

/** The view container of a display object. */
export function viewContainer(spine: MarrowSpine): Container {
    const container = viewOf(spine)?.container;

    if (container === undefined) throw new Error('the display object has no view');

    return container;
}

/** Whether a display object shows its image: the view is hidden and the body shows. */
export function cached(spine: MarrowSpine): boolean {
    const sprite = idleSprite(spine);

    return sprite?.visible === true && !viewContainer(spine).visible;
}

/** A render as far as the idle cache sees one: Pixi calls `onRender` with the renderer. */
export function render(spine: MarrowSpine, fake: FakeRenderer): void {
    idleSprite(spine)?.onRender?.(fake.renderer);
}

/** One frame: an update, then a render. */
export function frame(spine: MarrowSpine, fake: FakeRenderer, seconds = FRAME): void {
    spine.update(seconds);
    render(spine, fake);
}

/** Frames until the display object shows its image, at most `limit`. Returns how many it took, or -1. */
export function framesUntilCached(spine: MarrowSpine, fake: FakeRenderer, limit = 100): number {
    for (let count = 1; count <= limit; count++) {
        frame(spine, fake);
        if (cached(spine)) return count;
    }

    return -1;
}

/** A stage: a container without a parent, the root of a render, that holds the display object. */
export function stageOf(spine: MarrowSpine): Container {
    const stage = new Container();

    stage.addChild(spine);

    return stage;
}
