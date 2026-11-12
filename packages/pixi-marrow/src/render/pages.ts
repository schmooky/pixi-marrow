import { Buffer, BufferUsage, type Texture, type TextureSource } from 'pixi.js';
import { MarrowError } from '../base/errors';
import type { AtlasModel } from '../model/atlas';

/**
 * The sources of the page textures of an atlas, in page order. Throws a {@link MarrowError} when
 * a page has no texture or a texture is not premultiplied.
 *
 * @example
 * const sources = pageSources(atlas, textures);
 * console.log(sources.length === atlas.pages.length); // true
 */
export function pageSources(atlas: AtlasModel, textures: readonly Texture[]): TextureSource[] {
    return atlas.pages.map((page, index) => {
        const texture = textures[index];

        if (texture === undefined) {
            throw new MarrowError(
                'invalid-data',
                `The atlas has ${atlas.pages.length} pages and the view got ${textures.length} textures.`,
                { fix: 'Pass one texture per atlas page, in page order.' },
            );
        }
        if (texture.source.alphaMode === 'no-premultiply-alpha') {
            throw new MarrowError(
                'invalid-data',
                `The texture of the atlas page "${page.name}" is not premultiplied.`,
                {
                    fix: 'Set the alphaMode of its source to "premultiply-alpha-on-upload", or to "premultiplied-alpha" for a premultiplied image.',
                },
            );
        }

        return texture.source;
    });
}

/**
 * A Pixi vertex buffer for the data of a template. It keeps its size when the data shrinks.
 *
 * @example
 * const positions = vertexBuffer(template.positions, 'marrow-positions');
 */
export function vertexBuffer(data: Float32Array | Uint8Array, label: string): Buffer {
    return new Buffer({ data, label, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST, shrinkToFit: false });
}
