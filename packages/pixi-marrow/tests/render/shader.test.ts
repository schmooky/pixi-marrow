import { Shader, ShaderStage, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createViewShader } from '../../src/render/shader';
import { createSkinShader } from '../../src/render/skin-shader';
import { MAX_PAGES } from '../../src/render/template';

/*
 * Shaders do not compile in Node. These tests hold the contract with Pixi that can be read from
 * the sources: the names Pixi binds by, and what each variant declares. The render check draws
 * with them in a browser.
 */

const sources = (count: number): TextureSource[] =>
    Array.from({ length: count }, () => new TextureSource({ width: 2, height: 2 }));

describe('createViewShader', () => {
    it.each([
        [false, 1],
        [false, 3],
        [true, 1],
        [true, MAX_PAGES],
    ])('declares what Pixi binds by name, dark %s with %i pages', (dark, pages) => {
        const shader = createViewShader(sources(pages), dark);
        const { glProgram, gpuProgram } = shader;

        expect(shader).toBeInstanceOf(Shader);
        // WebGPU: Pixi fills group 0 and 1 itself when they hold these names
        expect(gpuProgram.autoAssignGlobalUniforms).toBe(true);
        expect(gpuProgram.autoAssignLocalUniforms).toBe(true);
        expect(Object.keys(gpuProgram.layout[2] ?? {}).length).toBe(pages * 2);
        for (let page = 0; page < pages; page++) {
            expect(gpuProgram.layout[2]?.[`uTexture${page}`]).toBe(page * 2);
            expect(gpuProgram.layout[2]?.[`uSampler${page}`]).toBe(page * 2 + 1);
            expect(glProgram.fragment).toContain(`uniform sampler2D uTexture${page};`);
        }
        expect(glProgram.fragment).not.toContain(`uTexture${pages}`);
        // the attributes of the geometry, and no other
        const attributes = ['aPosition', 'aUV', 'aFlags', 'aColor', ...(dark ? ['aDark'] : [])];

        expect(Object.keys(gpuProgram.attributeData).sort()).toEqual([...attributes].sort());
        for (const name of attributes) expect(glProgram.vertex).toMatch(new RegExp(`in vec[24] ${name};`));
        expect(glProgram.vertex?.includes('aDark')).toBe(dark);
        // the uniforms of a Pixi mesh
        for (const name of [
            'uProjectionMatrix',
            'uWorldTransformMatrix',
            'uWorldColorAlpha',
            'uTransformMatrix',
            'uColor',
            'uRound',
        ]) {
            expect(glProgram.vertex).toContain(name);
            expect(gpuProgram.vertex?.source).toContain(name);
        }
        expect(gpuProgram.fragmentOutputMask).toBe(1);
        expect(glProgram.fragmentOutputMask).toBe(1);
    });

    it('shades with the two color tint of the official runtime only when asked', () => {
        const official = '((texel.a - 1.0) * vDark.a + 1.0 - texel.rgb) * vDark.rgb + texel.rgb * vLight.rgb';
        const dark = createViewShader(sources(1), true);
        const light = createViewShader(sources(1), false);

        expect(dark.glProgram.fragment).toContain(official);
        expect(dark.gpuProgram.fragment?.source).toContain(
            official.replaceAll('vDark', 'varyings.dark').replaceAll('vLight', 'varyings.light'),
        );
        expect(light.glProgram.fragment).toContain('finalColor = texel * vLight;');
        expect(light.gpuProgram.fragment?.source).toContain('return texel * varyings.light;');
        expect(light.glProgram.fragment).not.toContain('vDark');
    });

    it('shares programs between shaders of the same kind', () => {
        const first = createViewShader(sources(2), false);
        const second = createViewShader(sources(2), false);
        const other = createViewShader(sources(2), true);

        expect(second).not.toBe(first);
        expect(second.glProgram).toBe(first.glProgram);
        expect(second.gpuProgram).toBe(first.gpuProgram);
        expect(other.glProgram).not.toBe(first.glProgram);
    });

    it('binds each page and its sampler', () => {
        const pages = [Texture.WHITE.source, ...sources(2)];
        const shader = createViewShader(pages, false);

        pages.forEach((page, unit) => {
            expect(shader.resources[`uTexture${unit}`]).toBe(page);
            expect(shader.resources[`uSampler${unit}`]).toBe(page.style);
        });
    });
});

describe('createSkinShader', () => {
    const data = { bones: sources(1)[0], influences: sources(1)[0], palette: sources(1)[0] };

    it.each([
        [false, 1],
        [true, MAX_PAGES],
    ])('declares the data textures and the attributes, dark %s with %i pages', (dark, pages) => {
        const { bones, influences, palette } = data;

        if (bones === undefined || influences === undefined || palette === undefined) throw new Error('no source');
        const shader = createSkinShader(sources(pages), dark, { bones, influences, palette });
        const { glProgram, gpuProgram } = shader;
        const group = gpuProgram.gpuLayout[2] ?? [];
        const sampleType = (binding: number): string | undefined =>
            group.find((entry) => entry.binding === binding)?.texture?.sampleType;

        expect(gpuProgram.autoAssignGlobalUniforms).toBe(true);
        expect(gpuProgram.autoAssignLocalUniforms).toBe(true);
        expect(gpuProgram.layout[2]).toMatchObject({ uBones: 16, uInfluences: 17, uPalette: 18 });
        // 32-bit floats cannot be filtered without a feature Pixi does not ask for
        expect([sampleType(16), sampleType(17), sampleType(18)]).toEqual([
            'unfilterable-float',
            'unfilterable-float',
            'float',
        ]);
        expect(sampleType(0)).toBe('float');
        // the vertex stage reads the data textures, which pixi.js 8.16 shows to the fragment stage alone
        for (const binding of [16, 17, 18]) {
            expect(group.find((entry) => entry.binding === binding)?.visibility).toBe(
                ShaderStage.VERTEX | ShaderStage.FRAGMENT,
            );
        }
        expect(Object.keys(gpuProgram.attributeData).sort()).toEqual(['aFlags', 'aPosition', 'aSkin', 'aUV']);
        expect(gpuProgram.attributeData.aSkin?.format).toBe('uint32x2');
        expect(glProgram.vertex).toContain('in uvec2 aSkin;');
        for (const name of ['uBones', 'uInfluences', 'uPalette']) {
            expect(glProgram.vertex).toContain(`uniform highp sampler2D ${name};`);
            expect(shader.resources[name]).toBe(
                data[name === 'uBones' ? 'bones' : name === 'uPalette' ? 'palette' : 'influences'],
            );
        }
        // the fragment stage is the one of the view shader, under another name
        const unnamed = (source: string | undefined): string | undefined =>
            source?.replace(/#define SHADER_NAME .*\n/, '');

        expect(unnamed(glProgram.fragment)).toBe(unnamed(createViewShader(sources(pages), dark).glProgram.fragment));
        expect(glProgram.vertex?.includes('vDark')).toBe(dark);
    });

    it('shares the programs and not the shader', () => {
        const { bones, influences, palette } = data;

        if (bones === undefined || influences === undefined || palette === undefined) throw new Error('no source');
        const first = createSkinShader(sources(1), false, { bones, influences, palette });
        const second = createSkinShader(sources(1), false, { bones, influences, palette });

        expect(second).not.toBe(first);
        expect(second.glProgram).toBe(first.glProgram);
        expect(second.gpuProgram).toBe(first.gpuProgram);
    });
});
