import {
    Batch,
    type BatchableElement,
    type BatchableMeshElement,
    Batcher,
    type BatcherOptions,
    Buffer,
    BufferUsage,
    type ExtensionMetadata,
    ExtensionType,
    Geometry,
    type InstructionSet,
    type Shader,
} from 'pixi.js';
import { MarrowError } from '../base/errors';
import { BATCHER, BatchElement, type BatchHome, DARK_BATCHER } from './batch-element';
import { GROUP_PAGES, POSITION_WORDS, STATIC_WORDS } from './batch-layout';
import { createBatchShader } from './batch-shader';
import { PendingUpload, uploadsStretch } from './batch-upload';

/*
 * The batcher of the batched mode. Pixi creates one per render group when the first skeleton of
 * the group is collected, by the name the elements carry. It differs from the batcher of Pixi in
 * what the batched mode needs:
 *
 * - An element is a whole skeleton, with up to 16 pages of its atlas per batch. Pixi's batcher
 *   knows one texture per element.
 * - Normal and additive slots draw in one batch, with the premultiplied shader. A batch ends
 *   where a skeleton multiplies or screens, where the textures run out, and where Pixi draws
 *   something else in between.
 * - A batch is an instruction of the pipe of the batched mode, so that the pipe sees it before
 *   it draws. The pipe then hands it to the batch pipe of Pixi, which draws it like every batch.
 * - An element writes its own data. The batcher gives it its place and never packs for it.
 * - A vertex lives in two buffers. Pixi uploads the buffer of a batcher in every frame in which
 *   an element changed, so that one holds positions and nothing else. Texture coordinates,
 *   colors and flags are in a buffer of the batcher, which uploads when one of them changed.
 */

/** The name of the render pipe that runs the batches. See `batch-pipe.ts`. */
export const PIPE_ID = 'marrow';

/** The most vertices 16-bit indices can point at. */
const NARROW = 65535;

/** The vertices the static buffer of a new batcher has room for. */
const FIRST_ROOM = 64;

/** A Pixi vertex buffer that keeps its size when its data shrinks. */
const vertexBuffer = (data: Float32Array, label: string): Buffer =>
    new Buffer({ data, label, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST, shrinkToFit: false });

/**
 * The geometry all batches of one batcher draw: the positions, which Pixi fills, the static
 * vertex data and the indices.
 */
function createGeometry(statics: Buffer, dark: boolean): Geometry {
    const stride = (dark ? STATIC_WORDS + 1 : STATIC_WORDS) * 4;
    const positions = vertexBuffer(new Float32Array(POSITION_WORDS), 'marrow-batch-positions');
    const indexBuffer = new Buffer({
        data: new Uint16Array(2),
        label: 'marrow-batch-indices',
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
    });

    return new Geometry({
        attributes: {
            // the first attribute: Pixi takes the first buffer of the geometry for what it uploads
            aPosition: { buffer: positions, format: 'float32x2', stride: POSITION_WORDS * 4, offset: 0 },
            aUV: { buffer: statics, format: 'float32x2', stride, offset: 0 },
            aColor: { buffer: statics, format: 'unorm8x4', stride, offset: 8 },
            aTint: { buffer: statics, format: 'unorm8x4', stride, offset: 12 },
            aFlags: { buffer: statics, format: 'unorm8x4', stride, offset: 16 },
            ...(dark ? { aDark: { buffer: statics, format: 'unorm8x4', stride, offset: 20 } } : {}),
        },
        indexBuffer,
    });
}

/**
 * Batches skeletons without dark colors. Pixi finds the class by its name once it was added to
 * the extensions, which the batched mode does at its first use.
 *
 * @example
 * extensions.add(MarrowBatcher);
 * renderer.renderPipes.batch.addToBatch(element, instructionSet);
 */
export class MarrowBatcher extends Batcher implements BatchHome {
    /** How Pixi registers the class. */
    static extension: ExtensionMetadata = { type: [ExtensionType.Batcher], name: BATCHER };
    /**
     * The most textures a batch samples when Pixi creates a batcher without saying so, as
     * pixi.js before 8.17 does. The pipe sets it from the renderer before it adds an element.
     */
    static textures = 16;

    name: string;
    geometry: Geometry;
    shader: Shader;
    serial = 0;
    statics: Float32Array;
    staticBytes: Uint32Array;
    /** The Pixi buffer of {@link statics}. */
    readonly staticBuffer: Buffer;
    /** 32-bit words per vertex in {@link statics}. */
    readonly staticWords: number;
    /** Words per vertex in the buffer Pixi uploads: the position alone. */
    protected vertexSize: number = POSITION_WORDS;
    /** The elements that were added since the last break. Valid up to {@link waiting}. */
    private readonly pending: (BatchElement | undefined)[] = [];
    private waiting = 0;
    /** The batches of all builds. A build uses them from the first one on. */
    private readonly pool: Batch[] = [];
    private used = 0;
    /** What the static vertex data and the index data must upload before the next draw. */
    private readonly staticsPending: PendingUpload;
    private readonly indicesPending: PendingUpload;

