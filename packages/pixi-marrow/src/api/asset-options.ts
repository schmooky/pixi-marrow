import type { Texture } from 'pixi.js';
import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';

/** What `MarrowAsset.load` and `MarrowSpine.load` take. */
export interface MarrowLoadOptions {
    /**
     * The skeleton: a URL, the bytes of a `.skel` or a `.json` file, or parsed JSON. The content of
     * the file says whether it is JSON or binary, not its name. So a URL with a hash, a query or
     * no extension works, and a `blob:` URL too.
     *
     * Every URL of a load goes through the resolver of Pixi `Assets`. The `basePath` and the
     * `defaultSearchParams` of `Assets.init` apply to the skeleton, the atlas, the outlines file
     * and the page images alike.
     */
    skeleton: string | Uint8Array | ArrayBuffer | object;
    /** The URL of the `.atlas` file. The page images load from next to it, with its query. */
    atlas: string;
    /**
     * Page images by page name: a texture, or the URL of the image. A page that is not named is
     * loaded from next to the atlas. A name that is no page of the atlas throws.
     */
    textures?: Readonly<Record<string, Texture | string>>;
    /**
     * Where the outlines of the atlas regions come from. With them a slot behind an opaque one
     * is skipped and a region without a visible pixel is not drawn. The picture stays the same.
     * `tightMesh: 'on'` of a display object also needs them. Without them `tightMesh` and
     * `occlusion` do nothing, and a display object that sets one of them by name warns once.
     *
     * - `off` (the default) loads none: every region stays a quad and every slot is drawn.
     * - A string is the URL of the file that `pixi-marrow outlines` wrote. It is fetched during the load.
     *   This is the way for a game: the outlines are read once at build time.
     * - An object is the parsed content of such a file.
     * - `auto` reads the page images in idle time after the load. See `MarrowAsset.optimized`.
     *   Each page is drawn into a canvas to read its pixels, which takes 8 bytes per pixel of
     *   the page for a moment, 32 MB for a page of 2048 by 2048. A phone with little memory can
     *   fail or stall on that, so it is set by name.
     *
     * A file or an object that does not fit the atlas throws.
     */
    outlines?: 'auto' | 'off' | string | AtlasOutlines;
    /**
     * The render mode the display objects of the asset will ask for, so that the load brings
     * the code they draw with. The code of the mesh mode is not in the root import. The load
     * waits for it with `mesh`, and with `auto` (the default) for a skeleton that `auto` draws
     * with meshes. A display object that asks for the mesh mode later loads the code itself and
     * draws in a batch until it is there.
     */
    renderMode?: 'auto' | 'mesh' | 'batched';
    /**
     * The name of the asset, see `MarrowAsset.name`. Default: the file name of the skeleton URL
     * without its extension. Loads that share one asset keep the name of the first load.
     */
    name?: string;
}

/** What `MarrowAsset.fromData` takes: a skeleton and an atlas that are in memory. */
export interface MarrowAssetData {
    model: SkeletonModel;
    atlas: AtlasModel;
    /** One texture per atlas page, in page order. */
    textures: readonly Texture[];
    /**
     * Where the outlines of the atlas regions come from: `off` (the default) uses none, an object
     * is checked against the atlas and used, `auto` reads the page textures in idle time.
     */
    outlines?: 'auto' | 'off' | AtlasOutlines;
    /** The render mode the display objects will ask for, see `MarrowLoadOptions.renderMode`. Default `auto`. */
    renderMode?: 'auto' | 'mesh' | 'batched';
    /** The name of the asset, see `MarrowAsset.name`. Default: the empty string. */
    name?: string;
}

/**
 * Where the outlines of an asset stand.
 *
 * - `given`: the load got them, as a file or as an object.
 * - `scanned`: they were read from the page images after the load.
 * - `scanning`: the page images are being read at the moment, and there are none yet.
 * - `unread`: the scan ended and could read no page image. Every region keeps its quad.
 * - `off`: the asset was loaded with `outlines: 'off'`, the default.
 */
export type OutlinesState = 'given' | 'scanned' | 'scanning' | 'unread' | 'off';
