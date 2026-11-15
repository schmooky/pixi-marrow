import { Assets, DOMAdapter, type Texture } from 'pixi.js';
import { MarrowError } from '../base/errors';
import type { SkeletonSource } from '../formats/sniff';
import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import { loadPoseEngine, type PoseEngineFactory } from '../pose/engine';
import { loadClipCode } from '../render/clip-code';
import { loadCutCode } from '../render/cut-code';
import { loadMeshCode } from '../render/mesh-code';
import { hasClip, type RenderMode, startsWithMeshes } from '../render/mode';
import type { MarrowLoadOptions } from './asset-options';
import { renderMode } from './checks';

/*
 * What `MarrowAsset.load` does before there is an asset: it fetches the files, reads them and
 * gets the page images. The code that reads loads on demand, next to the files.
 */

/** What an asset is made of: the files, and the outlines or the word that says how to get them. */
export interface AssetParts {
    model: SkeletonModel;
    atlas: AtlasModel;
    textures: readonly Texture[];
    /** A promise gives the outlines later: once they were checked and the code that cuts with them is loaded. */
    outlines: AtlasOutlines | Promise<AtlasOutlines> | 'auto' | undefined;
}

/**
 * The URL to fetch for a URL of the options: the resolver of Pixi `Assets` adds its base path and
 * its search params. A `blob:` or `data:` URL is whole as it is.
 */
const resolveUrl = (url: string): string =>
    /^(blob|data):/i.test(url) ? url : (Assets.resolver.resolve(url).src ?? url);

/** Numbers for the outline objects that loads were asked with, so that a load can be told from another. */
const outlineIds = new WeakMap<object, number>();
let nextOutlineId = 1;

/** How the outlines option reads in the key of a load. Two objects are two keys. */
function outlinesKey(outlines: MarrowLoadOptions['outlines']): string {
    if (outlines === undefined || typeof outlines === 'string') return outlines ?? 'off';
    let id = outlineIds.get(outlines);

    if (id === undefined) {
        id = nextOutlineId++;
        outlineIds.set(outlines, id);
    }

    return `object ${id}`;
}

/**
 * What identifies a load, or undefined when the skeleton is not a URL.
 *
 * @example
 * const key = loadKey({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
 */
export function loadKey(options: MarrowLoadOptions): string | undefined {
    if (typeof options.skeleton !== 'string') return undefined;
    const textures = Object.entries(options.textures ?? {})
        .map(([name, texture]) => [name, typeof texture === 'string' ? texture : `texture ${texture.uid}`])
        .sort(([a = ''], [b = '']) => a.localeCompare(b));

    return JSON.stringify([options.skeleton, options.atlas, textures, outlinesKey(options.outlines)]);
}

async function fetchFile(url: string, what: string): Promise<Response> {
    let response: Response;

    try {
        response = await DOMAdapter.get().fetch(url);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new MarrowError('invalid-data', `The ${what} at ${url} did not load: ${reason}`, {
            fix: 'Check the URL and that the server allows the request.',
        });
    }
    if (!response.ok) {
        throw new MarrowError('invalid-data', `The ${what} at ${url} did not load: status ${response.status}.`, {
            fix: 'Check the URL.',
        });
    }

    return response;
}

/** The skeleton of a load as the importer takes it. A URL is fetched as bytes: their content says what they are. */
async function readSkeleton(skeleton: MarrowLoadOptions['skeleton'], url: string | undefined): Promise<SkeletonSource> {
    if (url === undefined || typeof skeleton !== 'string') return skeleton;

    return new Uint8Array(await (await fetchFile(url, 'skeleton')).arrayBuffer());
}

/** The parsed outlines file of a load, or what the option says when it names no file. */
async function readOutlines(outlines: MarrowLoadOptions['outlines']): Promise<unknown> {
    if (typeof outlines !== 'string' || outlines === 'auto' || outlines === 'off') return outlines ?? 'off';
    const url = resolveUrl(outlines);
    const response = await fetchFile(url, 'outlines file');

    try {
        return await response.json();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        throw new MarrowError('invalid-data', `The outlines file at ${url} is not JSON: ${reason}`, {
            fix: 'Write the file again for this atlas: pixi-marrow outlines <atlas>.',
        });
    }
}

/**
 * What an asset starts with: the outlines of an object, checked against the atlas, or the word
 * for none or later. The code that checks them and the code that cuts with them load on
 * demand, so a load without outlines does not pay for either.
 *
 * @example
 * const outlines = await checkOutlines(JSON.parse(text), atlas);
 */
export async function checkOutlines(outlines: unknown, atlas: AtlasModel): Promise<AtlasOutlines | 'auto' | undefined> {
    if (outlines === undefined || outlines === 'off') return undefined;
    if (outlines === 'auto') return 'auto';
    const [{ readAtlasOutlines }] = await Promise.all([import('../geometry/outlines'), loadCutCode()]);

    return readAtlasOutlines(outlines, atlas);
}

/**
 * The code that poses a skeleton, and with it the code its instances draw with that is not in
 * the root import. The code that clips loads for a skeleton with a clipping attachment. The
 * code of the mesh mode loads when the instances start in that mode: `mode` names it, or it is
 * `auto` and the skeleton is one that `auto` draws with meshes.
 *
 * A load of the mesh mode that fails does not fail the asset: its instances draw in a batch.
 *
 * @example
 * const createEngine = await loadCode(model, atlas, 'auto');
 */
export async function loadCode(model: SkeletonModel, atlas: AtlasModel, mode: RenderMode): Promise<PoseEngineFactory> {
    const [createEngine] = await Promise.all([
        loadPoseEngine(model),
        hasClip(model) ? loadClipCode() : undefined,
        startsWithMeshes(model, atlas, mode) ? loadMeshCode() : undefined,
    ]);

    return createEngine;
}

/** What `MarrowAsset.load` got for an asset. */
export interface FetchedAsset {
    parts: AssetParts;
    createEngine: PoseEngineFactory;
    /** Gives the page images back that the load took. */
    release: () => void;
}

/**
 * Fetches and reads the files of a load and gets its page images.
 *
 * @example
 * const { parts, createEngine, release } = await fetchAsset({ skeleton: 'hero.skel', atlas: 'hero.atlas' });
 */
export async function fetchAsset(options: MarrowLoadOptions): Promise<FetchedAsset> {
    const skeleton = typeof options.skeleton === 'string' ? resolveUrl(options.skeleton) : undefined;
    const atlasUrl = resolveUrl(options.atlas);
    // the code that reads the files loads next to them
    const [source, atlasText, outlinesFile, code] = await Promise.all([
        readSkeleton(options.skeleton, skeleton),
        fetchFile(atlasUrl, 'atlas').then((response) => response.text()),
        readOutlines(options.outlines),
        import('./asset-load'),
    ]);
    const { model, atlas } = await code.readFiles(source, atlasText, { skeleton, atlas: atlasUrl });
    // before the images, so that outlines of another atlas cost no image loads
    const outlines = await checkOutlines(outlinesFile, atlas).catch((error: unknown) => {
        const file = typeof options.outlines === 'string' ? options.outlines : undefined;

        throw file === undefined ? error : code.fileError(error, 'outlines file', resolveUrl(file), undefined);
    });
    const createEngine = await loadCode(model, atlas, renderMode(options.renderMode ?? 'auto'));
    const { textures, loaded } = await code.loadPages(atlas, atlasUrl, options.textures, { resolve: resolveUrl });
    const release = (): void => {
        for (const url of loaded) code.releasePage(url);
    };

    return { parts: { model, atlas, textures, outlines }, createEngine, release };
}