    constructor(options?: BatcherOptions, dark: boolean = false) {
        super({ ...options, maxTextures: options?.maxTextures ?? MarrowBatcher.textures });
        this.name = dark ? DARK_BATCHER : BATCHER;
        this.staticWords = dark ? STATIC_WORDS + 1 : STATIC_WORDS;
        this.statics = new Float32Array(FIRST_ROOM * this.staticWords);
        this.staticBytes = new Uint32Array(this.statics.buffer);
        this.staticBuffer = vertexBuffer(this.statics, 'marrow-batch-statics');
        this.geometry = createGeometry(this.staticBuffer, dark);
        this.shader = createBatchShader(this.maxTextures, dark);
        this.staticsPending = new PendingUpload(uploadsStretch(this.staticBuffer.update));
        this.indicesPending = new PendingUpload(uploadsStretch(this.staticBuffer.update));
    }

    /** Whether elements wait for the next break: the batch that is being built is one of this batcher. */
    get filling(): boolean {
        return this.waiting > 0;
    }

    /** Whether the vertices of the batcher carry a dark color. */
    get dark(): boolean {
        return this.staticWords > STATIC_WORDS;
    }

    /** Starts a build of the instructions: the buffers are filled from their start. */
    override begin(): void {
        super.begin();
        this.serial++;
        this.used = 0;
        // Pixi uploads the indices at the end of a build
        this.indicesPending.clear();
        this.pending.fill(undefined, 0, this.waiting);
        this.waiting = 0;
    }

    /** Gives an element its place in the buffers. Throws a `MarrowError` for an element of another library. */
    override add(element: BatchableElement): void {
        if (!(element instanceof BatchElement)) {
            throw new MarrowError('invalid-data', `The batcher "${this.name}" got an element that is no skeleton.`, {
                fix: 'Give the batch elements of other display objects another batcherName.',
            });
        }
        this.pending[this.waiting++] = element;
        this.elementSize++;
        element._indexStart = this.indexSize;
        element._attributeStart = this.attributeSize;
        element._batcher = this;
        this.indexSize += element.indexSize;
        this.attributeSize += element.attributeSize * this.vertexSize;
    }

    /**
     * Ends the batches of the elements that were added since the last break: every element
     * writes itself into the buffers, and the batches go into the instruction set.
     */
    override break(instructionSet: InstructionSet): void {
        const { pending, waiting } = this;
        const first = pending[0];
        let batch: Batch | undefined;

        if (waiting === 0 || first === undefined) return;
        let cursor = first._indexStart;

        this.ensureAttributeBuffer(this.attributeSize);
        this.reserveStatics();
        this.reserveIndices();
        for (let i = 0; i < waiting; i++) {
            const element = pending[i];

            pending[i] = undefined;
            if (element === undefined) continue;
            if (batch === undefined || !this.fits(batch, element)) {
                if (batch !== undefined) batch.size = cursor - batch.start;
                batch = this.open(instructionSet, element.blendOf(0), cursor, batch === undefined);
            }
            this.enter(batch, element, 0);
            // the later runs are batches that start with their pages, so every page has its number now
            if (element.runs > 1) element.alignPages();
            element._batch = batch;
            element.pack(this);
            for (let run = 0; run < element.runs; run++) {
                if (run > 0) {
                    batch.size = cursor - batch.start;
                    batch = this.open(instructionSet, element.blendOf(run), cursor, false);
                    this.enter(batch, element, run);
                }
                element.batches[run] = batch;
                cursor += Number(element.runSizes[run]);
            }
            element.batches.length = element.runs;
        }
        if (batch !== undefined) batch.size = cursor - batch.start;
        this.waiting = 0;
        this.elementStart = this.elementSize;
    }

    /** Notes a stretch of the static vertex data that changed. {@link flush} uploads it. */
    touchStatics(from: number, words: number): void {
        this.staticsPending.add(from, words);
    }

    /** Notes a stretch of the index data that changed. {@link flush} uploads it. */
    touchIndices(from: number, count: number): void {
        // WebGPU writes from a multiple of 4 bytes on, which is an even 16-bit index
        const start = this.indexBuffer.BYTES_PER_ELEMENT === 2 ? from & ~1 : from;

        this.indicesPending.add(start, from + count - start);
    }

    /**
     * Uploads what changed since Pixi uploaded the buffers. The pipe calls it before a batch
     * draws: Pixi uploads the positions earlier in a frame, and nothing else.
     */
    flush(): void {
        if (this.dirty) {
            this.dirty = false;
            this.geometry.buffers[0]?.update(this.attributeSize * 4);
        }
        this.staticsPending.flush(this.staticBuffer, 4, (this.attributeSize / POSITION_WORDS) * this.staticWords);
        this.indicesPending.flush(this.geometry.indexBuffer, this.indexBuffer.BYTES_PER_ELEMENT, this.indexSize);
    }

    /** Pixi's batcher packs an element here. An element of the batched mode writes itself. */
    override packAttributes(element: BatchableMeshElement): void {
        if (element instanceof BatchElement) element.sync();
    }

