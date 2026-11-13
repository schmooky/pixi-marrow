import { Buffer, BufferUsage, type Shader, type TextureSource } from 'pixi.js';
import type { SkeletonModel } from '../model/model';
import type { PoseState } from '../pose/state';
import type { PosePass } from './pose-pass';
import { releaseSkinLayout, retainSkinLayout, type SkinLayout } from './skin-layout';
import { SkinPose } from './skin-pose';
import { createSkinShader } from './skin-shader';
import { MAX_PAGES, type Template } from './template';
import type { VisibleList } from './visible';

/**
 * What a view of the mesh mode draws with when its vertex shader places the vertices. That is
 * the vertex buffer `aSkin` on the skin data of its layout, the bone and palette textures, and a
 * shader per group of pages that reads them. The skin data is shared by the views of a layout.
 *
 * @example
 * const skin = new MeshSkin(model, template, pages, dark);
 * const ranges = new DrawRanges({ ...options, buffers: { positions, statics, skin: skin.buffer }, shade: skin.shade });
 * skin.pose(pass, template, state, seen);
 */
export class MeshSkin {
    /** Per vertex: the first influence, and the influence count with the slot. See `skin-layout.ts`. */
    readonly buffer: Buffer;
    private readonly textures: SkinPose;
    private readonly model: SkeletonModel;
    private readonly pages: readonly TextureSource[];
    private readonly dark: boolean;
    private readonly shaders: Shader[] = [];
    /** The skin data of the layout, and the template it was taken for. */
    private layout: SkinLayout;
    private template: Template;

    constructor(model: SkeletonModel, template: Template, pages: readonly TextureSource[], dark: boolean) {
        this.model = model;
        this.pages = pages;
        this.dark = dark;
        this.template = template;
        this.layout = retainSkinLayout(template, model);
        this.textures = new SkinPose(model);
        this.buffer = new Buffer({
            data: this.layout.vertices,
            label: 'marrow-skin',
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
            shrinkToFit: false,
        });
    }

    /** The bytes of the bone and palette textures. The skin data of the layout is shared. */
    get bytes(): number {
        return this.textures.bytes;
    }

    /** The shader of a group of 8 pages. The draw ranges ask for it once per group and destroy it. */
    readonly shade = (group: number): Shader => {
        const { bones, palette } = this.textures;
        const shader = createSkinShader(this.pages.slice(group * MAX_PAGES, (group + 1) * MAX_PAGES), this.dark, {
            bones,
            influences: this.layout.influences,
            palette,
        });

        this.shaders.push(shader);

        return shader;
    };

    /** Takes the skin data of the layout of another template. */
    resize(template: Template): void {
        const before = this.layout;
        const after = retainSkinLayout(template, this.model);

        if (after !== before) {
            this.layout = after;
            this.buffer.data = after.vertices;
            // a destroyed shader has no resources
            for (const shader of this.shaders)
                if (shader.resources !== null) shader.resources.uInfluences = after.influences;
        }
        // the shaders hold the new influences before the old ones can be destroyed
        releaseSkinLayout(this.template, before);
        this.template = template;
    }

    /** See `SkinPose.pose`. The search for covered slots needs every position on the CPU. */
    pose(pass: PosePass, template: Template, state: PoseState, visible: VisibleList): void {
        this.textures.pose(pass, template, this.layout, state, visible, template.opaqueCount > 0);
    }

    /**
     * See `SkinPose.settle`. Does nothing for another template: the view draws in a batch then,
     * where the CPU places every vertex, and the skin data is that of the layout it left.
     */
    settle(template: Template, state: PoseState, visible: VisibleList): void {
        if (template !== this.template) return;
        this.textures.settle(template, this.layout, state, visible);
    }

    /** Frees the buffer and the textures, and gives the skin data back. The draw ranges destroy the shaders. */
    destroy(): void {
        releaseSkinLayout(this.template, this.layout);
        this.buffer.destroy();
        this.textures.destroy();
        this.shaders.length = 0;
    }
}
