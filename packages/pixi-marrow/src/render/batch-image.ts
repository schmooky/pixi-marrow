import {
    type Batch,
    type BatchableElement,
    type Batcher,
    type BLEND_MODES,
    type Bounds,
    Texture,
    type TextureSource,
    type Topology,
    ViewContainer,
} from 'pixi.js';
import { BATCHER, type BatchHome, DARK_BATCHER, PIPE_ID } from './batch-element';
import { POSITION_WORDS, STATIC_WORDS } from './batch-layout';
import { NO_DARK } from './batch-pack';

/*
 * An image in a batch of the batched mode: one quad with one texture. The idle cache shows a
 * skeleton at rest as such an image. A sprite of Pixi would draw in Pixi's own batch, and every
 * change between that batch and ours is a draw call. In a grid of symbols the images and the
 * live skeletons take turns, so the images draw in our batches instead.
 *
 * The quad is placed as Pixi places the quad of a sprite: the transform of the body inside its
 * render group, applied to the corners of the texture frame. It draws with the shader of the
 * batched mode, which colors a texel as Pixi's batch shader does.
 */

/** The vertices and the indices of a quad. */
const VERTICES = 4;
const INDICES = 6;
/** The flag of a vertex that is rounded to pixels, see `batch-pack.ts`. */
const ROUND_FLAG = 0xff0000;
/** An opaque white light color: the texel as it is. */
const WHITE = 0xffffffff | 0;

/** The display object of an image in a batch, as its element reads it. */
export interface ImagePlace {
    /** The transform, the tint and the blend mode inside the render group, as Pixi computed them last. */
    readonly groupTransform: { a: number; b: number; c: number; d: number; tx: number; ty: number };
    readonly groupColorAlpha: number;
    readonly groupBlendMode: BLEND_MODES;
}

/**
 * One textured quad as an element of a batch of the batched mode. The batcher gives it its
 * place and the number of its texture in the batch, and the element writes itself there.
 *
 * @example
 * const element = new ImageElement(body);
 * element.texture = texture;
 * element.prepare(false, false);
 * renderer.renderPipes.batch.addToBatch(element, instructionSet);
 */
export class ImageElement implements BatchableElement {
    /** Marks a quad for the batcher and the pipe, which know this class by its type alone: it loads with the idle cache. */
    readonly quad = true;
    /** The batcher that draws the quad: the one with dark colors when the batch before is of that one. */
    batcherName: string = BATCHER;
    texture: Texture = Texture.EMPTY;
    blendMode: BLEND_MODES = 'normal';
    readonly indexSize: number = INDICES;
    readonly attributeSize: number = VERTICES;
    readonly topology: Topology = 'triangle-list';
    readonly packAsQuad = false;
    _textureId = 0;
    _attributeStart = 0;
    _indexStart = 0;
    declare _batcher: Batcher;
    declare _batch: Batch;
    /** The texture source the batch binds for the quad, as the last build of the instructions saw it. */
    bound: TextureSource | null = null;
    private readonly place: ImagePlace;
    private round = false;
    private staticWords = STATIC_WORDS;
    /** The batcher the quad was written into, or null before the first build. */
    private home: BatchHome | null = null;

    constructor(place: ImagePlace) {
        this.place = place;
    }

    /** Readies the element for a build of the instructions: rounding, the batcher and the blend mode. */
    prepare(round: boolean, dark: boolean): void {
        this.round = round;
        this.batcherName = dark ? DARK_BATCHER : BATCHER;
        this.staticWords = dark ? STATIC_WORDS + 1 : STATIC_WORDS;
        this.blendMode = this.place.groupBlendMode;
    }

    /** Whether the quad can join a batch: the same blend mode, and its texture or room for it. */
    fits(batch: Batch, maxTextures: number): boolean {
        const { textures } = batch;

        return (
            batch.blendMode === this.blendMode &&
            (textures.ids[this.texture.source.uid] != null || textures.count < maxTextures)
        );
    }

    /**
     * Joins a batch: binds the texture there and writes the quad into the room the batcher gave
     * it. The batcher calls it when it builds the batches.
     */
    enter(home: BatchHome, batch: Batch): void {
        const { textures } = batch;
        const { source } = this.texture;
        let id = textures.ids[source.uid];

        if (id == null) {
            id = textures.count++;
            textures.ids[source.uid] = id;
            textures.textures[id] = source;
        }
        this._batch = batch;
        batch.elements.push(this);
        this.write(home, id);
    }