    /** Skeletons are no quads. */
    override packQuadAttributes(): void {}

    /** Frees the buffers. The shader is shared and stays. */
    override destroy(): void {
        this.serial = -1;
        this.pool.length = 0;
        this.pending.length = 0;
        this.waiting = 0;
        super.destroy();
    }

    /**
     * Whether an element can join a batch with its first run: the same blend mode, and room for
     * the pages of the run that the batch does not hold yet.
     *
     * A skeleton with more than one run writes one texture number per page into its vertices,
     * and its later runs are batches that start with their pages. So its first run joins a batch
     * only where that batch holds the pages at the same numbers. That is the case after another
     * instance of the same skeleton.
     */
    private fits(batch: Batch, element: BatchElement): boolean {
        const { textures } = batch;
        const { pages } = element;
        const first = element.firstPage(0);
        const end = Math.min(first + GROUP_PAGES, pages.length);
        let missing = 0;
        let aligned = true;

        if (batch.blendMode !== element.blendOf(0)) return false;
        for (let index = first; index < end; index++) {
            const id = textures.ids[pages[index]?.uid ?? -1];

            if (id == null) missing++;
            if (id !== index - first) aligned = false;
        }

        return element.runs > 1 ? aligned : textures.count + missing <= this.maxTextures;
    }

    /** The next batch of the build, set up for a blend mode and without textures. */
    private open(instructionSet: InstructionSet, blendMode: Batch['blendMode'], start: number, first: boolean): Batch {
        let batch = this.pool[this.used];

        if (batch === undefined) {
            batch = new Batch();
            batch.renderPipeId = PIPE_ID;
            batch.topology = 'triangle-list';
            batch.batcher = this;
            batch.elements = [];
            this.pool[this.used] = batch;
        }
        this.used++;
        batch.textures.clear();
        batch.elements.length = 0;
        // the bind group of the batch before is that of other textures
        Object.assign(batch, { bindGroup: null, gpuBindGroup: null });
        batch.action = first ? 'startBatch' : 'renderBatch';
        batch.blendMode = blendMode;
        batch.start = start;
        batch.size = 0;
        instructionSet.add(batch);

        return batch;
    }

    /**
     * Puts a run of an element into a batch: the batch gets the pages of the run, and the element
     * learns where they are bound. Throws a `MarrowError` when the batch cannot hold them.
     */
    private enter(batch: Batch, element: BatchElement, run: number): void {
        const { textures } = batch;
        const { pages } = element;
        const first = element.firstPage(run);
        const end = Math.min(first + GROUP_PAGES, pages.length);

        for (let index = first; index < end; index++) {
            const page = pages[index];

            if (page === undefined) continue;
            let id = textures.ids[page.uid];

            if (id == null) {
                id = textures.count++;
                textures.ids[page.uid] = id;
                textures.textures[id] = page;
            }
            element.bindPage(index, id);
        }
        if (textures.count > this.maxTextures) {
            throw new MarrowError(
                'invalid-data',
                `A batch of this renderer samples ${this.maxTextures} textures, and a skeleton needs ${end - first} of its atlas pages at once.`,
                { fix: 'Create the display object with renderMode "mesh".' },
            );
        }
        batch.elements.push(element);
    }

    /** Makes room for the static data of the vertices of the build. What earlier breaks wrote stays. */
    private reserveStatics(): void {
        const needed = (this.attributeSize / POSITION_WORDS) * this.staticWords;

        if (needed > this.statics.length) {
            const next = new Float32Array(Math.max(needed, this.statics.length * 2));

            next.set(this.statics);
            this.statics = next;
            this.staticBytes = new Uint32Array(next.buffer);
            this.staticBuffer.data = next;
        }
        // the elements of this break write next, and the pipe uploads before the batch draws
        this.staticsPending.whole = true;
    }

    /** Makes room for the indices of the build. They are 32-bit once they point past 65,535 vertices. */
    private reserveIndices(): void {
        const current = this.indexBuffer;
        const wide = current.BYTES_PER_ELEMENT === 4 || this.attributeSize / this.vertexSize > NARROW;

        if (current.length >= this.indexSize && wide === (current.BYTES_PER_ELEMENT === 4)) return;
        // an even count keeps a 16-bit index buffer a multiple of 4 bytes, which WebGPU asks for
        const room = Math.max(this.indexSize, Math.ceil(current.length * 1.5));
        const next = wide ? new Uint32Array(room + (room & 1)) : new Uint16Array(room + (room & 1));

        next.set(current.subarray(0, Math.min(current.length, next.length)));
        this.indexBuffer = next;
    }
}

/**
 * Batches skeletons with dark colors: a vertex carries 4 more bytes, and the shader tints with
 * two colors.
 *
 * @example
 * extensions.add(MarrowDarkBatcher);
 */
export class MarrowDarkBatcher extends MarrowBatcher {
    /** How Pixi registers the class. */
    static override extension: ExtensionMetadata = { type: [ExtensionType.Batcher], name: DARK_BATCHER };

    constructor(options?: BatcherOptions) {
        super(options, true);
    }
}
