import { Buffer, BufferUsage, type Shader, type TextureSource } from 'pixi.js';
import { i16, i32 } from '../geometry/read';
import type { SkeletonModel } from '../model/model';
import { InstancePool, NO_ENTRY, type PoolShape, type PoolSlot } from './instance-pool';
import { createInstanceShader } from './instance-shader';
import { ownsStatics } from './layouts';
import { u8, u16 } from './read';
import type { SkinLayout } from './skin-layout';
import { MAX_PAGES, type Template } from './template';

/*
 * What the instanced views of one layout share, next to its skin data: the vertex buffers of an
 * instanced draw, an index buffer per draw order, the pools of their poses and the shaders.
 *
 * The index buffer of a draw order holds every entry of every slot, in that order: the union of
 * what any instance can show. A slot shows one of its entries, so the vertex shader drops the
 * others, see `instance-shader.ts`. The union is one draw range when no slot of the layout
 * multiplies or screens and the atlas has at most 8 pages. A layout that needs more ranges does
 * not draw instanced: one draw per range would draw the second range of the first instance
 * after the first range of the second one. Where instances overlap, the picture would change.
 */

/** Why the views of a layout draw alone: a slot multiplies or screens, more than 8 pages, or too many entries. */
export type LayoutBlock = 'blend' | 'pages' | 'size';

/** The slot blend modes that need a blend state of their own. Indices into `BLEND_MODES`. */
const MULTIPLY = 2;
const SCREEN = 3;

/** The most index buffers of draw orders that no view uses a layout keeps. */
const SPARE_UNIONS = 8;

/** The flag of `aEntry` that takes the texture coordinates from the texel of the vertex. */
const FROM_TEXEL = 0x80000000;

/** The index buffer of one draw order: every entry of every slot of the layout. */
export interface Union {
    readonly order: Int16Array;
    readonly hash: number;
    readonly buffer: Buffer;
    /** Indices in the buffer. */
    readonly count: number;
    /** Views that draw with it. */
    uses: number;
}

/** A number for a draw order, so that most draw orders are told apart without a look at every slot. */
function hashOf(order: Int16Array): number {
    let hash = 2166136261;

    for (let i = 0; i < order.length; i++) hash = Math.imul(hash ^ (i16(order, i) & 0xffff), 16777619);

    return hash >>> 0;
}

/** Whether two draw orders are the same. */
function sameOrder(a: Int16Array, b: Int16Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;

    return true;
}

/** Per model: the slots a deform timeline can reach. A model never changes after its import. */
const deformable = new WeakMap<SkeletonModel, Uint8Array>();

/**
 * The slots whose mesh can have a deform: the slots of every deform timeline, and in 4.3 every
 * slot a mesh hands its timelines on to. It is more than what can deform, never less.
 */
function deformSlots(model: SkeletonModel): Uint8Array {
    let slots = deformable.get(model);

    if (slots !== undefined) return slots;
    slots = new Uint8Array(model.slots.count);
    for (const animation of model.animations) {
        for (const timeline of animation.timelines) if (timeline.kind === 'deform') slots[timeline.target] = 1;
    }
    for (const skin of model.skins) {
        for (const { attachment } of skin.attachments) {
            if (attachment.type !== 'mesh') continue;
            for (const slot of attachment.timelineSlots ?? []) slots[slot] = 1;
        }
    }
    deformable.set(model, slots);

    return slots;
}

/** Why the views of a layout cannot draw instanced, or null. */
function blockOf(template: Template, model: SkeletonModel, pages: number): LayoutBlock | null {
    if (pages > MAX_PAGES) return 'pages';
    if (template.slots.length >= NO_ENTRY) return 'size';
    for (let entry = 0; entry < template.slots.length; entry++) {
        const blend = u8(model.slots.blendModes, i32(template.slots, entry));

        if (i32(template.counts, entry) > 0 && (blend === MULTIPLY || blend === SCREEN)) return 'blend';
    }

    return null;
}

/**
 * The instanced draw of the views of one layout.
 *
 * @example
 * const shared = instanceLayout(template, model, skin, pages.length);
 * const slot = shared.take();
 * const union = shared.union(state.drawOrder);
 */
export class InstanceLayout {
    /** Why its views draw alone, or null when they can draw instanced. */
    readonly block: LayoutBlock | null;
    /** `aSkin`, the skin data of the layout. */
    readonly skin: Buffer;
    /** `aUV` and `aFlags`. A region with a sequence takes its texture coordinates from its texel. */
    readonly statics: Buffer;
    /** `aEntry`: per vertex its entry, and its texel among those the CPU places. */
    readonly entries: Buffer;
    /** Per influence: bone, x, y, weight. */
    readonly influences: TextureSource;
    /** What a pool of the layout holds per slot. */
    readonly shape: PoolShape;
    /** The pools, in the order they were made. */
    readonly pools: InstancePool[] = [];
    private readonly template: Template;
    private readonly unions: Union[] = [];
    /** The page arrays of the views, one for each set of page textures. */
    private readonly pageSets: (readonly TextureSource[])[] = [];
    private readonly shaders = new Map<string, Shader>();
    /** The pool of each shader. */
    private readonly users = new Map<Shader, InstancePool>();
    private readonly wide: boolean;

