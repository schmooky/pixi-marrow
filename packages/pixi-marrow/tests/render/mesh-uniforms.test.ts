import { BindGroup, Matrix, type Mesh, MeshGeometry, Mesh as PixiMesh, RendererType, Texture } from 'pixi.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { loadMeshCode } from '../../src/render/mesh-code';
import { watchUniformBatch } from '../../src/render/mesh-uniforms';
import { RangeMesh } from '../../src/render/range-mesh';
import { loadRig, meshes, step } from './rig';

/*
 * The uniforms of the meshes of the mesh mode on WebGPU, see `mesh-uniforms.ts`. Pixi gives each
 * mesh a slot of one batch of uniforms per frame and throws when the batch is full. A mesh of
 * ours takes a slot while the batch has room, and binds a buffer of its own after that.
 */

beforeAll(async () => {
    await loadMeshCode();
});

/** The bytes of Pixi's batch of uniforms on WebGPU: 65535 floats. */
const BATCH_BYTES = 65535 * 4;

/** A renderer with what the wrapper reads: its type, the mesh pipe, the batch, the encoder and the global uniforms. */
function fakeRenderer(type: RendererType) {
    const inner = { init: vi.fn(), execute: vi.fn(), destroy: vi.fn() };
    const batch = { byteIndex: 0, data: new Float32Array(BATCH_BYTES / 4) };
    const pipe = {
        _adaptor: inner as unknown,
        localUniforms: {
            uniforms: {
                uTransformMatrix: new Matrix(2, 0, 0, 2, 10, 20),
                uColor: new Float32Array([1, 0.5, 1, 1]),
                uRound: 0,
            },
        },
    };
    const renderer = {
        type,
        renderPipes: { mesh: pipe, uniformBatch: { _batchBuffer: batch } },
        globalUniforms: { bindGroup: new BindGroup({}) },
        encoder: { draw: vi.fn() },
    };

    return { renderer, pipe, inner, batch };
}

/** A mesh of the mesh mode, with the shader the mode draws it with. */
async function rangeMesh(): Promise<RangeMesh> {
    const rig = await loadRig('4.2/speedy-ess.skel');

    // the view lays its ranges out at its first draw
    step(rig, 0);
    const [mesh] = meshes(rig.view);

    if (!(mesh instanceof RangeMesh)) throw new Error('the mesh mode draws range meshes');

    return mesh;
}

type Execute = (pipe: unknown, mesh: Mesh) => void;

const executeOf = (pipe: { _adaptor: unknown }): Execute => (pipe._adaptor as { execute: Execute }).execute;

describe('the uniforms of the mesh mode on WebGPU', () => {
    it('leaves every mesh to Pixi while the batch of uniforms has room', async () => {
        const { renderer, pipe, inner } = fakeRenderer(RendererType.WEBGPU);
        const mesh = await rangeMesh();

        watchUniformBatch(renderer as never);
        executeOf(pipe)(pipe, mesh as unknown as Mesh);
        expect(inner.execute).toHaveBeenCalledTimes(1);
        expect(renderer.encoder.draw).not.toHaveBeenCalled();
    });

    it('draws a mesh of ours with a buffer of its own once the batch is nearly full, and leaves other meshes to Pixi', async () => {
        const { renderer, pipe, inner, batch } = fakeRenderer(RendererType.WEBGPU);
        const mesh = await rangeMesh();
        const theirs = new PixiMesh({
            geometry: new MeshGeometry({
                positions: new Float32Array(6),
                uvs: new Float32Array(6),
                indices: new Uint32Array([0, 1, 2]),
            }),
            texture: Texture.WHITE,
        });

        watchUniformBatch(renderer as never);
        batch.byteIndex = BATCH_BYTES - 128;
        executeOf(pipe)(pipe, mesh as unknown as Mesh);
        executeOf(pipe)(pipe, theirs);
        expect(inner.execute).toHaveBeenCalledTimes(1);
        expect(inner.execute.mock.calls[0]?.[1]).toBe(theirs);
        expect(renderer.encoder.draw).toHaveBeenCalledTimes(1);
        const own = mesh.shader?.groups[1];

        expect(own).toBeInstanceOf(BindGroup);
        const group = (own as BindGroup).resources[0] as unknown as {
            uniforms: { uTransformMatrix: Matrix; uColor: Float32Array; uRound: number };
        };

        expect(group.uniforms.uTransformMatrix.tx).toBe(10);
        expect(Array.from(group.uniforms.uColor)).toEqual([1, 0.5, 1, 1]);
        expect(mesh.shader?.groups[0]).toBe(renderer.globalUniforms.bindGroup);
    });

    it('uploads its own buffer only when the values of the mesh change', async () => {
        const { renderer, pipe, batch } = fakeRenderer(RendererType.WEBGPU);
        const mesh = await rangeMesh();
        const execute = (): void => executeOf(pipe)(pipe, mesh as unknown as Mesh);

        watchUniformBatch(renderer as never);
        batch.byteIndex = BATCH_BYTES;
        execute();
        const own = mesh.shader?.groups[1];

        if (!(own instanceof BindGroup)) throw new Error('the mesh binds a buffer of its own');
        const group = own.resources[0] as unknown as { _dirtyId: number };
        const first = group._dirtyId;

        execute();
        expect(group._dirtyId).toBe(first);
        pipe.localUniforms.uniforms.uTransformMatrix.tx = 11;
        execute();
        expect(group._dirtyId).toBe(first + 1);
        pipe.localUniforms.uniforms.uColor[3] = 0.25;
        execute();
        expect(group._dirtyId).toBe(first + 2);
    });

    it('wraps the adaptor of a renderer once, and does nothing on WebGL', async () => {
        const gpu = fakeRenderer(RendererType.WEBGPU);
        const gl = fakeRenderer(RendererType.WEBGL);

        watchUniformBatch(gpu.renderer as never);
        const wrapped = gpu.pipe._adaptor;

        watchUniformBatch(gpu.renderer as never);
        expect(gpu.pipe._adaptor).toBe(wrapped);
        expect(wrapped).not.toBe(gpu.inner);
        watchUniformBatch(gl.renderer as never);
        expect(gl.pipe._adaptor).toBe(gl.inner);
    });

    it('lets go of the buffer of a mesh with the mesh', async () => {
        const { renderer, pipe, batch } = fakeRenderer(RendererType.WEBGPU);
        const mesh = await rangeMesh();

        watchUniformBatch(renderer as never);
        batch.byteIndex = BATCH_BYTES;
        executeOf(pipe)(pipe, mesh as unknown as Mesh);
        const own = mesh.shader?.groups[1] as BindGroup;
        const destroy = vi.spyOn(own, 'destroy');

        mesh.destroy();
        expect(destroy).toHaveBeenCalledTimes(1);
    });
});
