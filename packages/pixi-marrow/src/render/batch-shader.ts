import { GlProgram, GpuProgram, getBatchSamplersUniformGroup, Shader } from 'pixi.js';

/*
 * The shader of the batched mode, as GLSL for WebGL2 and as WGSL for WebGPU. It writes the colors
 * of the mesh mode, see `shader.ts`, and differs from that shader in three points:
 *
 * - A vertex arrives placed. The batch holds positions in the space of the render group, so the
 *   vertex stage runs the statements of Pixi's batch shader and no others. The official runtime
 *   draws through that shader, and the same bits come out.
 * - The tint of the display object is the attribute `aTint`: one batch holds many skeletons, so
 *   it cannot be a uniform. It arrives straight and is multiplied by its alpha, as Pixi fills
 *   `uColor` for a mesh.
 * - The textures are those of the batch, not of one skeleton. Pixi binds them to the units 0 and
 *   up on WebGL2 and as group 1 on WebGPU.
 *
 * Attribute `aFlags` holds three bytes: x is the texture of the page in the batch, y is 255 for
 * an additive slot, z is 255 when positions are rounded to pixels.
 */

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

const GL_ROUND = `
vec2 roundPixels(vec2 position, vec2 targetSize) {
    return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}`;

function glVertex(dark: boolean): string {
    return `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
in vec4 aTint;
in vec4 aFlags;
${dark ? 'in vec4 aDark;' : ''}

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;

out vec2 vUV;
out vec4 vLight;
${dark ? 'out vec4 vDark;' : ''}
flat out float vPage;
${GL_ROUND}

void main(void) {
    // the same steps as the batch shader of Pixi, so that the same bits come out
    mat3 worldTransformMatrix = uWorldTransformMatrix;
    mat3 modelMatrix = mat3(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    vec2 position = aPosition;
    mat3 modelViewProjectionMatrix = uProjectionMatrix * worldTransformMatrix * modelMatrix;
    vec4 tint = vec4(aTint.rgb * aTint.a, aTint.a) * uWorldColorAlpha;

    gl_Position = vec4((modelViewProjectionMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    if (aFlags.z == 1.0) {
        gl_Position.xy = roundPixels(gl_Position.xy, uResolution);
    }
    vUV = aUV;
    vLight = vec4(aColor.rgb * aColor.a, aColor.a) * tint;
    // additive: the color stays, the alpha leaves the blend equation
    vLight.a *= 1.0 - aFlags.y;
    ${dark ? 'vDark = vec4(aDark.rgb * tint.a, aDark.a);' : ''}
    vPage = aFlags.x * 255.0;
}
`;
}

/** One texture lookup per texture of the batch, chosen by the page of the triangle, as Pixi's batcher does it. */
function glSample(textures: number): string {
    if (textures === 1) return 'vec4 texel = texture(uTextures[0], vUV);';
    const lines = range(textures).map((i) => {
        const test = i < textures - 1 ? `if (vPage < ${i}.5) ` : '';

        return `${i > 0 ? 'else ' : ''}${test}{ texel = texture(uTextures[${i}], vUV); }`;
    });

    return `vec4 texel;\n    ${lines.join('\n    ')}`;
}

function glFragment(dark: boolean, textures: number): string {
    const color = dark
        ? 'vec4(((texel.a - 1.0) * vDark.a + 1.0 - texel.rgb) * vDark.rgb + texel.rgb * vLight.rgb, texel.a * vLight.a)'
        : 'texel * vLight';

    return `#version 300 es
in vec2 vUV;
in vec4 vLight;
${dark ? 'in vec4 vDark;' : ''}
flat in float vPage;

uniform sampler2D uTextures[${textures}];

out vec4 finalColor;

void main(void) {
    ${glSample(textures)}
    finalColor = ${color};
}
`;
}

/** WGSL forbids implicit derivatives inside a branch, so the derivatives are taken before it. */
function wgslSample(textures: number): string {
    const sample = (i: number): string => `textureSampleGrad(uTexture${i}, uSampler${i}, varyings.uv, dx, dy)`;
    const derivatives = `let dx = dpdx(varyings.uv);
    let dy = dpdy(varyings.uv);`;

    if (textures === 1) return `${derivatives}\n    let texel = ${sample(0)};`;
    const cases = range(textures).map(
        (i) => `${i < textures - 1 ? `case ${i}:` : 'default:'} { texel = ${sample(i)}; }`,
    );

    return `${derivatives}
    var texel: vec4<f32>;
    switch varyings.page {
        ${cases.join('\n        ')}
    }`;
}