    constructor(template: Template, model: SkeletonModel, skin: SkinLayout, pages: number) {
        const usage = BufferUsage.VERTEX | BufferUsage.COPY_DST;
        const deform = deformSlots(model);
        const entries = template.slots.length;
        const cpuAt = new Int32Array(entries).fill(-1);
        const data = new Uint32Array(Math.max(template.vertexCount, 1) * 2);
        let cpuTexels = 0;

        this.template = template;
        this.block = blockOf(template, model, pages);
        this.wide = template.vertexCount > 65535;
        for (let entry = 0; entry < entries; entry++) {
            const count = i32(template.counts, entry);
            const first = i32(template.first, entry);
            const sequence = i32(template.frameCounts, entry) > 1;
            const mesh = template.sources[entry] != null;
            const cpu =
                u8(skin.placeable, entry) === 0 || sequence || (mesh && deform[i32(template.slots, entry)] === 1);

            if (cpu && count > 0) cpuAt[entry] = cpuTexels;
            for (let v = 0; v < count; v++) {
                data[(first + v) * 2] = entry;
                data[(first + v) * 2 + 1] = cpu ? (cpuTexels + v) | (sequence ? FROM_TEXEL : 0) : 0;
            }
            if (cpu) cpuTexels += count;
        }
        // the copy of a layout with a sequence holds the regions of one instance, and the shader takes no other
        const statics = ownsStatics(template) ? template.statics.slice() : template.statics;

        this.shape = { bones: model.bones.count, slots: model.slots.count, cpuTexels, cpuAt };
        this.influences = skin.influences;
        this.skin = new Buffer({ data: skin.vertices, label: 'marrow-skin', usage });
        this.statics = new Buffer({ data: statics, label: 'marrow-uvs', usage });
        this.entries = new Buffer({ data, label: 'marrow-entries', usage });
    }

    /** The bytes the views of the layout share: the buffers, the index buffers and the room of the pools no view takes. */
    get bytes(): number {
        // the statics of the template are counted with the template, unless the layout holds a copy
        const own = this.statics.data === this.template.statics ? 0 : this.statics.data.byteLength;
        let bytes = this.skin.data.byteLength + own + this.entries.data.byteLength;

        for (const union of this.unions) bytes += union.buffer.data.byteLength;
        for (const pool of this.pools) bytes += pool.bytes - pool.used * pool.slotBytes;

        return bytes;
    }

    /** A slot in a pool for one more view. A new pool starts when the others are as large as they can be. */
    take(): PoolSlot {
        for (const pool of this.pools) {
            const slot = pool.alloc();

            if (slot !== undefined) return slot;
        }
        const pool = new InstancePool(this.shape);
        const slot = pool.alloc();

        this.pools.push(pool);
        if (slot === undefined) throw new RangeError('A pool of instances has no room for one slot.');

        return slot;
    }

    /** The index buffer of a draw order, for one more view that draws with it. Give it back with {@link drop}. */
    union(order: Int16Array): Union {
        const hash = hashOf(order);
        let union: Union | undefined;

        for (const known of this.unions) if (known.hash === hash && sameOrder(known.order, order)) union = known;
        if (union === undefined) {
            union = this.build(order, hash);
            this.unions.push(union);
            this.trim();
        }
        union.uses++;

        return union;
    }

    /**
     * The array of pages that the views of the layout with the same page textures share. A view
     * has an array of its own, and an instanced draw compares the arrays.
     */
    intern(pages: readonly TextureSource[]): readonly TextureSource[] {
        for (const known of this.pageSets) {
            if (known.length === pages.length && known.every((page, i) => page === pages[i])) return known;
        }
        this.pageSets.push(pages);

        return pages;
    }

    /** Whether a union holds a draw order. */
    holds(union: Union, order: Int16Array): boolean {
        return sameOrder(union.order, order);
    }

    /** Gives a union of {@link union} back. It stays for a while, since a draw order tends to come back. */
    drop(union: Union): void {
        union.uses--;
        this.trim();
    }

    /** The shader of a pool, a set of pages and a variant. One per combination, kept with the layout. */
    shader(pool: InstancePool, pages: readonly TextureSource[], dark: boolean, round: boolean): Shader {
        const key = `${pool.id} ${dark} ${round} ${pages.map((page) => page.uid).join(' ')}`;
        let shader = this.shaders.get(key);

        if (shader === undefined) {
            shader = createInstanceShader(pages, dark, round, {
                pose: pool.pose,
                influences: this.influences,
                palette: pool.palette,
            });
            this.shaders.set(key, shader);
            this.users.set(shader, pool);
        }
        if (pool.retired.length > 0) this.repoint(pool);

        return shader;
    }

