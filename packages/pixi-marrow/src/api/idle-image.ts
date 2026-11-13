import { Bounds, Container, getLocalBounds, Matrix, type Renderer, RenderTexture, Sprite, Texture } from 'pixi.js';
import { i32 } from '../geometry/read';
import { BLEND_MODES, type SkeletonModel } from '../model/model';
import type { PoseState } from '../pose/state';
import { drawsPlain } from '../render/gate';
import { u8 } from '../render/read';
import type { SkeletonView } from '../render/skeleton-view';
import type { IdleCache, IdleCode } from './idle-cache';
import {
    createPlacement,
    imageToSpace,
    type Placement,
    pixelBox,
    placeOf,
    spaceToImage,
    wholeMove,
} from './idle-place';

/*
 * The idle cache: a skeleton at rest drawn as one image. This is a chunk that loads on demand,
 * see `idle-cache.ts`.
 *
 * A display object with `idleCache: 'auto'` counts its updates in which nothing that its picture
 * depends on changed: the version of the pose, the layout and the render mode of the view. At
 * IDLE_WAIT such updates in a row it starts to watch its renders. Once two renders in a row put
 * it at the same place, the next update draws the view into a render texture. From then on the
 * view is hidden and a sprite with that texture shows in its place, in the space of the display
 * object. The sprite draws one quad in Pixi's batch.
 *
 * The image is drawn on the pixel grid of the target, see `idle-place.ts`, so it equals the
 * live picture. The view keeps its own state up to date while it is hidden. The image is
 * dropped, and the view shows again in the same frame:
 *
 * - by an update that changes the pose, the layout or the render mode, or that attaches a container,
 * - by a render that puts the skeleton elsewhere than whole pixels away, by another renderer,
 *   after the WebGL context came back, with an alpha or a blend mode above it, or to a
 *   multisampled target.
 *
 * A multisampled target keeps the skeleton live. Its image would hold 4 samples a pixel, five
 * times the memory, and samples on the edge of a triangle tie far more often than pixel centers.
 *
 * The image is drawn in an update, outside of a render. It goes through one private container
 * that is a render group: the view container moves into it for the draw and back. Pixi then
 * builds the instructions of the render group of the display object again, which puts the
 * batch element of the skeleton back into its own batch once it shows again.
 */

/**
 * Updates in a row with nothing changed before a skeleton is drawn into an image. At 60 updates
 * a second that is half a second. An image costs a draw into a texture and two builds of the
 * instructions of the render group. A skeleton that rests for a few frames between two
 * animations should not pay that.
 */
export const IDLE_WAIT = 30;
/** The largest width and height of an image in pixels. A skeleton larger on the screen draws live. */
export const IDLE_MAX_SIDE = 2048;
/** Pixels added around the bounds of the skeleton, for an edge the rasterizer rounds outward. */
const MARGIN = 1;
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
const MULTIPLY = BLEND_MODES.indexOf('multiply');
const SCREEN = BLEND_MODES.indexOf('screen');

/** The label of the sprite that shows the image, and that tools look for. */
const IDLE_LABEL = 'marrow-idle';

/** The container every view is drawn through into its image. A render group, made at the first image. */
let studio: Container | undefined;
const bounds = new Bounds();
const matrix = new Matrix();

/**
 * The textures of images that were dropped, shrunk to 1 by 1 pixel. Pixi keeps a group of
 * bindings for every set of textures it batched, for good,
 * and pixi.js 8.23 warns when a texture in such a group is destroyed. So a texture of an image is
 * never destroyed. Shrinking it lets go of its pixels, and the next image takes it again. There
 * are never more of them than images that showed at one time.
 */
const spares: RenderTexture[] = [];

/** A texture for an image of this many pixels: a spare one, or a new one. */
function takeTexture(width: number, height: number): RenderTexture {
    const texture = spares.pop();

    if (texture === undefined || texture.destroyed) {
        return RenderTexture.create({ width, height, resolution: 1, scaleMode: 'nearest' });
    }
    texture.source.resize(width, height, 1);

    return texture;
}

/** Lets go of the pixels of a texture, and keeps it for the next image. */
function spareTexture(texture: RenderTexture): void {
    texture.source.resize(1, 1, 1);
    spares.push(texture);
}

/** How often the WebGL context of a renderer came back. An image drawn before that holds nothing. */
const restores = new WeakMap<Renderer, { count: number }>();

