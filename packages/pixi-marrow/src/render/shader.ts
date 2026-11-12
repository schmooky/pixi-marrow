import { GlProgram, GpuProgram, Shader, type TextureSource, type TextureStyle } from 'pixi.js';

/*
 * The one shader of the render path, as GLSL for WebGL2 and as WGSL for WebGPU. Both do the same:
 *
 * - The vertex stage places a vertex in two steps. The transform of the mesh gives the position
 *   the official runtime computes on the CPU. The statements of Pixi's batch shader then give the
 *   clip position, written out the same way, identity matrix included. A compiler then makes the
 *   same choices for both, and the same bits come out. It honors `uRound`.
 * - The container tint is `uColor * uWorldColorAlpha`, premultiplied, as Pixi passes it.
 * - The light color arrives straight. The vertex stage multiplies it by its alpha and the tint.
 * - The dark color arrives multiplied by the alpha of the light color, with an alpha of 1. The
 *   vertex stage multiplies it by the alpha of the tint.
 * - The fragment stage samples a premultiplied texel and writes a premultiplied color:
 *   `texel * light` without dark colors, or the two color tint of the official runtime with them.
 *   The expressions are those of the official shaders, term by term.
 * - An additive slot sets the alpha of the light color to 0 after the color was multiplied.
 *   The normal blend state then adds.
 *
 * Attribute `aFlags` holds two bytes: x is the texture unit of the page, y is 255 for additive.
 *
 * A clip mask has a shader of its own. It places a vertex with the same statements and writes no
 * color: Pixi draws a mask into the stencil buffer with color writes turned off.
 */

/** How many atlas pages one draw can sample. More pages split the draw. */
export const MAX_PAGES = 8;

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

const GL_ROUND = `
vec2 roundPixels(vec2 position, vec2 targetSize) {
    return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}`;

function glVertex(dark: boolean, pages: number): string {
    return `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec4 aFlags;
in vec4 aColor;
${dark ? 'in vec4 aDark;' : ''}

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;
uniform float uRound;

out vec2 vUV;
out vec4 vLight;
${dark ? 'out vec4 vDark;' : ''}
${pages > 1 ? 'flat out float vPage;' : ''}
${GL_ROUND}

void main(void) {
    // the same steps as the batch shader of Pixi, so that the same bits come out
    mat3 worldTransformMatrix = uWorldTransformMatrix;
    mat3 modelMatrix = mat3(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    vec2 position = (uTransformMatrix * vec3(aPosition, 1.0)).xy;
    mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;
    vec4 tint = uColor * uWorldColorAlpha;

    gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    if (uRound == 1.0) {
        gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
    }
    vUV = aUV;
    vLight = vec4(aColor.rgb * aColor.a, aColor.a) * tint;
    // additive: the color stays, the alpha leaves the blend equation
    vLight.a *= 1.0 - aFlags.y;
    ${dark ? 'vDark = vec4(aDark.rgb * tint.a, aDark.a);' : ''}
    ${pages > 1 ? 'vPage = aFlags.x * 255.0;' : ''}
}
`;
}

/** One texture lookup per page, chosen by the page of the triangle, as Pixi's batcher does it. */
function glSample(pages: number): string {
    if (pages === 1) return 'vec4 texel = texture(uTexture0, vUV);';
    const lines = range(pages).map((i) => {
        const test = i < pages - 1 ? `if (vPage < ${i}.5) ` : '';

        return `${i > 0 ? 'else ' : ''}${test}{ texel = texture(uTexture${i}, vUV); }`;
    });

    return `vec4 texel;\n    ${lines.join('\n    ')}`;
}