    /**
     * Points every shader of a pool that grew at its new textures, then destroys the old ones once
     * the render that runs now is over. A pool can grow inside a render, when a view lays itself out
     * again right before its draw. Draws earlier in that render bound the old textures, and WebGPU
     * submits them at its end.
     */
    private repoint(pool: InstancePool): void {
        for (const [shader, owner] of this.users) {
            // a destroyed shader has no resources
            if (owner !== pool || shader.resources === null) continue;
            shader.resources.uPose = pool.pose;
            shader.resources.uPalette = pool.palette;
        }
        const retired = pool.retired.splice(0);

        queueMicrotask(() => {
            for (const texture of retired) if (!texture.destroyed) texture.destroy();
        });
    }

    /** Frees the buffers, the pools and the shaders. The skin data belongs to the layout. */
    destroy(): void {
        // the shaders let go of the textures before those are destroyed
        for (const shader of this.shaders.values()) shader.destroy();
        this.skin.destroy();
        this.statics.destroy();
        this.entries.destroy();
        for (const union of this.unions) union.buffer.destroy();
        for (const pool of this.pools) pool.destroy();
        this.unions.length = 0;
        this.pools.length = 0;
        this.shaders.clear();
        this.users.clear();
    }

    /** Lays out the index buffer of a draw order: for each slot in that order, every entry it has. */
    private build(order: Int16Array, hash: number): Union {
        const { template } = this;
        let count = 0;

        for (let entry = 0; entry < template.slots.length; entry++) {
            if (i32(template.counts, entry) > 0) count += template.triangles[entry]?.length ?? 0;
        }
        // an even count keeps a 16-bit index buffer a multiple of 4 bytes, which WebGPU asks for
        const room = Math.max(count + (count & 1), 4);
        const indices = this.wide ? new Uint32Array(room) : new Uint16Array(room);
        let at = 0;

        for (let i = 0; i < order.length; i++) {
            const slot = i16(order, i);

            for (let entry = i32(template.slotEntries, slot); entry < i32(template.slotEntries, slot + 1); entry++) {
                const triangles = template.triangles[entry];
                const first = i32(template.first, entry);

                if (i32(template.counts, entry) === 0 || triangles === undefined) continue;
                for (let t = 0; t < triangles.length; t++) indices[at++] = first + u16(triangles, t);
            }
        }
        const buffer = new Buffer({
            data: indices,
            label: 'marrow-instance-indices',
            usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        });

        return { order: order.slice(), hash, buffer, count: at, uses: 0 };
    }

    /** Destroys the oldest unions no view draws with, past the few that are kept. */
    private trim(): void {
        let spare = 0;

        for (const union of this.unions) if (union.uses === 0) spare++;

        for (let i = 0; i < this.unions.length && spare > SPARE_UNIONS; i++) {
            const union = this.unions[i];

            if (union === undefined || union.uses > 0) continue;
            union.buffer.destroy();
            this.unions.splice(i--, 1);
            spare--;
        }
    }
}

/** Why the views of a layout draw alone, by the skin data of the layout. A layout that draws alone gets no instanced draw. */
const blocks = new WeakMap<SkinLayout, LayoutBlock | null>();

/**
 * Why the views of the layout of a template must draw alone, or null when they can draw
 * instanced. It makes no instanced draw for the layout.
 *
 * @example
 * if (instanceBlock(template, model, skinLayout, pages.length) === null) shared = instanceLayout(template, model, skinLayout, pages.length);
 */
export function instanceBlock(
    template: Template,
    model: SkeletonModel,
    skin: SkinLayout,
    pages: number,
): LayoutBlock | null {
    const known = blocks.get(skin);

    if (known !== undefined) return known;
    const block = skin.instances instanceof InstanceLayout ? skin.instances.block : blockOf(template, model, pages);

    blocks.set(skin, block);

    return block;
}

/**
 * The instanced draw of the layout of a template, made with the first view that asks. It lives
 * as long as the skin data of the layout. Ask {@link instanceBlock} first: a layout that never
 * draws instanced needs none.
 *
 * @example
 * const shared = instanceLayout(template, model, skinLayout, pages.length);
 * if (shared.block === null) slot = shared.take();
 */
export function instanceLayout(
    template: Template,
    model: SkeletonModel,
    skin: SkinLayout,
    pages: number,
): InstanceLayout {
    const known = skin.instances;

    if (known instanceof InstanceLayout) return known;
    const made = new InstanceLayout(template, model, skin, pages);

    skin.instances = made;

    return made;
}
