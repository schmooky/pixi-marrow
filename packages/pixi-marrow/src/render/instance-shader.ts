import { GlProgram, GpuProgram, Shader, ShaderStage, type TextureSource, type TextureStyle } from 'pixi.js';
import { GL_ROUND, glFragment, WGSL_ROUND, wgslFragment } from './shader';

/*
 * The shader of an instanced draw: the instances of one layout that follow each other in Pixi's
 * render order, in one draw. It is the shader of `skin-shader.ts`, with what an instance is in
 * attributes of its own (`instance: true`) in place of the uniforms of a mesh:
 *
 * - `iMatrix0` to `iMatrix2` are the columns of the transform of the instance in its render
 *   group, the matrix Pixi hands a mesh as `uTransformMatrix`. `iColor` is the tint and alpha,
 *   as `uColor`. The vertex stage goes through the same statements as for a mesh alone.
 * - `iBase` says where the instance keeps its pose in the textures of its pool: its first texel
 *   of the bones, of the palette, and of the vertices the CPU places.
 *
 * Every entry of the layout is in the index buffer, in the draw order of the instances. The
 * palette holds three texels a slot: the light color, the dark color, and the entry the slot
 * shows with its page. A vertex of any other entry goes to a point outside the clip volume. All
 * vertices of its triangle go to the same point, and the triangle draws nothing.
 *
 * The vertices the CPU places, of a mesh with a deform or a region with a sequence, are a texel
 * each in the pose texture: x, y, u, v. `aEntry` holds the entry of a vertex, and where its texel
 * is with the high bit set when its texture coordinates come from the texel: an entry with a
 * sequence shows other regions in other instances.
 *
 * The data textures are read with exact texel loads, as in `skin-shader.ts`.
 */

/** The bindings of the data textures in group 1, after the 16 of 8 pages. */
const POSE = 16;
const INFLUENCES = 17;
const PALETTE = 18;

/** What an instanced shader reads besides the pages. */
export interface InstanceTextures {
    /** The bones of every instance, then the vertices the CPU places. 32-bit floats. */
    readonly pose: TextureSource;
    /** Per influence: bone, x, y, weight. Shared by the views of a layout. */
    readonly influences: TextureSource;
    /** Three texels a slot of every instance. Bytes. */
    readonly palette: TextureSource;
}

const GL_PLACE = `
vec4 texelAt(highp sampler2D data, uint index) {
    uint width = uint(textureSize(data, 0).x);

    return texelFetch(data, ivec2(int(index % width), int(index / width)), 0);
}

vec2 placeAt(uint base) {
    uint count = aSkin.y & 65535u;
    vec2 sum = vec2(0.0);

    for (uint k = 0u; k < count; k++) {
        vec4 influence = texelAt(uInfluences, aSkin.x + k);
        uint bone = uint(influence.x);
        uint at = base + (bone >> 1u) * 3u;
        vec4 m;
        vec2 t;

        if ((bone & 1u) == 0u) {
            m = texelAt(uPose, at);
            t = texelAt(uPose, at + 1u).xy;
        } else {
            vec4 p = texelAt(uPose, at + 1u);
            vec4 q = texelAt(uPose, at + 2u);

            m = vec4(p.zw, q.xy);
            t = q.zw;
        }
        sum.x += (influence.y * m.x + influence.z * m.y + t.x) * influence.w;
        sum.y += (influence.y * m.z + influence.z * m.w + t.y) * influence.w;
    }

    return sum;
}`;

