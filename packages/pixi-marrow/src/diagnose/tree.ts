import { type Container, VERSION } from 'pixi.js';
import type { MarrowSpine } from '../api/spine';
import { inspect } from './inspect';
import { diagnoseTree } from './static';
import type { RendererInfo, SkeletonInspection, TreeDump, TreeNode } from './types';

/*
 * A Pixi scene tree as plain data. The walk reads what a display object says of itself: its
 * class, its label, its transform and the flags that decide how Pixi draws it. A `MarrowSpine`
 * adds what `inspect` reads, and its children are left out: they belong to the runtime.
 */

/** What the walk reads of a renderer. A Pixi `Renderer` is one, and so is a plain object in a test. */
export interface RendererLike {
    /** The bits of Pixi: 1 is WebGL and 2 is WebGPU. */
    readonly type?: number;
    readonly roundPixels?: boolean;
    readonly view?: { readonly antialias?: boolean };
    readonly screen?: { readonly width: number; readonly height: number };
    readonly limits?: { readonly maxBatchableTextures?: number };
}

/** What `serializeTree`, `diagnose` and `watch` take besides the root. */
export interface TreeOptions {
    /** The renderer that draws the tree. With it the rules about the renderer and the screen can hit. */
    renderer?: RendererLike | undefined;
}

/** A tree as plain data, with the display object of each path and each skeleton. */
export interface Walk {
    dump: TreeDump;
    /** The display object at each path. */
    nodes: Map<string, Container>;
    /** The skeletons in tree order, each with its node of the dump. */
    skeletons: { hero: MarrowSpine; node: TreeNode; marrow: SkeletonInspection }[];
}

const RENDERER_TYPES: Readonly<Record<number, string>> = { 1: 'webgl', 2: 'webgpu' };

/**
 * Whether a display object is a `MarrowSpine`. It reads the field `isMarrowSpine`, so it also
 * holds for an object of another copy of the package.
 *
 * @example
 * const skeletons = app.stage.children.filter(isMarrowSpine);
 */
export function isMarrowSpine(node: object): node is MarrowSpine {
    return 'isMarrowSpine' in node && node.isMarrowSpine === true;
}

/** What a dump states of a renderer. */
function rendererInfo(renderer: RendererLike): RendererInfo {
    return {
        type: RENDERER_TYPES[renderer.type ?? 0] ?? 'unknown',
        roundPixels: renderer.roundPixels === true,
        antialias: renderer.view?.antialias === true,
        width: renderer.screen?.width ?? 0,
        height: renderer.screen?.height ?? 0,
        maxBatchTextures: renderer.limits?.maxBatchableTextures ?? 16,
    };
}

/** The name of a display object in a path: its label, else its class. */
function nameOf(node: Container): string {
    if (isMarrowSpine(node)) return node.label || 'MarrowSpine';

    return node.label || node.constructor.name || 'Container';
}

/** The names of the children of a container, each with a number where two share a name. */
function childNames(children: readonly Container[]): string[] {
    const counts = new Map<string, number>();
    const names = children.map(nameOf);

    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    const used = new Map<string, number>();

    return names.map((name) => {
        if (counts.get(name) === 1) return name;
        const index = used.get(name) ?? 0;

        used.set(name, index + 1);

        return `${name}[${index}]`;
    });
}

/** Whether the bounds of a display object touch the screen of a renderer. Null without a screen size. */
function onScreen(node: Container, renderer: RendererInfo | null): boolean | null {
    if (renderer === null || renderer.width <= 0 || renderer.height <= 0) return null;
    const { minX, minY, maxX, maxY } = node.getBounds();

    return maxX >= 0 && maxY >= 0 && minX <= renderer.width && minY <= renderer.height;
}

/** One display object as plain data, without its children. */
function describe(node: Container, path: string): TreeNode {
    const { filters } = node;
    let filterCount = 0;

    if (Array.isArray(filters)) filterCount = filters.length;
    else if (filters != null) filterCount = 1;

    return {
        type: isMarrowSpine(node) ? 'MarrowSpine' : node.constructor.name,
        label: node.label ?? '',
        path,
        visible: node.visible,
        renderable: node.renderable,
        alpha: node.alpha,
        tint: Number(node.tint),
        blendMode: String(node.blendMode),
        x: node.position.x,
        y: node.position.y,
        scaleX: node.scale.x,
        scaleY: node.scale.y,
        rotation: node.rotation,
        zIndex: node.zIndex,
        sortableChildren: node.sortableChildren,
        filters: filterCount,
        mask: node.mask != null,
        renderGroup: node.isRenderGroup === true,
        cacheAsTexture: node.isCachedAsTexture === true,
        draws: 'renderPipeId' in node && node.renderPipeId != null,
        children: [],
    };
}

/**
 * Walks a tree and keeps the display object of each path next to the plain data.
 *
 * @example
 * const { dump, skeletons } = walkTree(app.stage, { renderer: app.renderer });
 * console.log(dump.root.path, skeletons.length);
 */
export function walkTree(root: Container, options: TreeOptions = {}): Walk {
    const renderer = options.renderer === undefined ? null : rendererInfo(options.renderer);
    const nodes = new Map<string, Container>();
    const skeletons: Walk['skeletons'] = [];
    const assets = new Map<object, number>();
    const visit = (node: Container, path: string): TreeNode => {
        const plain = describe(node, path);

        nodes.set(path, node);
        if (isMarrowSpine(node)) {
            const marrow = inspect(node);

            if (!assets.has(node.asset)) assets.set(node.asset, assets.size);
            marrow.asset.id = assets.get(node.asset) ?? -1;
            marrow.pacing.onScreen = onScreen(node, renderer);
            plain.marrow = marrow;
            skeletons.push({ hero: node, node: plain, marrow });

            return plain;
        }
        const names = childNames(node.children);

        plain.children = node.children.map((child, index) => visit(child, `${path}/${names[index]}`));

        return plain;
    };
    const dump: TreeDump = {
        kind: 'pixi-marrow/tree',
        version: 1,
        pixi: VERSION,
        renderer,
        root: visit(root, root.label || (isMarrowSpine(root) ? 'MarrowSpine' : 'stage')),
    };

    for (const { marrow } of skeletons) {
        marrow.asset.instances = skeletons.filter((other) => other.marrow.asset.id === marrow.asset.id).length;
    }
    // each skeleton states the static rules that hit for it
    for (const hit of diagnoseTree(dump).hits) {
        for (const { node, marrow } of skeletons) {
            if (hit.nodes.includes(node.path) && !marrow.rules.includes(hit.id)) marrow.rules.push(hit.id);
        }
    }

    return { dump, nodes, skeletons };
}

/**
 * Writes a Pixi scene tree as plain data: each display object with its class, label, transform,
 * alpha, tint, blend mode, filters, mask and render group flags. A `MarrowSpine` carries what
 * `inspect` reads of it. `diagnoseTree` finds the causes of cost in the result, also offline.
 *
 * @example
 * const dump = serializeTree(app.stage, { renderer: app.renderer });
 * console.log(JSON.stringify(dump));
 */
export function serializeTree(root: Container, options: TreeOptions = {}): TreeDump {
    return walkTree(root, options).dump;
}
