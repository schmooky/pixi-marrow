/**
 * The chunks of the page of the render check, and the one that holds the mesh mode.
 *
 * pixi-marrow draws most skeletons in a batch, so the code of its mesh mode is meant to be a
 * chunk that loads on demand. A page whose skeletons all draw in a batch must then not ask for
 * it. Whether such a chunk exists is read from the bundle: rolldown writes the path of every
 * module before its code, and a chunk names the chunks it needs at once in its import
 * statements. The mesh mode loads on demand when the module that draws it is in no chunk the
 * root import needs at once.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The module of the built package that draws in the mesh mode, by the end of its path: the
 * package is a folder of the repo, or a copy of a build that was kept.
 */
const MESH_MODULE = 'pixi-marrow/dist/render/mesh-paint.js';
/** A module of the root import: the display object. */
const ROOT_MODULE = 'pixi-marrow/dist/api/spine.js';

/**
 * Where the mesh mode is in a bundle.
 *
 * @returns `chunk` is the file name of the chunk that holds the mesh mode, or null when the
 * bundle has no such module. `lazy` is true when the root import does not need that chunk at
 * once, so that it loads on demand.
 */
export function findMeshChunk(bundleDir) {
    const chunks = new Map();

    for (const name of readdirSync(bundleDir).filter((file) => file.endsWith('.js'))) {
        const text = readFileSync(join(bundleDir, name), 'utf8');
        // a pnpm link shows as its real path, so a module is told by the end of its path
        const modules = [...text.matchAll(/^\/\/ (\S+\.m?js)$/gm)].map((match) => match[1]);
        // a chunk a chunk needs at once: `import ... from "./x.js"`, not `import("./x.js")`
        const needs = [...text.matchAll(/^import\s*(?:[^"'()]*?from\s*)?["']\.\/([^"']+)["'];?$/gm)].map(
            (match) => match[1],
        );

        chunks.set(name, { modules, needs });
    }
    const holding = (module) =>
        [...chunks].find(([, chunk]) => chunk.modules.some((path) => path.endsWith(module)))?.[0];
    const mesh = holding(MESH_MODULE);
    const root = holding(ROOT_MODULE);

    if (!mesh || !root) return { chunk: mesh ?? null, lazy: false };
    const reached = new Set([root]);

    for (const name of reached) for (const needed of chunks.get(name)?.needs ?? []) reached.add(needed);

    return { chunk: mesh, lazy: !reached.has(mesh) };
}

/**
 * The case of a scene about the lazy mesh mode that the Node side adds: what the bundle says
 * about the chunk, and whether the page asked for it.
 *
 * A bundle without a lazy chunk is a finding and no failure: the mesh mode is then part of what
 * the root import loads at once, which costs size and breaks nothing. With a lazy chunk, a page
 * that needs no mesh mode must not ask for it.
 *
 * @param scene The scene of the page, with `lazy` set to `never`, `first`, `switch` or `create`.
 * @param requested The addresses the page asked for.
 * @param mesh What `findMeshChunk` returned.
 */
export function meshChunkCase(scene, requested, mesh) {
    const entry = { label: 'mesh chunk', kind: 'chunk', reasons: [], info: { ...mesh, lazy: mesh.lazy, asked: false } };

    if (!mesh.chunk || !mesh.lazy) {
        entry.finding = mesh.chunk
            ? 'no mesh chunk: the mesh mode is in a chunk the root import loads at once'
            : 'no mesh chunk: the bundle has no module render/mesh-paint.js';

        return entry;
    }
    entry.info.asked = requested.some((address) => address.endsWith(`/${mesh.chunk}`));
    if (scene.lazy === 'never' && entry.info.asked) {
        entry.reasons.push(`the page asked for ${mesh.chunk}, and nothing on it needs the mesh mode`);
    }
    if (scene.lazy !== 'never' && !entry.info.asked) {
        entry.reasons.push(`the page never asked for ${mesh.chunk}, and a skeleton on it needs the mesh mode`);
    }

    return entry;
}
