import { ImageSource, Texture } from 'pixi.js';
import { MarrowAsset } from 'pixi-marrow';
import type { PickedFile, RigFiles } from './files';

/*
 * Loads the rigs of the playground from files in memory. The skeleton goes to pixi-marrow as
 * bytes or as parsed JSON. The atlas goes as a blob URL, and every page as a texture of a
 * decoded image, so any format the browser decodes works, AVIF too. Rigs that share an atlas
 * share its URL and its textures.
 */

/** What the files of one drop hold in memory: the atlas URLs and the page textures. */
export class FileStore {
    private readonly urls = new Map<File, string>();
    private readonly textures = new Map<File, Promise<Texture>>();

    /** A blob URL of a file, made once. */
    urlOf(file: File): string {
        let url = this.urls.get(file);

        if (url === undefined) {
            url = URL.createObjectURL(file);
            this.urls.set(file, url);
        }

        return url;
    }

    /** A texture of an image file, decoded once. pixi-marrow sets its alpha mode from the atlas page. */
    textureOf(picked: PickedFile): Promise<Texture> {
        let texture = this.textures.get(picked.file);

        if (texture === undefined) {
            texture = decode(this.urlOf(picked.file), picked);
            this.textures.set(picked.file, texture);
        }

        return texture;
    }

    /** Frees the textures and the URLs. The assets that use them must be destroyed first. */
    destroy(): void {
        for (const texture of this.textures.values()) {
            void texture.then((loaded) => loaded.destroy(true)).catch(() => {});
        }
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.textures.clear();
        this.urls.clear();
    }
}

/** A texture of an image at a URL. An image element keeps its pixels, so pixi-marrow can read outlines from it. */
async function decode(url: string, picked: PickedFile): Promise<Texture> {
    const image = new Image();

    image.src = url;
    try {
        await image.decode();
    } catch {
        throw new Error(await whyNoImage(picked));
    }

    return new Texture({ source: new ImageSource({ resource: image, label: picked.path }) });
}

/** True when bytes start with a signature, where `null` matches any byte. */
const startsWith = (bytes: Uint8Array, signature: readonly (number | null)[], at = 0): boolean =>
    signature.every((byte, i) => byte === null || bytes[at + i] === byte);

/**
 * Why the browser could not decode an image file. A file that starts like a PNG, JPEG, WebP or
 * AVIF is one the browser does not support. A file of text is often a placeholder that a tool
 * saved in place of an image it could not download.
 */
async function whyNoImage({ file, path }: PickedFile): Promise<string> {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const image =
        startsWith(head, [0x89, 0x50, 0x4e, 0x47]) ||
        startsWith(head, [0xff, 0xd8, 0xff]) ||
        (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) ||
        startsWith(head, [0x66, 0x74, 0x79, 0x70], 4);

    if (image) return `The browser cannot decode ${path}. It may not support this image format.`;
    const text = new TextDecoder().decode(head);

    if (/^[\t\n\r\x20-\x7e]+$/.test(text)) {
        return `${path} is no image but ${file.size} bytes of text: "${text.slice(0, 40).trim()}". The tool that saved it could not download the image, so get the image again.`;
    }

    return `${path} is no image: it does not start like a PNG, JPEG, WebP or AVIF file.`;
}

/** The message of an error. The message of an error of pixi-marrow already ends with its fix. */
export function explain(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Loads one rig into an asset.
 *
 * @example
 * const asset = await loadRig(rig, store, 'auto');
 */
export async function loadRig(rig: RigFiles, store: FileStore, renderMode: 'auto' | 'mesh'): Promise<MarrowAsset> {
    const { skeleton } = rig;
    const data = /\.json$/i.test(skeleton.path)
        ? (JSON.parse(await skeleton.file.text()) as object)
        : await skeleton.file.arrayBuffer();
    const entries = await Promise.all(
        [...rig.pages].map(async ([page, image]) => [page, await store.textureOf(image)] as const),
    );

    return MarrowAsset.load({
        skeleton: data,
        atlas: store.urlOf(rig.atlas.file),
        textures: Object.fromEntries(entries),
        renderMode,
    });
}