function wgsl(dark: boolean, textures: number): string {
    const color = dark
        ? `vec4<f32>(
        ((texel.a - 1.0) * varyings.dark.a + 1.0 - texel.rgb) * varyings.dark.rgb + texel.rgb * varyings.light.rgb,
        texel.a * varyings.light.a,
    )`
        : 'texel * varyings.light';

    return `struct GlobalUniforms {
    uProjectionMatrix: mat3x3<f32>,
    uWorldTransformMatrix: mat3x3<f32>,
    uWorldColorAlpha: vec4<f32>,
    uResolution: vec2<f32>,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
${range(textures)
    .map(
        (i) =>
            `@group(1) @binding(${i * 2}) var uTexture${i}: texture_2d<f32>;\n` +
            `@group(1) @binding(${i * 2 + 1}) var uSampler${i}: sampler;`,
    )
    .join('\n')}

struct Varyings {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) light: vec4<f32>,
    ${dark ? '@location(2) dark: vec4<f32>,' : ''}
    @location(3) @interpolate(flat) page: u32,
}

fn roundPixels(position: vec2<f32>, targetSize: vec2<f32>) -> vec2<f32> {
    return (floor(((position * 0.5 + 0.5) * targetSize) + 0.5) / targetSize) * 2.0 - 1.0;
}

@vertex
fn mainVertex(
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
    @location(2) aColor: vec4<f32>,
    @location(3) aTint: vec4<f32>,
    @location(4) aFlags: vec4<f32>,
    ${dark ? '@location(5) aDark: vec4<f32>,' : ''}
) -> Varyings {
    // the same steps as the batch shader of Pixi, so that the same bits come out
    var worldTransformMatrix = globalUniforms.uWorldTransformMatrix;
    var modelMatrix = mat3x3<f32>(
        1.0, 0.0, 0.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0
    );
    var position = aPosition;
    var modelViewProjectionMatrix = globalUniforms.uProjectionMatrix * worldTransformMatrix * modelMatrix;
    var clip = (modelViewProjectionMatrix * vec3<f32>(position, 1.0)).xy;
    let tint = vec4<f32>(aTint.rgb * aTint.a, aTint.a) * globalUniforms.uWorldColorAlpha;
    var varyings: Varyings;

    if (aFlags.z == 1.0) {
        clip = roundPixels(clip, globalUniforms.uResolution);
    }
    varyings.position = vec4<f32>(clip, 0.0, 1.0);
    varyings.uv = aUV;
    // additive: the color stays, the alpha leaves the blend equation
    varyings.light = vec4<f32>(aColor.rgb * aColor.a * tint.rgb, aColor.a * tint.a * (1.0 - aFlags.y));
    ${dark ? 'varyings.dark = vec4<f32>(aDark.rgb * tint.a, aDark.a);' : ''}
    varyings.page = u32(aFlags.x * 255.0 + 0.5);

    return varyings;
}

@fragment
fn mainFragment(varyings: Varyings) -> @location(0) vec4<f32> {
    ${wgslSample(textures)}

    return ${color};
}
`;
}

/** The shaders that exist, by texture count and tint mode. All batchers of a kind share one. */
const shaders = new Map<string, Shader>();

/**
 * The shader that draws the batches of skeletons: a WebGL2 program and a WebGPU program with the
 * same output. A batch samples up to `textures` textures, and attribute `aFlags.x` selects one of
 * them. `dark` adds the dark color attribute and the two color tint of the official runtime.
 *
 * The output is premultiplied, and so must the textures be on the GPU. Every call with the same
 * arguments returns the same shader, which nobody destroys.
 *
 * @example
 * const shader = createBatchShader(renderer.limits.maxBatchableTextures, false);
 * console.log(shader === createBatchShader(renderer.limits.maxBatchableTextures, false)); // true
 */
export function createBatchShader(textures: number, dark: boolean): Shader {
    const name = `marrow-batch-${dark ? 'dark' : 'light'}-${textures}`;
    let shader = shaders.get(name);

    if (shader === undefined) {
        const source = wgsl(dark, textures);

        shader = new Shader({
            glProgram: GlProgram.from({ name, vertex: glVertex(dark), fragment: glFragment(dark, textures) }),
            gpuProgram: GpuProgram.from({
                name,
                vertex: { source, entryPoint: 'mainVertex' },
                fragment: { source, entryPoint: 'mainFragment' },
            }),
            // WebGL2 reads the texture units of the batch from this group
            resources: { batchSamplers: getBatchSamplersUniformGroup(textures) },
        });
        shaders.set(name, shader);
    }

    return shader;
}