function glFragment(dark: boolean, pages: number): string {
    const color = dark
        ? 'vec4(((texel.a - 1.0) * vDark.a + 1.0 - texel.rgb) * vDark.rgb + texel.rgb * vLight.rgb, texel.a * vLight.a)'
        : 'texel * vLight';

    return `#version 300 es
in vec2 vUV;
in vec4 vLight;
${dark ? 'in vec4 vDark;' : ''}
${pages > 1 ? 'flat in float vPage;' : ''}

${range(pages)
    .map((i) => `uniform sampler2D uTexture${i};`)
    .join('\n')}

out vec4 finalColor;

void main(void) {
    ${glSample(pages)}
    finalColor = ${color};
}
`;
}

/**
 * WGSL forbids implicit derivatives inside a branch, so the derivatives are taken before it.
 * A single page samples the same way, as the batch shader of Pixi does.
 */
function wgslSample(pages: number): string {
    const sample = (i: number): string => `textureSampleGrad(uTexture${i}, uSampler${i}, varyings.uv, dx, dy)`;
    const derivatives = `let dx = dpdx(varyings.uv);
    let dy = dpdy(varyings.uv);`;

    if (pages === 1) return `${derivatives}\n    let texel = ${sample(0)};`;
    const cases = range(pages).map((i) => `${i < pages - 1 ? `case ${i}:` : 'default:'} { texel = ${sample(i)}; }`);

    return `${derivatives}
    var texel: vec4<f32>;
    switch varyings.page {
        ${cases.join('\n        ')}
    }`;
}

/** The uniforms Pixi fills for a mesh, by these names. */
const WGSL_UNIFORMS = `struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
}

struct LocalUniforms {
    uTransformMatrix: mat3x3<f32>,
    uColor: vec4<f32>,
    uRound: f32,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;`;

const WGSL_ROUND = `fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32> {
    return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}`;

function wgsl(dark: boolean, pages: number): string {
    const color = dark
        ? `vec4<f32>(
        ((texel.a - 1.0) * varyings.dark.a + 1.0 - texel.rgb) * varyings.dark.rgb + texel.rgb * varyings.light.rgb,
        texel.a * varyings.light.a,
    )`
        : 'texel * varyings.light';

    return `${WGSL_UNIFORMS}
${range(pages)
    .map(
        (i) =>
            `@group(2) @binding(${i * 2}) var uTexture${i}: texture_2d<f32>;\n` +
            `@group(2) @binding(${i * 2 + 1}) var uSampler${i}: sampler;`,
    )
    .join('\n')}

struct Varyings {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) light: vec4<f32>,
    ${dark ? '@location(2) dark: vec4<f32>,' : ''}
    ${pages > 1 ? '@location(3) @interpolate(flat) page: u32,' : ''}
}

${WGSL_ROUND}

@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
    @location(2) aFlags: vec4<f32>,
    @location(3) aColor: vec4<f32>,
    ${dark ? '@location(4) aDark: vec4<f32>,' : ''}
) -> Varyings {
    // the same steps as the batch shader of Pixi, so that the same bits come out
    var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
    var modelMatrix = mat3x3<f32>(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    var position = (localUniforms.uTransformMatrix * vec3<f32>(aPosition, 1.0)).xy;
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
    varyings.light = vec4<f32>(aColor.rgb * aColor.a * tint.rgb, aColor.a * tint.a * (1.0 - aFlags.y));
    ${dark ? 'varyings.dark = vec4<f32>(aDark.rgb * tint.a, aDark.a);' : ''}
    ${pages > 1 ? 'varyings.page = u32(aFlags.x * 255.0 + 0.5);' : ''}

    return varyings;
}

@fragment
fn mainFragment(varyings: Varyings) -> @location(0) vec4<f32> {
    ${wgslSample(pages)}

    return ${color};
}
`;
}

/**
 * Creates the shader that draws one range of a skeleton: a WebGL2 program and a WebGPU program
 * with the same output. `sources` are the pages the range samples, 1 to {@link MAX_PAGES}. Vertex
 * attribute `aFlags.x` selects one of them. `dark` adds the dark color attribute and the two color
 * tint of the official runtime.
 *
 * Programs are shared: two shaders with the same page count and tint mode use the same programs.
 * The output is premultiplied. The textures must hold premultiplied colors on the GPU.
 *
 * @example
 * const shader = createViewShader([texture.source], model.slots.hasDark.includes(1));
 * const mesh = new Mesh({ geometry, shader });
 */