function glVertex(dark: boolean, pages: number, round: boolean): string {
    return `#version 300 es
in vec2 aUV;
in vec4 aFlags;
in uvec2 aSkin;
in uvec2 aEntry;
in vec3 iMatrix0;
in vec3 iMatrix1;
in vec3 iMatrix2;
in vec4 iColor;
in uvec3 iBase;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform highp sampler2D uPose;
uniform highp sampler2D uInfluences;
uniform highp sampler2D uPalette;

out vec2 vUV;
out vec4 vLight;
${dark ? 'out vec4 vDark;' : ''}
${pages > 1 ? 'flat out float vPage;' : ''}
${GL_ROUND}
${GL_PLACE}

void main(void) {
    uint slot = aSkin.y >> 16u;
    uint at = iBase.y + slot * 3u;
    vec4 shown = texelAt(uPalette, at + 2u);
    uint entry = uint(shown.x * 255.0 + 0.5) + (uint(shown.y * 255.0 + 0.5) << 8u);

    // the slot shows another entry, or none
    if (entry != aEntry.x) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vec4 light = texelAt(uPalette, at);
    vec4 dark = texelAt(uPalette, at + 1u);
    bool cpu = (aSkin.y & 65535u) == 0u || dark.a > 0.5;
    bool sequence = aEntry.y >= 2147483648u;
    vec2 point = vec2(0.0);
    vec2 uv = aUV;

    if (cpu || sequence) {
        vec4 texel = texelAt(uPose, iBase.z + (aEntry.y & 2147483647u));

        if (cpu) point = texel.xy;
        if (sequence) uv = texel.zw;
    }
    if (!cpu) point = placeAt(iBase.x);
    // the same steps as the batch shader of Pixi, so that the same bits come out
    mat3 worldTransformMatrix = uWorldTransformMatrix;
    mat3 modelMatrix = mat3(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    mat3 transformMatrix = mat3(iMatrix0, iMatrix1, iMatrix2);
    vec2 position = (transformMatrix * vec3(point, 1.0)).xy;
    mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;
    vec4 tint = iColor * uWorldColorAlpha;

    gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    ${round ? 'gl_Position.xy = roundPixels(gl_Position.xy, uResolution);' : ''}
    vUV = uv;
    vLight = vec4(light.rgb * light.a, light.a) * tint;
    // additive: the color stays, the alpha leaves the blend equation
    vLight.a *= 1.0 - aFlags.y;
    ${dark ? 'vDark = vec4(dark.rgb * tint.a, 1.0);' : ''}
    ${pages > 1 ? 'vPage = shown.z * 255.0;' : ''}
}
`;
}

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

/** The WGSL head: the uniforms of the render group, the pages and the data textures in group 1, the varyings. */
function wgslHead(dark: boolean, pages: number): string {
    const textures = range(pages)
        .map(
            (i) =>
                `@group(1) @binding(${i * 2}) var uTexture${i}: texture_2d<f32>;\n` +
                `@group(1) @binding(${i * 2 + 1}) var uSampler${i}: sampler;`,
        )
        .join('\n');

    return `struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
${textures}
@group(1) @binding(${POSE}) var uPose: texture_2d<f32>;
@group(1) @binding(${INFLUENCES}) var uInfluences: texture_2d<f32>;
@group(1) @binding(${PALETTE}) var uPalette: texture_2d<f32>;

struct Varyings {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) light: vec4<f32>,
    ${dark ? '@location(2) dark: vec4<f32>,' : ''}
    ${pages > 1 ? '@location(3) @interpolate(flat) page: u32,' : ''}
}

${WGSL_ROUND}`;
}

const WGSL_PLACE = `fn texelAt(data: texture_2d<f32>, index: u32) -> vec4<f32> {
    let width = textureDimensions(data).x;

    return textureLoad(data, vec2<u32>(index % width, index / width), 0);
}

fn placeAt(skin: vec2<u32>, base: u32) -> vec2<f32> {
    let count = skin.y & 65535u;
    var sum = vec2<f32>(0.0, 0.0);

    for (var k = 0u; k < count; k++) {
        let influence = texelAt(uInfluences, skin.x + k);
        let bone = u32(influence.x);
        let at = base + (bone >> 1u) * 3u;
        var m: vec4<f32>;
        var t: vec2<f32>;

        if ((bone & 1u) == 0u) {
            m = texelAt(uPose, at);
            t = texelAt(uPose, at + 1u).xy;
        } else {
            let p = texelAt(uPose, at + 1u);
            let q = texelAt(uPose, at + 2u);

            m = vec4<f32>(p.zw, q.xy);
            t = q.zw;
        }
        sum.x += (influence.y * m.x + influence.z * m.y + t.x) * influence.w;
        sum.y += (influence.y * m.z + influence.z * m.w + t.y) * influence.w;
    }

    return sum;
}`;