function restoresOf(renderer: Renderer): number {
    let seen = restores.get(renderer);

    if (seen === undefined) {
        const counter = { count: 0 };

        seen = counter;
        restores.set(renderer, counter);
        renderer.runners.contextChange.add({
            contextChange(): void {
                counter.count++;
            },
        });
    }

    return seen.count;
}

/** An image that shows, and where it was drawn. */
interface Image {
    readonly texture: RenderTexture;
    readonly place: Placement;
    readonly renderer: Renderer;
    /** The count of {@link restoresOf} of its renderer when it was drawn. */
    readonly restores: number;
}

/** The idle cache of one display object, see the top of this file. */
class IdleImage implements IdleCache {
    private readonly owner: Container;
    private readonly view: SkeletonView;
    private readonly state: PoseState;
    /** True when a slot of the skeleton has a dark color. */
    private readonly dark: boolean;
    /** Updates in a row in which nothing changed that the picture depends on. */
    private rest = 0;
    /** What the picture depends on, as the last update saw it. Nothing yet: the first update counts as a change. */
    private version = -1;
    private builds = 0;
    private mode = '';
    private choice = '';
    /** Shows the image and hears about every render while it is set. Made when the first image is due. */
    private sprite: Sprite | undefined;
    /** The placement of the render now, and of the one before. */
    private readonly now = createPlacement();
    private readonly last = createPlacement();
    private lastBy: Renderer | null = null;
    /** The renderer whose last two renders put the skeleton at the same place: it can draw the image. */
    private ready: Renderer | null = null;
    private image: Image | null = null;
    /** True when the pose at rest shows a slot that an image cannot hold. It waits for a change. */
    private refused = false;
    private destroyed = false;
    private readonly onSeen = (renderer: Renderer): void => this.seen(renderer);

    constructor(owner: Container, view: SkeletonView, state: PoseState) {
        this.owner = owner;
        this.view = view;
        this.state = state;
        this.dark = state.model.slots.hasDark.includes(1);
    }

    update(): void {
        const { view, state } = this;
        const { stats } = view;
        const same =
            state.version === this.version &&
            stats.templateBuilds === this.builds &&
            stats.renderMode === this.mode &&
            view.renderMode === this.choice;
        // a container between the slots draws on its own, and a skeleton that shows nothing needs no image
        const fits = (view.inserts?.containers.length ?? 0) === 0 && stats.drawCalls > 0;

        if (!same || !fits) {
            this.note();
            this.drop();
            this.rest = 0;
            this.refused = false;
            this.watch(false);

            return;
        }
        if (this.image !== null || this.refused) return;
        this.rest++;
        if (this.rest === IDLE_WAIT && !blendsAlone(view, state.model)) this.refused = true;
        const due = this.rest >= IDLE_WAIT && !this.refused;

        this.watch(due);
        if (due && this.ready !== null) this.capture(this.ready);
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.drop();
        if (this.sprite === undefined) return;
        this.sprite.onRender = null;
        this.sprite.destroy();
    }

    /** Notes what the picture depends on now. */
    private note(): void {
        const { view } = this;

        this.version = this.state.version;
        this.builds = view.stats.templateBuilds;
        this.mode = view.stats.renderMode;
        this.choice = view.renderMode;
    }

    /** Starts or stops hearing about renders. Called in updates only: Pixi walks its list of callbacks during a render. */
    private watch(on: boolean): void {
        const { sprite } = this;

        if (on) {
            const shown = this.sprite ?? this.createSprite();

            if (shown.onRender === null) shown.onRender = this.onSeen;

            return;
        }
        if (sprite !== undefined && sprite.onRender !== null && this.image === null) sprite.onRender = null;
        this.lastBy = null;
        this.ready = null;
    }

    /** The sprite of the image, hidden, right after the view container. */
    private createSprite(): Sprite {
        const { owner } = this;
        const sprite = new Sprite({ texture: Texture.EMPTY, label: IDLE_LABEL, visible: false });

        owner.addChildAt(sprite, owner.getChildIndex(this.view.container) + 1);
        this.sprite = sprite;

        return sprite;
    }

