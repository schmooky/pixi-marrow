import { GlProgram, GpuProgram, Shader, ShaderStage, type TextureSource, type TextureStyle } from 'pixi.js';
import { GL_ROUND, glFragment, wgslFragment, wgslHead } from './shader';

/*
 * The shader of the mesh mode with `skinning: 'gpu'`, as GLSL for WebGL2 and as WGSL for WebGPU.
 * The fragment stage is the one of `shader.ts`. The vertex stage places a vertex from the pose,
 * then goes on with the statements of `shader.ts`, so that the steps after the pose are the same.
 *
 * Three data textures are read with exact texel loads, never sampled:
 *
 * - `uBones`: the world transform of each bone, 6 numbers a bone packed tight, 32-bit floats.
 *   Bone 2k fills texel 3k and half of texel 3k + 1, bone 2k + 1 the rest of the three.
 * - `uInfluences`: per influence the bone, x, y and the weight, 32-bit floats. A vertex of a
 *   region or of a mesh without weights has one influence with a weight of 1.
 * - `uPalette`: two texels a slot, as bytes. The light color, straight. The dark color times the
 *   alpha of the light color, and as its alpha 255 when the CPU placed the vertices of the slot.
 *
 * Attribute `aSkin` holds the first influence of a vertex, then its count in the low 16 bits
 * and its slot in the high 16. A count of 0 or the flag of the palette takes `aPosition` as it is:
 * the CPU placed it in skeleton space, for a mesh with a deform or a region with a sequence.
 *
 * Each vertex adds `(x * a + y * b + worldX) * weight` and `(x * c + y * d + worldY) * weight`
 * in the order of the official runtime, in 32-bit floats. The CPU adds the same terms in 64-bit
 * and rounds once. The two differ in the last bits of a position.
 */

/** The bindings of the data textures in group 2, after the 16 of 8 pages. */
const BONES = 16;
const INFLUENCES = 17;
const PALETTE = 18;

/** The data textures a shader of a view reads. */
export interface SkinTextures {
    readonly bones: TextureSource;
    readonly influences: TextureSource;
    readonly palette: TextureSource;
}

/** How the GLSL vertex stage finds the light color, the dark color and the position of a vertex. */
const GL_SKIN = `
vec4 texelAt(highp sampler2D data, uint index) {
    uint width = uint(textureSize(data, 0).x);

    return texelFetch(data, ivec2(int(index % width), int(index / width)), 0);
}

vec2 place(vec4 dark) {
    uint count = aSkin.y & 65535u;

    if (count == 0u || dark.a > 0.5) return aPosition;
    vec2 sum = vec2(0.0);

    for (uint k = 0u; k < count; k++) {
        vec4 influence = texelAt(uInfluences, aSkin.x + k);
        uint bone = uint(influence.x);
        uint at = (bone >> 1u) * 3u;
        vec4 m;
        vec2 t;

        if ((bone & 1u) == 0u) {
            m = texelAt(uBones, at);
            t = texelAt(uBones, at + 1u).xy;
        } else {
            vec4 p = texelAt(uBones, at + 1u);
            vec4 q = texelAt(uBones, at + 2u);

            m = vec4(p.zw, q.xy);
            t = q.zw;
        }
        sum.x += (influence.y * m.x + influence.z * m.y + t.x) * influence.w;
        sum.y += (influence.y * m.z + influence.z * m.w + t.y) * influence.w;
    }

    return sum;
}`;

function glVertex(dark: boolean, pages: number): string {
    return `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec4 aFlags;
in uvec2 aSkin;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform float uRound;
uniform highp sampler2D uBones;
uniform highp sampler2D uInfluences;
uniform highp sampler2D uPalette;

out vec2 vUV;
out vec4 vLight;
${dark ? 'out vec4 vDark;' : ''}
${pages > 1 ? 'flat out float vPage;' : ''}
${GL_ROUND}
${GL_SKIN}

void main(void) {
    uint slot = aSkin.y >> 16u;
    vec4 light = texelAt(uPalette, slot * 2u);
    vec4 dark = texelAt(uPalette, slot * 2u + 1u);
    // the same steps as the batch shader of Pixi, so that the same bits come out
    mat3 worldTransformMatrix = uWorldTransformMatrix;
    mat3 modelMatrix = mat3(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    vec2 position = (uTransformMatrix * vec3(place(dark), 1.0)).xy;
    mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;
    vec4 tint = uColor * uWorldColorAlpha;

    gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    if (uRound == 1.0) {
        gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
    }
    vUV = aUV;
    vLight = vec4(light.rgb * light.a, light.a) * tint;
    // additive: the color stays, the alpha leaves the blend equation
    vLight.a *= 1.0 - aFlags.y;
    ${dark ? 'vDark = vec4(dark.rgb * tint.a, 1.0);' : ''}
    ${pages > 1 ? 'vPage = aFlags.x * 255.0;' : ''}
}
`;
}

const WGSL_TEXTURES = `@group(2) @binding(${BONES}) var uBones: texture_2d<f32>;
@group(2) @binding(${INFLUENCES}) var uInfluences: texture_2d<f32>;
@group(2) @binding(${PALETTE}) var uPalette: texture_2d<f32>;
`;