    /** Writes the quad into its room, with its texture at number `texture` of the batch. */
    private write(home: BatchHome, texture: number): void {
        this.home = home;
        this._textureId = texture;
        this.bound = this.texture.source;
        const vertex = this._attributeStart / POSITION_WORDS;
        const indices = home.indexBuffer;
        const at = this._indexStart;

        indices[at] = vertex;
        indices[at + 1] = vertex + 1;
        indices[at + 2] = vertex + 2;
        indices[at + 3] = vertex;
        indices[at + 4] = vertex + 2;
        indices[at + 5] = vertex + 3;
        this.sync();
    }

    /**
     * Writes the positions, the texture coordinates, the tint and the flags of the quad again, and
     * tells the batcher what to upload. A move or another tint of the display object calls it.
     */
    sync(): void {
        const { home, texture } = this;

        if (home === null) return;
        const { a, b, c, d, tx, ty } = this.place.groupTransform;
        const { width, height } = texture.frame;
        const positions = home.attributeBuffer.float32View;
        const vertex = this._attributeStart / POSITION_WORDS;
        const words = this.staticWords;
        const base = vertex * words;
        const flags = this._textureId | (this.round ? ROUND_FLAG : 0);
        const { uvs } = texture;
        const corners = [0, 0, width, 0, width, height, 0, height];
        const coords = [uvs.x0, uvs.y0, uvs.x1, uvs.y1, uvs.x2, uvs.y2, uvs.x3, uvs.y3];

        for (let i = 0; i < VERTICES; i++) {
            const x = Number(corners[i * 2]);
            const y = Number(corners[i * 2 + 1]);
            const to = this._attributeStart + i * POSITION_WORDS;
            const from = base + i * words;

            // the arithmetic of Pixi for the quad of a sprite
            positions[to] = a * x + c * y + tx;
            positions[to + 1] = d * y + b * x + ty;
            home.statics[from] = Number(coords[i * 2]);
            home.statics[from + 1] = Number(coords[i * 2 + 1]);
            home.staticBytes[from + 2] = WHITE;
            home.staticBytes[from + 3] = this.place.groupColorAlpha;
            home.staticBytes[from + 4] = flags;
            // black with an alpha of 1 tints nothing, see `batch-pack.ts`
            if (words > STATIC_WORDS) home.staticBytes[from + 5] = NO_DARK;
        }
        home.touchPositions(this._attributeStart, VERTICES * POSITION_WORDS);
        home.touchStatics(base, VERTICES * words);
        home.touchIndices(this._indexStart, INDICES);
    }
}

/**
 * The display object of an image in a batch. It draws nothing itself: Pixi hands it to the pipe
 * of the batched mode, which puts its {@link element} into the batch of the render group. Its
 * transform places the texture frame, as the transform of a sprite does.
 *
 * The pipe must be in the renderer before Pixi collects the body: `linkRenderer` of
 * `batch-pipe.ts` puts it there.
 *
 * @example
 * const body = new ImageBody();
 * body.show(texture);
 * owner.addChild(body);
 */
export class ImageBody extends ViewContainer {
    override readonly renderPipeId: string = PIPE_ID;
    /** Pixi reads it of every view. The body always draws in a batch. */
    batched = true;
    /** The quad as the batcher sees it. */
    readonly element: ImageElement;

    constructor(label: string) {
        super({ label, visible: false });
        this.element = new ImageElement(this);
    }

    /** The texture the body shows. */
    get texture(): Texture {
        return this.element.texture;
    }

    set texture(texture: Texture) {
        if (texture === this.element.texture) return;
        this.element.texture = texture;
        this.onViewUpdate();
    }

    /** The texture frame in the space of the body. */
    override get bounds(): Bounds {
        const { width, height } = this.element.texture.frame;
        const box = this._bounds;

        box.minX = 0;
        box.minY = 0;
        box.maxX = width;
        box.maxY = height;

        return box;
    }

    /** The bounds follow the texture, so there is nothing to compute here. */
    protected override updateBounds(): void {}
}
