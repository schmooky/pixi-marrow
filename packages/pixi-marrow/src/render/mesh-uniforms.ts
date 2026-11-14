import {
    BindGroup,
    type Buffer,
    Matrix,
    type Mesh,
    type MeshAdaptor,
    type MeshPipe,
    type Renderer,
    RendererType,
    type Shader,
    UniformGroup,
    type WebGPURenderer,
} from 'pixi.js';
import { RangeMesh } from './range-mesh';

/*
 * The uniforms of the meshes of the mesh mode on WebGPU.
 *
 * Pixi hands every mesh it draws on WebGPU its transform, tint and rounding in a slot of one
 * uniform buffer that all draws of a frame share. That buffer holds 65535 floats in slots of 128
 * bytes, about 2000 draws, and Pixi throws when a frame needs more: 1200 instances of a rig with
 * a clip, at four meshes each, are enough. So the meshes of the mesh mode take a slot as Pixi
 * gives it while the buffer has room, and keep some room for the rest of the scene. Past that a
 * mesh of ours binds a small uniform buffer of its own, which is uploaded only when its values
 * change. WebGL sets uniforms one by one and has no such buffer.
 *
 * Pixi's mesh pipe calls its adaptor once per mesh, with the values of the mesh in the pipe's
 * `localUniforms`. The pipe of a WebGPU renderer gets an adaptor that wraps Pixi's own: every
 * mesh that is not ours, and every mesh of ours while the buffer has room, goes to Pixi's.
 */

/** The bytes of one slot of Pixi's batch of uniforms on WebGPU. */
const SLOT_BYTES = 128;
/** The room of the batch that stays for the rest of the scene: Graphics, sprites in filters, other meshes. */
const RESERVE_BYTES = 256 * SLOT_BYTES;
/** Marks an adaptor that is already wrapped. */
const WRAPPED = Symbol('marrow uniforms');

/** The uniforms of the mesh pipe, as Pixi fills them for a mesh. */
interface LocalValues {
    uTransformMatrix: Matrix;
    uColor: Float32Array;
    uRound: number;
}

/** A uniform buffer of one mesh, with the values it holds now. */
interface OwnUniforms {
    group: UniformGroup<{
        uTransformMatrix: { value: Matrix; type: 'mat3x3<f32>' };
        uColor: { value: Float32Array; type: 'vec4<f32>' };
        uRound: { value: number; type: 'f32' };
    }>;
    bind: BindGroup;
    /** True until the first values are written. */
    fresh: boolean;
}

const owned = new WeakMap<RangeMesh, OwnUniforms>();

/** The bytes still free in Pixi's batch of uniforms this frame, or 0 where it cannot be read. */
function batchRoom(renderer: Renderer): number {
    const pipe: unknown = Reflect.get(renderer.renderPipes, 'uniformBatch');
    const batch: unknown = typeof pipe === 'object' && pipe !== null ? Reflect.get(pipe, '_batchBuffer') : null;

    if (typeof batch !== 'object' || batch === null) return 0;
    const used: unknown = Reflect.get(batch, 'byteIndex');
    const data: unknown = Reflect.get(batch, 'data');

    return typeof used === 'number' && data instanceof Float32Array ? data.byteLength - used : 0;
}

/** The uniform buffer of a mesh, made the first time the mesh needs it and freed with it. */
function ownOf(mesh: RangeMesh): OwnUniforms {
    let own = owned.get(mesh);

    if (own === undefined) {
        const group = new UniformGroup({
            uTransformMatrix: { value: new Matrix(), type: 'mat3x3<f32>' as const },
            uColor: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' as const },
            uRound: { value: 0, type: 'f32' as const },
        });
        const made: OwnUniforms = { group, bind: new BindGroup({ 0: group }), fresh: true };

        own = made;
        owned.set(mesh, made);
        mesh.once('destroyed', () => {
            owned.delete(mesh);
            made.bind.destroy();
            const buffer: unknown = Reflect.get(group, 'buffer');

            if (typeof buffer === 'object' && buffer !== null) (buffer as Buffer).destroy();
        });
    }

    return own;
}

/** Copies the values Pixi computed for a mesh into its own buffer, and marks the buffer for upload when they changed. */
function writeOwn(own: OwnUniforms, values: LocalValues): void {
    const mine = own.group.uniforms;
    const from = values.uTransformMatrix;
    const to = mine.uTransformMatrix;
    const color = values.uColor;
    const kept = mine.uColor;
    const same =
        !own.fresh &&
        to.a === from.a &&
        to.b === from.b &&
        to.c === from.c &&
        to.d === from.d &&
        to.tx === from.tx &&
        to.ty === from.ty &&
        kept[0] === color[0] &&
        kept[1] === color[1] &&
        kept[2] === color[2] &&
        kept[3] === color[3] &&
        mine.uRound === values.uRound;

    if (same) return;
    own.fresh = false;
    to.copyFrom(from);
    kept.set(color);
    mine.uRound = values.uRound;
    own.group.update();
}

/** Draws a mesh of ours with its own uniform buffer, as Pixi's adaptor draws it with a slot of the batch. */
function drawOwn(renderer: WebGPURenderer, pipe: MeshPipe, mesh: RangeMesh): void {
    const shader: Shader | null = mesh.shader;
    const program = shader?.gpuProgram;

    if (shader === null || program === undefined) return;
    if (program.autoAssignGlobalUniforms) shader.groups[0] = renderer.globalUniforms.bindGroup;
    const own = ownOf(mesh);

    writeOwn(own, pipe.localUniforms.uniforms as LocalValues);
    shader.groups[1] = own.bind;
    renderer.encoder.draw({ geometry: mesh.geometry, shader, state: mesh.state });
}

/**
 * Gives the mesh pipe of a WebGPU renderer an adaptor that draws the meshes of the mesh mode
 * with uniform buffers of their own once Pixi's batch of uniforms is nearly full. Does nothing
 * on WebGL, for a renderer without Pixi's mesh pipe, and for one that has it already.
 *
 * @example
 * linkMeshPipe(renderer);
 * watchUniformBatch(renderer);
 */
export function watchUniformBatch(renderer: Renderer): void {
    if (renderer.type !== RendererType.WEBGPU) return;
    const pipe: unknown = Reflect.get(renderer.renderPipes, 'mesh');

    if (typeof pipe !== 'object' || pipe === null) return;
    const inner: unknown = Reflect.get(pipe, '_adaptor');

    if (typeof inner !== 'object' || inner === null || Reflect.get(inner, WRAPPED) === true) return;
    const adaptor = inner as MeshAdaptor;
    const wrapped: MeshAdaptor & { [WRAPPED]: true } = {
        [WRAPPED]: true,
        // Pixi's adaptor was set up when the pipe was made
        init: () => {},
        execute(meshPipe: MeshPipe, mesh: Mesh): void {
            const ours = mesh instanceof RangeMesh && mesh.shader?.gpuProgram?.autoAssignLocalUniforms === true;

            if (ours && batchRoom(renderer) < RESERVE_BYTES) drawOwn(renderer as WebGPURenderer, meshPipe, mesh);
            else adaptor.execute(meshPipe, mesh);
        },
        destroy: () => adaptor.destroy(),
    };

    Reflect.set(pipe, '_adaptor', wrapped);
}