const WGSL_SKIN = `fn texelAt(data: texture_2d<f32>, index: u32) -> vec4<f32> {
    let width = textureDimensions(data).x;

    return textureLoad(data, vec2<u32>(index % width, index / width), 0);
}

fn place(skin: vec2<u32>, position: vec2<f32>, dark: vec4<f32>) -> vec2<f32> {
    let count = skin.y & 65535u;

    if (count == 0u || dark.a > 0.5) {
        return position;
    }
    var sum = vec2<f32>(0.0, 0.0);

    for (var k = 0u; k < count; k++) {
        let influence = texelAt(uInfluences, skin.x + k);
        let bone = u32(influence.x);
        let at = (bone >> 1u) * 3u;
        var m: vec4<f32>;
        var t: vec2<f32>;

        if ((bone & 1u) == 0u) {
            m = texelAt(uBones, at);
            t = texelAt(uBones, at + 1u).xy;
        } else {
            let p = texelAt(uBones, at + 1u);
            let q = texelAt(uBones, at + 2u);

            m = vec4<f32>(p.zw, q.xy);
            t = q.zw;
        }
        sum.x += (influence.y * m.x + influence.z * m.y + t.x) * influence.w;
        sum.y += (influence.y * m.z + influence.z * m.w + t.y) * influence.w;
    }

    return sum;
}`;

function wgsl(dark: boolean, pages: number): string {
    return `${wgslHead(dark, pages, WGSL_TEXTURES)}

${WGSL_SKIN}

@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
    @location(2) aFlags: vec4<f32>,
    @location(3) aSkin: vec2<u32>,
) -> Varyings {
    let slot = aSkin.y >> 16u;
    let light = texelAt(uPalette, slot * 2u);
    let dark = texelAt(uPalette, slot * 2u + 1u);
    // the same steps as the batch shader of Pixi, so that the same bits come out
    var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
    var modelMatrix = mat3x3<f32>(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    var position = (localUniforms.uTransformMatrix * vec3<f32>(place(aSkin, aPosition, dark), 1.0)).xy;
    var modelViewProjectionMatrix = globalUniforms.uProjectionMatrix * worldTransformMatrix * modelMatrix;
    var clip = (modelViewProjectionMatrix * vec3<f32>(position, 1.0)).xy;
    let tint = localUniforms.uColor * globalUniforms.uWorldColorAlpha;
    var varyings: Varyings;

    if (localUniforms.uRound == 1.0) {
        clip = roundPixels(clip, globalUniforms.uResolution);
    }
    varyings.position = vec4<f32>(clip, 0.0, 1.0);
    varyings.uv = aUV;
    // additive: the color stays, the alpha leaves the blend equation
    varyings.light = vec4<f32>(light.rgb * light.a * tint.rgb, light.a * tint.a * (1.0 - aFlags.y));
    ${dark ? 'varyings.dark = vec4<f32>(dark.rgb * tint.a, 1.0);' : ''}
    ${pages > 1 ? 'varyings.page = u32(aFlags.x * 255.0 + 0.5);' : ''}

    return varyings;
}

${wgslFragment(dark, pages)}`;
}

/**
 * The WebGPU program of a tint mode and a page count, with the layout of its data textures set
 * right. Pixi derives the layout from the WGSL source, and two things of it do not fit.
 *
 * - Float textures of 32 bits cannot be filtered without a feature that Pixi does not ask for,
 *   so the bones and the influences are bound as unfilterable. Pixi takes every texture as filterable.
 * - The vertex stage reads the data textures. pixi.js 8.16 shows a texture to the fragment stage
 *   alone, and WebGPU then refuses the pipeline. pixi.js 8.21 shows it to both stages.
 */
function gpuProgram(name: string, dark: boolean, pages: number): GpuProgram {
    const source = wgsl(dark, pages);
    const program = GpuProgram.from({
        name,
        vertex: { source, entryPoint: 'mainVertex' },
        fragment: { source, entryPoint: 'mainFragment' },
    });

    for (const entry of program.gpuLayout[2] ?? []) {
        if (entry.texture === undefined || entry.binding < BONES) continue;
        entry.visibility = ShaderStage.VERTEX | ShaderStage.FRAGMENT;
        if (entry.binding !== PALETTE) entry.texture.sampleType = 'unfilterable-float';
    }

    return program;
}

/**
 * The shader that draws one range of a skeleton whose vertex shader places the vertices: the
 * pages the range samples, 1 to `MAX_PAGES`, and the data textures of the view. The programs
 * are shared, the shader is not: it holds the bones and the palette of one instance. Give it
 * back with `releaseShader`, which destroys it.
 *
 * @example
 * const shader = createSkinShader([texture.source], false, { bones, influences, palette });
 * const mesh = new Mesh({ geometry, shader });
 */
export function createSkinShader(sources: readonly TextureSource[], dark: boolean, skin: SkinTextures): Shader {
    const pages = sources.length;
    const name = `marrow-skin-${dark ? 'dark' : 'light'}-${pages}`;
    const resources: Record<string, TextureSource | TextureStyle> = {
        uBones: skin.bones,
        uInfluences: skin.influences,
        uPalette: skin.palette,
    };

    sources.forEach((page, i) => {
        resources[`uTexture${i}`] = page;
        resources[`uSampler${i}`] = page.style;
    });

    return new Shader({
        glProgram: GlProgram.from({ name, vertex: glVertex(dark, pages), fragment: glFragment(dark, pages) }),
        gpuProgram: gpuProgram(name, dark, pages),
        resources,
    });
}
