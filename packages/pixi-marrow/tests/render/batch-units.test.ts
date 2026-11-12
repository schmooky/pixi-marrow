import { Buffer, BufferUsage, Shader } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { holdsLayout, layoutSlots } from '../../src/render/batch-layout';
import { createBatchShader } from '../../src/render/batch-shader';
import { PendingUpload, uploadsStretch } from '../../src/render/batch-upload';
import { CoverTest } from '../../src/render/cover';
import { type CoverSlot, coverRig } from './cover-rig';
import { PENTAGON, setPolygon } from './cuts';
import { loadRig, step } from './rig';

/** A buffer that notes what it is told to upload, as byte offset and byte count. */
function noting(items: number): { buffer: Buffer; uploads: [number, number][] } {
    const buffer = new Buffer({ data: new Float32Array(items), usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const uploads: [number, number][] = [];

    buffer.update = (size?: number, offset?: number): void => {
        uploads.push([offset ?? 0, size ?? buffer.data.byteLength]);
    };

    return { buffer, uploads };
}

describe('the room of a skeleton in a batch', () => {
    it('is the largest attachment of every slot', async () => {
        const rig = await loadRig('4.2/speedy-ess.skel');

        step(rig, 0);
        const { template } = rig.view.parts;
        const layout = layoutSlots(template, rig.model.slots.count);
        let vertices = 0;

        for (let slot = 0; slot < rig.model.slots.count; slot++) {
            const entries = Array.from(template.slots.keys()).filter((entry) => template.slots[entry] === slot);
            const room = Math.max(0, ...entries.map((entry) => template.counts[entry] ?? 0));

            expect(layout.at[slot]).toBe(vertices);
            vertices += room;
        }
        expect(layout.at[rig.model.slots.count]).toBe(vertices);
        // far fewer vertices than the layout of the mesh mode, which keeps every attachment
        expect(layout).toMatchObject({ vertices: 44, indices: 66, plain: 44 });
        expect(template.vertexCount).toBe(108);
    });

    it('keeps room for the quad of a region that is laid out with fewer vertices, or with none', async () => {
        const slots: CoverSlot[] = [
            { name: 'shape', shows: 'mid' },
            { name: 'empty', shows: 'big' },
            { name: 'mesh', shows: 'small', as: 'mesh' },
        ];
        const fill = (triangle: boolean) => (outlines: Parameters<typeof setPolygon>[0]) => {
            setPolygon(outlines, 'mid', triangle ? [0, 0, 1, 0, 0.5, 1] : PENTAGON);
            setPolygon(outlines, 'big', []);
        };
        const quads = await coverRig(slots, { tightMesh: 'off' });
        const triangle = await coverRig(slots, { tightMesh: 'on' }, fill(true));
        const pentagon = await coverRig(slots, { tightMesh: 'on' }, fill(false));
        const layouts = [quads, triangle, pentagon].map((rig) => layoutSlots(rig.view.parts.template, 3));

        expect(layouts[0]).toMatchObject({ vertices: 12, indices: 18, plain: 12 });
        // a triangle and a region without a pixel: the batch keeps the two quads
        expect(triangle.view.parts.template.vertexCount).toBe(3 + 0 + 4);
        expect(layouts[1]).toMatchObject({ vertices: 12, indices: 18, plain: 12 });
        expect(Array.from(layouts[1]?.at ?? [])).toEqual([0, 4, 8, 12]);
        // a pentagon needs more than its quad, and the count for the rule of auto does not move
        expect(layouts[2]).toMatchObject({ vertices: 13, indices: 21, plain: 12 });
        const [plain, small, large] = layouts;

        if (plain === undefined || small === undefined || large === undefined) throw new Error('no layout');
        expect(holdsLayout(plain, small)).toBe(true);
        expect(holdsLayout(plain, large)).toBe(false);
        expect(holdsLayout(large, plain)).toBe(true);
        // more indices alone, and another slot count
        expect(holdsLayout({ ...large, indices: 20 }, large)).toBe(false);
        expect(holdsLayout(plain, layoutSlots(quads.view.parts.template, 2))).toBe(false);
    });
});

describe('the test of covered slots', () => {
    it('holds one flag per slot until it first runs', async () => {
        const fresh = new CoverTest(7);
        const plain = await loadRig('4.2/speedy-ess.skel');
        const covering = await coverRig([
            { name: 'small', shows: 'small' },
            { name: 'big', shows: 'big' },
        ]);

        expect(fresh.bytes).toBe(7);
        expect(fresh.clear()).toBe(false);
        // a skeleton without an opaque rectangle never searches
        for (let frame = 0; frame < 80; frame++) step(plain, 0.01);
        expect(plain.view.parts.cover.bytes).toBe(plain.model.slots.count);
        // one that has them does, and keeps its scratch arrays from then on
        step(covering, 0);
        expect(covering.view.parts.cover.bytes).toBe(2 * (1 + 4 + 1) + (16 + 16 + 16 + 4 + 256 + 128));
    });
});

describe('what a batch buffer uploads', () => {
    it('is the stretches that changed, one by one, while they are few and short', () => {
        const { buffer, uploads } = noting(100_000);
        const pending = new PendingUpload(true);

        expect(pending.flush(buffer, 4, 100_000)).toBe(0);
        pending.add(100, 50);
        pending.add(4000, 10);
        expect(pending.count).toBe(2);
        expect(pending.flush(buffer, 4, 100_000)).toBe(240);
        expect(uploads).toEqual([
            [400, 200],
            [16_000, 40],
        ]);
        // nothing is left for the next draw
        expect(pending.flush(buffer, 4, 100_000)).toBe(0);
        expect(uploads).toHaveLength(2);
        // a stretch without an item is no upload: Pixi takes a size of 0 for the whole buffer
        pending.add(500, 0);
        expect(pending.count).toBe(0);
        expect(pending.flush(buffer, 4, 100_000)).toBe(0);
        expect(uploads).toHaveLength(2);
    });

    it('is the used part of the buffer once the stretches are many, long, or one was not kept', () => {
        const { buffer, uploads } = noting(100_000);
        const pending = new PendingUpload(true);

        // long: the calls cost more than the whole
        pending.add(0, 44_000);
        pending.add(46_000, 44_000);
        expect(pending.flush(buffer, 4, 90_000)).toBe(360_000);
        // many: one more than is kept
        for (let i = 0; i < 33; i++) pending.add(i * 10, 1);
        expect(pending.whole).toBe(true);
        pending.add(5, 1);
        expect(pending.flush(buffer, 4, 90_000)).toBe(360_000);
        // a small buffer: one call for all of it is the least work
        pending.add(3, 2);
        expect(pending.flush(buffer, 2, 100)).toBe(200);
        // after a build the whole buffer is new
        pending.whole = true;
        expect(pending.flush(buffer, 4, 10)).toBe(40);
        expect(uploads).toEqual([
            [0, 360_000],
            [0, 360_000],
            [0, 200],
            [0, 40],
        ]);
        pending.add(1, 1);
        pending.clear();
        expect(pending.flush(buffer, 4, 10)).toBe(0);
    });

    it('is always the used part with a Pixi that cannot upload from an offset', () => {
        const { buffer, uploads } = noting(100_000);
        const pending = new PendingUpload(uploadsStretch((size?: number) => void size));

        expect(uploadsStretch(buffer.update)).toBe(true);
        expect(uploadsStretch(Buffer.prototype.update)).toBe(true);
        pending.add(90_000, 4);
        expect(pending).toMatchObject({ whole: true, count: 0 });
        expect(pending.flush(buffer, 4, 95_000)).toBe(380_000);
        expect(uploads).toEqual([[0, 380_000]]);
    });
});

describe('createBatchShader', () => {
    it.each([
        [false, 1],
        [false, 16],
        [true, 2],
    ])('declares what the batch pipe of Pixi binds, dark %s with %i textures', (dark, textures) => {
        const shader = createBatchShader(textures, dark);
        const { glProgram, gpuProgram } = shader;
        const attributes = ['aPosition', 'aUV', 'aColor', 'aTint', 'aFlags', ...(dark ? ['aDark'] : [])];

        expect(shader).toBeInstanceOf(Shader);
        // WebGPU: the batch pipe binds the global uniforms as group 0 and the textures as group 1
        expect(Object.keys(gpuProgram.layout[0] ?? {})).toEqual(['globalUniforms']);
        expect(Object.keys(gpuProgram.layout[1] ?? {}).length).toBe(textures * 2);
        for (let texture = 0; texture < textures; texture++) {
            expect(gpuProgram.layout[1]?.[`uTexture${texture}`]).toBe(texture * 2);
            expect(gpuProgram.layout[1]?.[`uSampler${texture}`]).toBe(texture * 2 + 1);
        }
        expect(gpuProgram.layout[2]).toBeUndefined();
        // WebGL2: the textures are an array of samplers, which a uniform group of Pixi numbers
        expect(glProgram.fragment).toContain(`uniform sampler2D uTextures[${textures}];`);
        expect(glProgram.fragment).toContain(`uTextures[${textures - 1}]`);
        expect(glProgram.fragment).not.toContain(`uTextures[${textures}],`);
        expect(shader.resources.batchSamplers.uniforms.uTextures).toHaveLength(textures);
        // the attributes of the batch geometry, and no other
        expect(Object.keys(gpuProgram.attributeData).sort()).toEqual([...attributes].sort());
        for (const name of attributes) expect(glProgram.vertex).toMatch(new RegExp(`in vec[24] ${name};`));
        // the uniforms of a batch, and none of a mesh: a vertex arrives placed
        for (const name of ['uProjectionMatrix', 'uWorldTransformMatrix', 'uWorldColorAlpha', 'uResolution']) {
            expect(glProgram.vertex).toContain(name);
            expect(gpuProgram.vertex?.source).toContain(name);
        }
        for (const name of ['uTransformMatrix', 'uColor', 'uRound']) {
            expect(glProgram.vertex).not.toContain(name);
            expect(gpuProgram.vertex?.source).not.toContain(name);
        }
        expect(gpuProgram.fragmentOutputMask).toBe(1);
    });

    it('writes the colors of the mesh mode, with the tint as an attribute', () => {
        const official = '((texel.a - 1.0) * vDark.a + 1.0 - texel.rgb) * vDark.rgb + texel.rgb * vLight.rgb';
        const dark = createBatchShader(4, true);
        const light = createBatchShader(4, false);

        expect(dark.glProgram.fragment).toContain(official);
        expect(dark.gpuProgram.fragment?.source).toContain(
            official.replaceAll('vDark', 'varyings.dark').replaceAll('vLight', 'varyings.light'),
        );
        expect(light.glProgram.fragment).toContain('finalColor = texel * vLight;');
        expect(light.gpuProgram.fragment?.source).toContain('return texel * varyings.light;');
        expect(light.glProgram.fragment).not.toContain('vDark');
        for (const shader of [dark, light]) {
            expect(shader.glProgram.vertex).toContain(
                'vec4 tint = vec4(aTint.rgb * aTint.a, aTint.a) * uWorldColorAlpha;',
            );
            expect(shader.glProgram.vertex).toContain('vLight = vec4(aColor.rgb * aColor.a, aColor.a) * tint;');
            expect(shader.glProgram.vertex).toContain('vLight.a *= 1.0 - aFlags.y;');
            expect(shader.gpuProgram.vertex?.source).toContain(
                'let tint = vec4<f32>(aTint.rgb * aTint.a, aTint.a) * globalUniforms.uWorldColorAlpha;',
            );
        }
        expect(dark.glProgram.vertex).toContain('vDark = vec4(aDark.rgb * tint.a, aDark.a);');
    });

    it('is one shader per texture count and tint mode', () => {
        expect(createBatchShader(8, false)).toBe(createBatchShader(8, false));
        expect(createBatchShader(8, true)).not.toBe(createBatchShader(8, false));
        expect(createBatchShader(7, false)).not.toBe(createBatchShader(8, false));
    });
});