export function createViewShader(sources: readonly TextureSource[], dark: boolean): Shader {
    const pages = sources.length;
    const name = `marrow-${dark ? 'dark' : 'light'}-${pages}`;
    const source = wgsl(dark, pages);
    const resources: Record<string, TextureSource | TextureStyle> = {};

    sources.forEach((page, i) => {
        resources[`uTexture${i}`] = page;
        resources[`uSampler${i}`] = page.style;
    });

    return new Shader({
        glProgram: GlProgram.from({ name, vertex: glVertex(dark, pages), fragment: glFragment(dark, pages) }),
        gpuProgram: GpuProgram.from({
            name,
            vertex: { source, entryPoint: 'mainVertex' },
            fragment: { source, entryPoint: 'mainFragment' },
        }),
        resources,
    });
}

const GL_MASK_VERTEX = `#version 300 es
in vec2 aPosition;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec2 uResolution;
uniform mat3 uTransformMatrix;
uniform float uRound;
${GL_ROUND}

void main(void) {
    // the statements of the view shader, so that the edge of a mask lands where a slot edge would
    mat3 worldTransformMatrix = uWorldTransformMatrix;
    mat3 modelMatrix = mat3(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    vec2 position = (uTransformMatrix * vec3(aPosition, 1.0)).xy;
    mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;

    gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    if (uRound == 1.0) {
        gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
    }
}
`;

const GL_MASK_FRAGMENT = `#version 300 es
out vec4 finalColor;

void main(void) {
    // no color is written: Pixi turns color writes off while a mask draws
    finalColor = vec4(0.0);
}
`;

const WGSL_MASK = `${WGSL_UNIFORMS}

${WGSL_ROUND}

@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
) -> @builtin(position) vec4<f32> {
    // the statements of the view shader, so that the edge of a mask lands where a slot edge would
    var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
    var modelMatrix = mat3x3<f32>(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    var position = (localUniforms.uTransformMatrix * vec3<f32>(aPosition, 1.0)).xy;
    var modelViewProjectionMatrix = globalUniforms.uProjectionMatrix * worldTransformMatrix * modelMatrix;
    var clip = (modelViewProjectionMatrix * vec3<f32>(position, 1.0)).xy;

    if (localUniforms.uRound == 1.0) {
        clip = roundPixels(clip, globalUniforms.uResolution);
    }

    return vec4<f32>(clip, 0.0, 1.0);
}

@fragment
fn mainFragment() -> @location(0) vec4<f32> {
    // no color is written: Pixi turns color writes off while a mask draws
    return vec4<f32>(0.0);
}
`;

/**
 * Creates the shader of a clip mask: a WebGL2 program and a WebGPU program that place the
 * vertices of a polygon as {@link createViewShader} places the vertices of a slot. The one
 * attribute is `aPosition`. The color it writes is never seen: Pixi draws a mask into the stencil
 * buffer with color writes turned off.
 *
 * Programs are shared between all mask shaders.
 *
 * @example
 * const mask = new Mesh({ geometry: polygon, shader: createMaskShader() });
 * clipped.addChild(mask);
 * clipped.mask = mask;
 */
export function createMaskShader(): Shader {
    const name = 'marrow-mask';

    return new Shader({
        glProgram: GlProgram.from({ name, vertex: GL_MASK_VERTEX, fragment: GL_MASK_FRAGMENT }),
        gpuProgram: GpuProgram.from({
            name,
            vertex: { source: WGSL_MASK, entryPoint: 'mainVertex' },
            fragment: { source: WGSL_MASK, entryPoint: 'mainFragment' },
        }),
        resources: {},
    });
}
