import { type MeshAdaptor, MeshPipe, type Renderer } from 'pixi.js';

/*
 * The pipe Pixi draws a mesh with, for a renderer that has none.
 *
 * Pixi registers its mesh pipe when the module of `Mesh` is evaluated, and a renderer takes the
 * pipes that are registered when it is initialized. The meshes of the mesh mode are in a chunk
 * that loads on demand. In an application that uses no mesh of its own, a bundler puts `Mesh`
 * into that chunk too, so its pipe registers after the renderer exists: the renderer never gets
 * it, and Pixi fails on the first mesh it meets. The mesh mode therefore gives such a renderer
 * the pipe itself, the way Pixi does at the start: one pipe per renderer, with the mesh adaptor
 * the renderer was configured with, which every renderer of Pixi brings along.
 */

/** The mesh adaptor a renderer was configured with: the one of WebGL or of WebGPU. */
function adaptorOf(renderer: Renderer): MeshAdaptor | undefined {
    const config: unknown = Reflect.get(renderer, 'config');
    const adaptors: unknown =
        typeof config === 'object' && config !== null ? Reflect.get(config, 'renderPipeAdaptors') : null;
    const entries: readonly unknown[] = Array.isArray(adaptors) ? adaptors : [];

    for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null || Reflect.get(entry, 'name') !== 'mesh') continue;
        const Adaptor: unknown = Reflect.get(entry, 'value');

        if (typeof Adaptor === 'function') return Reflect.construct(Adaptor, []);
    }

    return undefined;
}

/**
 * Makes sure a renderer can draw meshes: gives it Pixi's mesh pipe when it has none. A view in
 * the mesh mode calls it before every frame, through `onRender` of its container. For a renderer
 * that has the pipe, that is one read of a property.
 *
 * @example
 * container.onRender = linkMeshPipe;
 */
export function linkMeshPipe(renderer: Renderer): void {
    // the type says that every renderer has the pipe. One that was created before `Mesh` loaded has not
    if (renderer.renderPipes.mesh !== undefined) return;
    const adaptor = adaptorOf(renderer);

    // a renderer without a mesh adaptor is none of Pixi's: it draws its meshes in a way of its own
    if (adaptor === undefined) return;
    const pipe = new MeshPipe(renderer, adaptor);

    // what a renderer does with the pipes it finds when it is initialized
    renderer.renderPipes.mesh = pipe;
    renderer.runners.destroy.add(pipe);
}
