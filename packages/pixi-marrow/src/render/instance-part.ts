import { Buffer, BufferUsage, Geometry, type Shader, type TextureSource } from 'pixi.js';
import type { InstanceLayout, Union } from './instance-layout';
import type { InstanceBody } from './instance-paint';
import type { InstancePool } from './instance-pool';

/*
 * One instanced draw of a run, with what it drew with last: its buffer of instance data, the
 * geometries of the draw orders it drew lately, and its shader. A run keeps a part per draw of
 * a frame, see `instance-pipe.ts`.
 */

/** Numbers of instance data per instance: three columns of the transform, the color and three bases. */
const INSTANCE_STRIDE = 16;

/** The instance data of one member before it is compared with what a part holds: as numbers, and as bits. */
const NEXT = new Float32Array(INSTANCE_STRIDE);
const NEXT_WORDS = new Uint32Array(NEXT.buffer);

/** The geometries a part keeps, one per draw order it drew with lately. */
const KEPT_GEOMETRIES = 4;

/**
 * A geometry on buffers that other geometries share: the buffers of a layout and the index
 * buffer of a draw order. Before 8.21, pixi.js destroys the index buffer of a geometry with the
 * geometry. It also leaves the geometry among the listeners of its other buffers.
 */
class SharedGeometry extends Geometry {
    /** Frees what the renderer holds for the geometry, and no buffer. */
    release(): void {
        for (const buffer of this.buffers) {
            buffer.off('update', this.onBufferUpdate, this);
            buffer.off('change', this.onBufferUpdate, this);
        }
        Reflect.set(this, 'indexBuffer', undefined);
        this.destroy();
    }
}

/** What the shader of a draw is made for: the layout, the pool, the pages and the variant. */
export interface Shaded {
    layout: InstanceLayout;
    pool: InstancePool;
    pages: readonly TextureSource[];
    dark: boolean;
    round: boolean;
}

/** Whether two draws take the same shader. */
const sameShader = (a: Shaded | undefined, b: Shaded): boolean =>
    a !== undefined &&
    a.layout === b.layout &&
    a.pool === b.pool &&
    a.pages === b.pages &&
    a.dark === b.dark &&
    a.round === b.round;

/**
 * One instanced draw of a run, with what it drew with last.
 *
 * @example
 * const part = new RunPart();
 * part.write(0, body);
 * renderer.encoder.draw({ geometry: part.geometry(layout, union), shader: part.shade(want), instanceCount: 1 });
 */
export class RunPart {
    readonly buffer: Buffer;
    private data = new Float32Array(INSTANCE_STRIDE * 4);
    private words = new Uint32Array(this.data.buffer);
    /** Whether the instance data holds bits the GPU does not have yet. */
    private changed = true;
    private readonly geometries: SharedGeometry[] = [];
    private readonly unions: Union[] = [];
    private shader: Shader | undefined;
    /** What {@link shader} was made for. */
    private shaded: Shaded | undefined;

    constructor() {
        this.buffer = new Buffer({
            data: this.data,
            label: 'marrow-instance-data',
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        });
    }

    /** Writes the instance data of a member at a place of the draw. */
    write(at: number, body: InstanceBody): void {
        const slot = body.paint.slot;

        if (slot === undefined) return;
        if ((at + 1) * INSTANCE_STRIDE > this.data.length) this.grow((at + 1) * 2);
        const { words } = this;
        const { a, b, c, d, tx, ty } = body.groupTransform;
        const color = body.groupColorAlpha;
        const alpha = ((color >> 24) & 255) / 255;
        const o = at * INSTANCE_STRIDE;

        // the matrix and the color Pixi hands a mesh as `uTransformMatrix` and `uColor`
        NEXT[0] = a;
        NEXT[1] = b;
        NEXT[2] = 0;
        NEXT[3] = c;
        NEXT[4] = d;
        NEXT[5] = 0;
        NEXT[6] = tx;
        NEXT[7] = ty;
        NEXT[8] = 1;
        NEXT[9] = ((color & 255) / 255) * alpha;
        NEXT[10] = (((color >> 8) & 255) / 255) * alpha;
        NEXT[11] = (((color >> 16) & 255) / 255) * alpha;
        NEXT[12] = alpha;
        NEXT_WORDS[13] = slot.poseBase;
        NEXT_WORDS[14] = slot.paletteBase;
        NEXT_WORDS[15] = slot.cpuBase;
        // a skeleton that rests where it was uploads nothing: the bits are compared
        for (let k = 0; k < INSTANCE_STRIDE; k++) {
            if (words[o + k] === NEXT_WORDS[k]) continue;
            words.set(NEXT_WORDS, o);
            this.changed = true;

            return;
        }
    }

    /** Uploads the instance data when a member wrote other bits than the GPU holds. */
    upload(): void {
        if (!this.changed) return;
        this.changed = false;
        this.buffer.update();
    }

    /** The geometry of a layout and a draw order on the instance data of this part. */
    geometry(layout: InstanceLayout, union: Union): Geometry {
        const kept = this.unions.indexOf(union);

        if (kept >= 0) {
            const found = this.geometries[kept];

            if (found !== undefined) return found;
        }
        if (this.geometries.length >= KEPT_GEOMETRIES) {
            this.geometries.shift()?.release();
            this.unions.shift();
        }
        const instance = (offset: number, format: 'float32x3' | 'float32x4' | 'uint32x3') => ({
            buffer: this.buffer,
            format,
            stride: INSTANCE_STRIDE * 4,
            offset,
            instance: true,
        });
        const geometry = new SharedGeometry({
            attributes: {
                aUV: { buffer: layout.statics, format: 'float32x2', stride: 12, offset: 0 },
                aFlags: { buffer: layout.statics, format: 'unorm8x4', stride: 12, offset: 8 },
                aSkin: { buffer: layout.skin, format: 'uint32x2', stride: 8, offset: 0 },
                aEntry: { buffer: layout.entries, format: 'uint32x2', stride: 8, offset: 0 },
                iMatrix0: instance(0, 'float32x3'),
                iMatrix1: instance(12, 'float32x3'),
                iMatrix2: instance(24, 'float32x3'),
                iColor: instance(36, 'float32x4'),
                iBase: instance(52, 'uint32x3'),
            },
            indexBuffer: union.buffer,
        });

        this.geometries.push(geometry);
        this.unions.push(union);

        return geometry;
    }

    /**
     * The shader of a draw. The layout keeps its shaders, and the part asks it again when the
     * draw is another one, or when the pool grew and has other textures.
     */
    shade(want: Shaded): Shader {
        const { shader, shaded: was } = this;

        if (shader !== undefined && sameShader(was, want) && shader.resources?.uPose === want.pool.pose) return shader;
        this.shaded = { ...want };
        this.shader = want.layout.shader(want.pool, want.pages, want.dark, want.round);

        return this.shader;
    }

    /** Frees the buffer of instance data and the geometries. The other buffers and the shaders belong to the layouts. */
    destroy(): void {
        for (const geometry of this.geometries) geometry.release();
        this.geometries.length = 0;
        this.unions.length = 0;
        this.buffer.destroy();
    }

    private grow(instances: number): void {
        const data = new Float32Array(instances * INSTANCE_STRIDE);

        data.set(this.data);
        this.data = data;
        this.words = new Uint32Array(data.buffer);
        this.buffer.data = data;
        this.changed = true;
    }
}
