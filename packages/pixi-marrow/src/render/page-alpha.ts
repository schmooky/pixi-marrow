import { DOMAdapter, type TextureSource } from 'pixi.js';
import type { PagePixels } from '../geometry/outlines';

/*
 * Tight outlines and opaque rectangles come from the pixels of the atlas pages. In the browser
 * a page is an image that only the GPU holds. A 2D canvas gives its pixels back, with the alpha
 * as it is and the color multiplied by it.
 *
 * That is enough for a straight page: the GPU multiplies its colors by alpha on upload, so a
 * pixel with alpha 0 is black there too. A premultiplied page is uploaded as it is. A color
 * under alpha 0 stays on the GPU and adds light. Such a page is read through WebGL, which
 * returns the bytes the GPU got.
 */

/** The formats of four bytes per pixel with alpha in the last one. */
const BYTE_FORMATS: readonly string[] = ['rgba8unorm', 'rgba8unorm-srgb', 'bgra8unorm', 'bgra8unorm-srgb'];

/** An image a 2D canvas can draw: an object with a size. Typed arrays and lists do not pass. */
function isDrawable(resource: unknown): resource is CanvasImageSource {
    if (typeof resource !== 'object' || resource === null) return false;
    if (ArrayBuffer.isView(resource) || Array.isArray(resource)) return false;

    return 'width' in resource || 'displayWidth' in resource;
}

/** The bytes of a texture that was made from pixels in memory, when they are four bytes per pixel. */
function bufferPixels(source: TextureSource, resource: unknown): PagePixels | null {
    const { pixelWidth: width, pixelHeight: height } = source;
    const bytes = resource instanceof Uint8Array || resource instanceof Uint8ClampedArray;

    if (!bytes || !BYTE_FORMATS.includes(source.format) || resource.length !== width * height * 4) return null;

    return { width, height, data: resource };
}

/**
 * Reads the pixels of the image behind a Pixi texture source, as red, green, blue, alpha bytes.
 * `buildAtlasOutlines` takes them as the pixels of an atlas page.
 *
 * The image is drawn to a 2D canvas and read back. Returns null when that is not possible.
 * That is the case without a 2D context, as in Node, and for a compressed texture. It is also
 * the case for an image of another origin, which taints the canvas, and for a source without
 * an image.
 *
 * A texture made from bytes in memory is returned as it is, without a copy. Pixi names such
 * bytes `bgra8unorm` by default. Red and blue can then be swapped, which changes nothing for
 * an outline.
 *
 * A canvas keeps colors multiplied by alpha. The alpha it gives back is exact. A pixel with
 * alpha 0 comes back black, whatever color the image had there. On a premultiplied page such
 * a color would add light, and this function cannot see it.
 *
 * @example
 * const pages = textures.map((texture) => readPagePixels(texture.source));
 * const outlines = buildAtlasOutlines(atlas, pages);
 */
export function readPagePixels(source: TextureSource): PagePixels | null {
    const resource: unknown = source.resource;
    const { pixelWidth: width, pixelHeight: height } = source;

    if (!isDrawable(resource)) return bufferPixels(source, resource);
    if (!(width > 0 && height > 0)) return null;
    try {
        const context = DOMAdapter.get().createCanvas(width, height).getContext('2d', { willReadFrequently: true });

        if (context === null) return null;
        context.drawImage(resource, 0, 0);

        return { width, height, data: context.getImageData(0, 0, width, height).data };
    } catch {
        // a tainted canvas and an image that cannot be drawn both throw
        return null;
    }
}

/** Reads the pixels of atlas pages, as the GPU holds them where that matters. */
export interface PageReader {
    /**
     * The pixels behind a texture source, or null when they cannot be read. `premultiplied` says
     * that the atlas marks the page as premultiplied. Such a page is read without a multiplication
     * by alpha, so that a color under alpha 0 comes back.
     */
    read(source: TextureSource, premultiplied: boolean): PagePixels | null;
    /** Frees what the reader holds: its WebGL context, when it made one. */
    release(): void;
}

/** A WebGL context that is used to read pixels and nothing else. */
type Gl = WebGLRenderingContext | WebGL2RenderingContext;

const isGl = (context: unknown): context is Gl =>
    typeof context === 'object' && context !== null && 'texImage2D' in context && 'readPixels' in context;

/** An image WebGL can upload without a size: a bitmap, an image element, a canvas or a video frame. */
const isUploadable = (resource: unknown): resource is TexImageSource => isDrawable(resource);

/** Uploads an image as it is, attaches it to a framebuffer and reads it back. Null when WebGL refuses. */
function readThroughGl(gl: Gl, resource: TexImageSource, width: number, height: number): PagePixels | null {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    const data = new Uint8Array(width * height * 4);

    try {
        // the bytes of the image: no multiplication by alpha, no color conversion, rows from the top
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, resource);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);

        return gl.getError() === gl.NO_ERROR ? { width, height, data } : null;
    } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
    }
}

/**
 * Creates a reader for the pages of one atlas. A straight page is read with
 * {@link readPagePixels}. A premultiplied page is read through a WebGL context of its own, which
 * the reader creates on first use and keeps for the next pages. Call `release` after the last page.
 *
 * `read` returns null for a page that cannot be read exactly: without WebGL, for an image of
 * another origin, for a compressed texture and for an image larger than WebGL takes.
 *
 * @example
 * const reader = createPageReader();
 * const pages = atlas.pages.map((page, i) => reader.read(textures[i]?.source ?? Texture.EMPTY.source, page.pma));
 * reader.release();
 * const outlines = buildAtlasOutlines(atlas, pages);
 */
export function createPageReader(): PageReader {
    let gl: Gl | null | undefined;
    const context = (): Gl | null => {
        if (gl !== undefined) return gl;
        const canvas = DOMAdapter.get().createCanvas(1, 1);
        const created: unknown = canvas.getContext('webgl2') ?? canvas.getContext('webgl');

        gl = isGl(created) ? created : null;

        return gl;
    };
    const exact = (source: TextureSource): PagePixels | null => {
        const resource: unknown = source.resource;
        const { pixelWidth: width, pixelHeight: height } = source;

        if (!isUploadable(resource)) return bufferPixels(source, resource);
        if (!(width > 0 && height > 0)) return null;
        try {
            const target = context();

            if (target === null || Math.max(width, height) > target.getParameter(target.MAX_TEXTURE_SIZE)) return null;

            return readThroughGl(target, resource, width, height);
        } catch {
            // no WebGL here, or an image of another origin
            return null;
        }
    };

    return {
        read: (source, premultiplied) => (premultiplied ? exact(source) : readPagePixels(source)),
        release() {
            gl?.getExtension('WEBGL_lose_context')?.loseContext();
            gl = undefined;
        },
    };
}