function wgsl(dark: boolean, pages: number, round: boolean): string {
    return `${wgslHead(dark, pages)}

${WGSL_PLACE}

@vertex
fn mainVertex(
    @location(0) aUV: vec2<f32>,
    @location(1) aFlags: vec4<f32>,
    @location(2) aSkin: vec2<u32>,
    @location(3) aEntry: vec2<u32>,
    @location(4) iMatrix0: vec3<f32>,
    @location(5) iMatrix1: vec3<f32>,
    @location(6) iMatrix2: vec3<f32>,
    @location(7) iColor: vec4<f32>,
    @location(8) iBase: vec3<u32>,
) -> Varyings {
    let slot = aSkin.y >> 16u;
    let at = iBase.y + slot * 3u;
    let shown = texelAt(uPalette, at + 2u);
    let entry = u32(shown.x * 255.0 + 0.5) + (u32(shown.y * 255.0 + 0.5) << 8u);
    var varyings: Varyings;

    // the slot shows another entry, or none
    if (entry != aEntry.x) {
        varyings.position = vec4<f32>(2.0, 2.0, 2.0, 1.0);

        return varyings;
    }
    let light = texelAt(uPalette, at);
    let dark = texelAt(uPalette, at + 1u);
    let cpu = (aSkin.y & 65535u) == 0u || dark.a > 0.5;
    let sequence = aEntry.y >= 2147483648u;
    var point = vec2<f32>(0.0, 0.0);
    var uv = aUV;

    if (cpu || sequence) {
        let texel = texelAt(uPose, iBase.z + (aEntry.y & 2147483647u));

        if (cpu) {
            point = texel.xy;
        }
        if (sequence) {
            uv = texel.zw;
        }
    }
    if (!cpu) {
        point = placeAt(aSkin, iBase.x);
    }
    // the same steps as the batch shader of Pixi, so that the same bits come out
    var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
    var modelMatrix = mat3x3<f32>(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    var transformMatrix = mat3x3<f32>(iMatrix0, iMatrix1, iMatrix2);
    var position = (transformMatrix * vec3<f32>(point, 1.0)).xy;
    var modelViewProjectionMatrix = globalUniforms.uProjectionMatrix * worldTransformMatrix * modelMatrix;
    var clip = (modelViewProjectionMatrix * vec3<f32>(position, 1.0)).xy;
    let tint = iColor * globalUniforms.uWorldColorAlpha;

    ${round ? 'clip = roundPixels(clip, globalUniforms.uResolution);' : ''}
    varyings.position = vec4<f32>(clip, 0.0, 1.0);
    varyings.uv = uv;
    // additive: the color stays, the alpha leaves the blend equation
    varyings.light = vec4<f32>(light.rgb * light.a * tint.rgb, light.a * tint.a * (1.0 - aFlags.y));
    ${dark ? 'varyings.dark = vec4<f32>(dark.rgb * tint.a, 1.0);' : ''}
    ${pages > 1 ? 'varyings.page = u32(shown.z * 255.0 + 0.5);' : ''}

    return varyings;
}

${wgslFragment(dark, pages)}`;
}

/**
 * The WebGPU program of a variant, with the layout of its data textures set right, as in
 * `skin-shader.ts`: the float textures are unfilterable, and the vertex stage sees every texture.
 */
function gpuProgram(name: string, dark: boolean, pages: number, round: boolean): GpuProgram {
    const source = wgsl(dark, pages, round);
    const program = GpuProgram.from({
        name,
        vertex: { source, entryPoint: 'mainVertex' },
        fragment: { source, entryPoint: 'mainFragment' },
    });

    for (const entry of program.gpuLayout[1] ?? []) {
        if (entry.texture === undefined || entry.binding < POSE) continue;
        entry.visibility = ShaderStage.VERTEX | ShaderStage.FRAGMENT;
        if (entry.binding !== PALETTE) entry.texture.sampleType = 'unfilterable-float';
    }

    return program;
}

/**
 * The shader of instanced draws: the pages of a layout, 1 to 8, and the data textures of a pool.
 * `round` rounds positions to pixels, as Pixi does for a renderer with `roundPixels`. The
 * programs are shared by variant. Destroy the shader when the pool is gone.
 *
 * @example
 * const shader = createInstanceShader(pages, false, false, { pose, influences, palette });
 * renderer.encoder.draw({ geometry, shader, state, size: union.count, instanceCount: 200 });
 */
export function createInstanceShader(
    sources: readonly TextureSource[],
    dark: boolean,
    round: boolean,
    textures: InstanceTextures,
): Shader {
    const pages = sources.length;
    const name = `marrow-instances-${dark ? 'dark' : 'light'}-${pages}${round ? '-round' : ''}`;
    const resources: Record<string, TextureSource | TextureStyle> = {
        uPose: textures.pose,
        uInfluences: textures.influences,
        uPalette: textures.palette,
    };

    sources.forEach((page, i) => {
        resources[`uTexture${i}`] = page;
        resources[`uSampler${i}`] = page.style;
    });

    return new Shader({
        glProgram: GlProgram.from({ name, vertex: glVertex(dark, pages, round), fragment: glFragment(dark, pages) }),
        gpuProgram: gpuProgram(name, dark, pages, round),
        resources,
    });
}