    /**
     * What a render tells: where the skeleton lands on its target. A shown image is dropped when
     * it would not be exact there. Before an image, two renders in a row at the same place make
     * the next update draw one.
     */
    private seen(renderer: Renderer): void {
        const target = renderer.renderTarget.renderTarget;
        const { now, last, image, owner } = this;

        const multisampled = target.colorTextures[0]?.antialias === true;

        placeOf(owner, target.resolution, now);
        if (image !== null) {
            const kept =
                renderer === image.renderer &&
                restoresOf(renderer) === image.restores &&
                !multisampled &&
                drawsPlain(owner) &&
                this.untinted() &&
                wholeMove(now, image.place);

            // the view shows again in this render: Pixi builds the instructions after the callbacks
            if (!kept) {
                this.drop();
                this.rest = 0;
            }

            return;
        }
        const still = this.lastBy === renderer && wholeMove(now, last);
        const lost = 'gl' in renderer && renderer.gl.isContextLost();

        last.set(now);
        this.lastBy = renderer;
        // an alpha or a blend mode above the skeleton blends each slot, which an image cannot
        this.ready = still && !lost && !multisampled && drawsPlain(owner) && this.untinted() ? renderer : null;
    }

    /**
     * True unless a tint above the skeleton meets a dark color. The shaders tint the light color
     * of a slot alone, and the sprite would tint the dark color in the image too.
     */
    private untinted(): boolean {
        if (!this.dark) return true;
        for (let node: Container | null = this.owner; node !== null; node = node.parent) {
            if (node.tint !== 0xffffff) return false;
        }

        return true;
    }

    /** Draws the view into a texture at the place of the last render, and shows it in place of the view. */
    private capture(renderer: Renderer): void {
        const { owner, view, last } = this;
        const { container } = view;
        const box = pixelBox(getLocalBounds(container, bounds), last, MARGIN);

        this.ready = null;
        // a context lost since the render would leave the image empty: the next render asks again
        if ('gl' in renderer && renderer.gl.isContextLost()) return;
        if (box.width <= 0 || box.height <= 0 || box.width > IDLE_MAX_SIDE || box.height > IDLE_MAX_SIDE) {
            this.rest = 0;

            return;
        }
        const texture = takeTexture(box.width, box.height);
        const index = owner.getChildIndex(container);

        studio ??= new Container({ isRenderGroup: true, label: 'marrow-idle-studio' });
        matrix.set(...spaceToImage(last, box.x, box.y));
        studio.addChild(container);
        try {
            renderer.render({ container: studio, target: texture, clear: true, clearColor: CLEAR, transform: matrix });
        } catch (error) {
            spareTexture(texture);
            throw error;
        } finally {
            owner.addChildAt(container, index);
        }
        this.show(texture, box.x, box.y, renderer);
        // a draw can lay the vertex ranges out again, which changes no pixel
        this.note();
    }

    /** Hides the view and shows an image whose top left corner is at a pixel of the target. */
    private show(texture: RenderTexture, x: number, y: number, renderer: Renderer): void {
        const { owner, last } = this;
        const sprite = this.sprite ?? this.createSprite();
        const { container } = this.view;

        container.visible = false;
        sprite.texture = texture;
        sprite.setFromMatrix(matrix.set(...imageToSpace(last, x, y)));
        sprite.visible = true;
        // the sprite draws where the view would, also after the children of the display object moved
        if (owner.children[owner.getChildIndex(container) + 1] !== sprite) {
            owner.removeChild(sprite);
            owner.addChildAt(sprite, owner.getChildIndex(container) + 1);
        }
        this.image = { texture, place: Float64Array.from(last), renderer, restores: restoresOf(renderer) };
    }

    /** Shows the view again and lets go of the pixels of the image. */
    private drop(): void {
        const { image, sprite } = this;

        if (image === null || sprite === undefined) return;
        this.image = null;
        this.view.container.visible = true;
        sprite.visible = false;
        sprite.texture = Texture.EMPTY;
        spareTexture(image.texture);
    }
}

/**
 * Whether every visible slot of a view blends with the slots below it alone. Normal and additive
 * slots do: drawn into an empty image and then over the background, they give the same color as
 * drawn over the background one by one. A slot that multiplies or screens blends with what lies
 * behind the skeleton too, and an image has nothing behind it.
 */
function blendsAlone(view: SkeletonView, model: SkeletonModel): boolean {
    const { template, seen } = view.parts;
    const { blendModes } = model.slots;

    for (let i = 0; i < seen.count; i++) {
        const blend = u8(blendModes, i32(template.slots, i32(seen.list, i)));

        if (blend === MULTIPLY || blend === SCREEN) return false;
    }

    return true;
}

/**
 * Creates the idle cache of a display object.
 *
 * @example
 * const cache = idleCode.create(spine, view, engine.state);
 * cache.update();
 */
export const idleCode: IdleCode = {
    create: (owner, view, state) => new IdleImage(owner, view, state),
};
