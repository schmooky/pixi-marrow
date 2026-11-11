import { describe, expect, it } from 'vitest';
import { importSkeleton, MarrowError } from '../../src/core';
import { differences } from '../parity/compare';
import { listFixtures, readFixture } from '../parity/fixtures';
import { officialModel } from '../parity/model-official';

type Version = '4.1' | '4.2';

/** Writes the primitive values of a `.skel` file, the way the official `BinaryInput` reads them. */
class SkelWriter {
    private readonly out: number[] = [];
    private readonly scratch = new DataView(new ArrayBuffer(4));

    u8(...values: number[]): this {
        for (const value of values) this.out.push(value & 0xff);

        return this;
    }

    bool(...values: boolean[]): this {
        return this.u8(...values.map((value) => (value ? 1 : 0)));
    }

    /** Variable-length integers that are not negative. */
    int(...values: number[]): this {
        for (const value of values) {
            let rest = value;

            for (; rest > 0x7f; rest >>>= 7) this.out.push((rest & 0x7f) | 0x80);
            this.out.push(rest);
        }

        return this;
    }

    /** A variable-length integer with the sign in the lowest bit. */
    sint(value: number): this {
        return this.int(((value << 1) ^ (value >> 31)) >>> 0);
    }

    i16(...values: number[]): this {
        for (const value of values) this.u8(value >> 8, value);

        return this;
    }

    i32(value: number): this {
        this.scratch.setInt32(0, value);

        return this.flush();
    }

    f(...values: number[]): this {
        for (const value of values) {
            this.scratch.setFloat32(0, value);
            this.flush();
        }

        return this;
    }

    /** The four floats of the handles of `count` Bezier curves. */
    handles(count: number): this {
        for (let i = 0; i < count; i++) this.f(0.1, 0.6, 0.4, 0.9);

        return this;
    }

    str(text: string | null): this {
        if (text === null) return this.int(0);

        return this.int(text.length + 1).u8(...text.split('').map((char) => char.charCodeAt(0)));
    }

    bytes(): Uint8Array {
        return Uint8Array.from(this.out);
    }

    private flush(): this {
        return this.u8(...new Uint8Array(this.scratch.buffer));
    }
}

/** The string table of the hand-made files. A reference to a string is its position plus one. */
const STRINGS = ['quad', 'mesh', 'link', 'point', 'alt-quad', 'wmesh', 'wlink', 'alt', 'hit', 'step'];
const REF = { quad: 1, mesh: 2, link: 3, point: 4, altQuad: 5, wmesh: 6, wlink: 7, alt: 8, hit: 9, step: 10 };
const ATLAS = `page.png\n\tsize: 32, 32\n\tfilter: Linear, Linear\n${['quad', 'mesh', 'link', 'wmesh', 'wlink']
    .map((name, i) => `${name}\n\tbounds: ${i * 4}, 0, 4, 4\n`)
    .join('')}`;
/** The flag bytes of the 4.2 file. The comments list what each byte switches on. */
const FLAGS = {
    ik: 1 | 2 | 4 | 32 | 64 | 128, // skin required, bend positive, compress, a stored mix, softness
    transform: 2 | 8 | 64, // local, offset rotation, offset scaleX
    transformMore: 1 | 2 | 64, // offset shearY, mix rotate, mix shearY
    path: 1 | (3 << 1) | (2 << 3) | 128, // percent position, proportional spacing, chain scale, offset rotation
    physics: 2 | 64 | 128, // x, limit, mass
    physicsMore: 1 | 16 | 128, // inertia global, wind global, mix
    region: 32 | 128, // color, rotation
    weightedMesh: 2 | 128,
    inheritingLink: 3 | 128,
    ikKey0: 1 | 2 | 4 | 8 | 16, // a stored mix, softness, bend positive, compress
    ikKey1: 1 | 128, // a mix of 1, a Bezier curve that leads to the key
    ikKey2: 32 | 64, // stretch, a stepped curve that leads to the key
};

/** The header without editor data, then the string table. */
function head(version: Version, strings: string[], hash = 0): SkelWriter {
    const w = new SkelWriter().i32(hash).i32(hash).str(`${version}.24`).f(-10, -20, 100, 200);

    if (version === '4.2') w.f(120);
    w.bool(false).int(strings.length);
    for (const text of strings) w.str(text);

    return w;
}

/** Two bones and two slots. The versions differ in how they store the inherit mode. */
function bonesAndSlots(w: SkelWriter, version: Version): SkelWriter {
    const mode = (value: number) => (version === '4.2' ? w.u8(value) : w.int(value));

    w.int(2).str('root').f(0, 0, 0, 1, 1, 0, 0, 10);
    mode(0).bool(false).str('arm').int(0).f(45, 1, 2, 1.5, 0.5, 3, 4, 20);
    mode(2).bool(true);
    w.int(2).str('front').int(0).i32(0x11223344).i32(-1).int(REF.quad).int(0);

    return w.str('back').int(1).i32(0xffffff80).i32(0x00112233).int(0).int(3);
}

/** Three vertices with weights: one bone, two bones, one bone. */
const weights = (w: SkelWriter): SkelWriter =>
    w.int(1, 0).f(0, 0, 1).int(2, 0).f(4, 0, 0.5).int(1).f(3, 0, 0.5).int(1, 1).f(0, 4, 1);

/** The slot timelines, which both versions store the same way: attachment, rgb, rgb2 and alpha. */
function slotTimelines(w: SkelWriter): SkelWriter {
    w.int(1, 0, 4);
    w.u8(0).int(2).f(0).int(REF.quad).f(0.5).int(0);
    w.u8(2).int(2, 0).f(0).u8(255, 128, 0).f(1).u8(0, 64, 255).u8(1);
    w.u8(4).int(2, 6).f(0).u8(1, 2, 3, 4, 5, 6).f(1).u8(250, 200, 150, 100, 50, 0).u8(2).handles(6);

    return w.u8(5).int(3, 1).f(0).u8(0).f(0.5).u8(128).u8(0).f(1).u8(255).u8(2).handles(1);
}

/** The transform constraint timeline, then position, spacing and mix of the path constraint. */
function transformAndPathTimelines(w: SkelWriter): SkelWriter {
    w.int(1, 0, 2, 0).f(0, 1, 1, 1, 1, 1, 1).f(1, 0, 0.5, 0.5, 0, 0, 1).u8(0);
    w.int(1, 0, 3);
    w.u8(0).int(1, 0).f(0, 0.25);
    w.u8(1).int(2, 1).f(0, 1).f(1, 2).u8(2).handles(1);

    return w.u8(2).int(2, 0).f(0, 1, 1, 1).f(1, 0, 0, 0).u8(1);
}

/** Deform timelines on both linked meshes, then two draw order keys. */
function deformAndDrawOrder(w: SkelWriter): SkelWriter {
    w.int(2);
    // the linked mesh of the default skin: setup, two values, every value
    w.int(0, 1, 0, 1, REF.link).u8(0).int(3, 1).f(0).int(0).f(0.5).u8(2).handles(1);
    w.int(2, 1).f(0.5, -0.5).f(1).u8(1).int(6, 0).f(1, 2, 3, 4, 5, 6);
    // the weighted linked mesh of the named skin: no offsets, then two offsets
    w.int(1, 1, 0, 1, REF.wlink).u8(0).int(2, 0).f(0).int(0).f(1).u8(0).int(2, 0).f(0.5, 0.25);

    return w.int(2).f(0).int(1, 0, 1).f(1).int(0);
}

/** A 4.2 file with the features the official examples leave out. */
function skeleton42(): Uint8Array {
    const w = bonesAndSlots(head('4.2', STRINGS), '4.2');

    w.int(1).str('ik').int(0, 1, 1, 0).u8(FLAGS.ik).f(0.75, 3);
    w.int(1).str('tc').int(1, 1, 1, 0).u8(FLAGS.transform).f(30, 2).u8(FLAGS.transformMore).f(5, 0.5, 0.25);
    w.int(1).str('pc').int(2).bool(false).int(1, 1, 1).u8(FLAGS.path).f(15, 0.5, 2, 1, 0.5, 0.25);
    w.int(1).str('ph').int(3, 1).u8(FLAGS.physics).f(0.5, 800).u8(60).f(0.9, 100, 0.8, 2, 1, -5);
    w.u8(FLAGS.physicsMore).f(0.6);
    // the default skin: a region, a mesh, a linked mesh and a point in slot 0
    w.int(1, 0, 4);
    w.int(REF.quad).u8(FLAGS.region).i32(0xff000080).f(90, 1, 2, 1, 1, 8, 8);
    w.int(REF.mesh).u8(2).int(3, 3).f(0, 0, 4, 0, 0, 4).f(0, 0, 1, 0, 0, 1).int(0, 1, 2);
    w.int(REF.link).u8(3).int(0, REF.mesh);
    w.int(REF.point).u8(5).f(30, 5, 6);
    // one named skin with a bone and one constraint of each kind
    w.int(1).str('alt').int(1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 2);
    weights(w.int(0, 2, REF.wmesh).u8(FLAGS.weightedMesh).int(3, 3))
        .f(0, 0, 1, 0, 0, 1)
        .int(0, 1, 2);
    w.int(REF.wlink).u8(FLAGS.inheritingLink).int(1, REF.wmesh);
    w.int(1, 1, REF.altQuad).u8(8).int(REF.quad).f(0, 0, 1, 1, 4, 4);
    w.int(2).str('hit').sint(-3).f(1.5).str('bang').str('hit.wav').f(0.5, -1);
    w.str('step').sint(7).f(0).str(null).str(null);
    slotTimelines(w.int(1).str('run').int(0));
    // an inherit timeline, a curve with one value and a timeline with one key
    w.int(1, 1, 3).u8(10).int(2).f(0).u8(1).f(1).u8(4);
    w.u8(5).int(2, 1).f(0, 1).f(1, 2).u8(2).handles(1).u8(7).int(1, 0).f(0, 1, 2);
    // three IK keys, each behind its flag byte
    w.int(1, 0, 3, 2).u8(FLAGS.ikKey0).f(0, 0.5, 2).u8(FLAGS.ikKey1).f(0.5).handles(2).u8(FLAGS.ikKey2).f(1);
    transformAndPathTimelines(w);
    // physics: a reset and gravity for every constraint, then a mix for the first one
    w.int(2, 0, 2).u8(8).int(2).f(0, 1).u8(6).int(1, 0).f(0, 5);
    w.int(1, 1).u8(7).int(2, 0).f(0, 0.5).f(1, 1).u8(1);
    deformAndDrawOrder(w);
    w.int(2).f(0.25).int(0).sint(1).f(2).str('pow').f(0.25, 1);

    return w.f(0.75).int(1).sint(-2).f(0.5).str(null).bytes();
}

/** The 4.1 file with the same content, in the 4.1 layout. */
function skeleton41(): Uint8Array {
    const w = bonesAndSlots(head('4.1', STRINGS, 0x1234), '4.1');

    w.int(1).str('ik').int(0).bool(true).int(1, 1, 0).f(0.75, 3).u8(255).bool(true, false, true);
    w.int(1).str('tc').int(1).bool(false).int(1, 1, 0).bool(true, false);
    w.f(30, 1, 2, 3, 4, 5).f(0.5, 0.25, 0.75, 1, 0, 0.1);
    w.int(1).str('pc').int(2).bool(false).int(1, 1, 1, 1, 3, 2).f(15, 0.5, 2, 1, 0.5, 0.25);
    // the default skin: a region, a mesh, a linked mesh and a point in slot 0
    w.int(1, 0, 4);
    w.int(REF.quad, 0).u8(0).int(0).f(90, 1, 2, 1, 1, 8, 8).i32(0xff000080).bool(false);
    w.int(REF.mesh, 0).u8(2).int(0).i32(-1).int(3).f(0, 0, 1, 0, 0, 1).int(3).i16(0, 1, 2);
    w.bool(false).f(0, 0, 4, 0, 0, 4).int(3).bool(false);
    w.int(REF.link, 0).u8(3).int(0).i32(-1).int(0, REF.mesh).bool(false, false);
    w.int(REF.point, 0).u8(5).f(30, 5, 6);
    // one named skin with a bone and one constraint of each kind
    w.int(1, REF.alt, 1, 1, 1, 0, 1, 0, 1, 0, 2);
    w.int(0, 2, REF.wmesh, 0).u8(2).int(0).i32(-1).int(3).f(0, 0, 1, 0, 0, 1).int(3).i16(0, 1, 2);
    weights(w.bool(true)).int(3).bool(false);
    w.int(REF.wlink, 0).u8(3).int(0).i32(-1).int(REF.alt, REF.wmesh).bool(true, false);
    w.int(1, 1, REF.altQuad, REF.quad).u8(0).int(0).f(0, 0, 0, 1, 1, 4, 4).i32(-1).bool(false);
    w.int(2, REF.hit).sint(-3).f(1.5).str('bang').str('hit.wav').f(0.5, -1);
    w.int(REF.step).sint(7).f(0).str(null).str(null);
    slotTimelines(w.int(1).str('run').int(0));
    w.int(1, 1, 2).u8(5).int(2, 1).f(0, 1).f(1, 2).u8(2).handles(1).u8(7).int(1, 0).f(0, 1, 2);
    // IK keys: the bend direction and two booleans follow the curve that leads to the key
    w.int(1, 0, 3, 2).f(0, 0.5, 2).u8(1).bool(true, false);
    w.f(0.5, 1, 0).u8(2).handles(2).u8(255).bool(false, true);
    w.f(1, 0, 0).u8(1).u8(1).bool(false, false);
    deformAndDrawOrder(transformAndPathTimelines(w));
    w.int(2).f(0.25).int(0).sint(1).f(2).bool(true).str('pow').f(0.25, 1);

    return w.f(0.75).int(1).sint(-2).f(0.5).bool(false).bytes();
}

const SYNTHETIC = { '4.1': skeleton41, '4.2': skeleton42 };

/** The fixture of a rig as a binary file of one version. */
function fixtureBytes(version: Version, rig: string): Uint8Array {
    const fixture = listFixtures().find((f) => f.version === version && f.format === 'binary' && f.rig === rig);

    if (!fixture) throw new Error(`No ${version} binary fixture for ${rig}`);
    const { skeleton } = readFixture(fixture);

    if (typeof skeleton === 'string') throw new Error(`${fixture.id} is not binary`);

    return skeleton;
}

/** The error an import ends with. */
async function failure(bytes: Uint8Array): Promise<unknown> {
    return importSkeleton(bytes).then(
        () => undefined,
        (error: unknown) => error,
    );
}

describe.each(['4.1', '4.2'] as const)('importBinary42 with a %s file', (version) => {
    it('reads a view into a larger buffer like the plain bytes', async () => {
        const bytes = fixtureBytes(version, 'spineboy-pro');
        const padded = new Uint8Array(bytes.length + 64).fill(0xa5);

        padded.set(bytes, 23);
        const view = padded.subarray(23, 23 + bytes.length);

        expect(view.byteOffset).toBe(23);
        expect(differences(await importSkeleton(view), await importSkeleton(bytes))).toEqual([]);
    });

    it('rejects a file that is cut short', async () => {
        const bytes = fixtureBytes(version, 'spineboy-pro');

        for (const length of [40, bytes.length >> 1, bytes.length - 1]) {
            const error = await failure(bytes.slice(0, length));

            expect(error).toBeInstanceOf(MarrowError);
            expect(error).toMatchObject({ code: 'invalid-data' });
        }
    });

    it('reads what the official examples leave out like the official core', async () => {
        const skeleton = SYNTHETIC[version]();
        const model = await importSkeleton(skeleton);

        expect(differences(model, officialModel(version, { skeleton, atlas: ATLAS }))).toEqual([]);
        expect(model.hash).toBe(version === '4.2' ? null : '12341234');
        expect(model.skins.map((skin) => skin.name)).toEqual(['default', 'alt']);
        expect(model.animations[0]?.timelines.map((timeline) => timeline.kind)).toContain('deform');
    });

    it('keeps setup values as the 64-bit numbers the official core holds', async () => {
        const model = await importSkeleton(SYNTHETIC[version]());
        const quad = model.skins[0]?.attachments.find((entry) => entry.name === 'quad')?.attachment;
        const mesh = model.skins[0]?.attachments.find((entry) => entry.name === 'mesh')?.attachment;

        expect(model.bones.setup).toBeInstanceOf(Float64Array);
        expect(model.bones.lengths).toEqual(Float64Array.of(10, 20));
        // a color byte divided by 255 in 64-bit arithmetic, without rounding to 32 bits
        expect(model.slots.colors[0]).toBe(0x11 / 255);
        expect(model.slots.darkColors).toEqual(Float64Array.of(0, 0, 0, 0x11 / 255, 0x22 / 255, 0x33 / 255));
        expect(quad).toMatchObject({ type: 'region', color: Float64Array.of(1, 0, 0, 0x80 / 255) });
        expect(mesh).toMatchObject({ type: 'mesh', color: Float64Array.of(1, 1, 1, 1) });
        expect(model.constraints[1]).toMatchObject({ type: 'transform', offsets: expect.any(Float64Array) });
    });
});

/** The 4.2 flag byte of a mesh that stores a sequence. */
const MESH_WITH_SEQUENCE = 2 | 64;
/** The sections of an animation, in file order. 4.1 files have no physics section. */
const SECTIONS = ['slot', 'bone', 'ik', 'transform', 'path', 'physics', 'attachment', 'drawOrder', 'event'];

/** A file up to the inherit mode of its first bone. It has no strings. */
const bone = (version: Version, count = 1): SkelWriter =>
    head(version, []).int(count).str('a').f(0, 0, 0, 1, 1, 0, 0, 0);

/** A file up to its skins: one bone, two slots and no constraints. Its strings are `a`, `b` and `c`. */
function start(version: Version): SkelWriter {
    const w = head(version, ['a', 'b', 'c']).int(1).str('root').f(0, 0, 0, 1, 1, 0, 0, 0).int(0, 0);

    w.int(2).str('slot').int(0).i32(-1).i32(-1).int(0, 0).str('top').int(0).i32(-1).i32(-1).int(0, 0);

    return version === '4.2' ? w.int(0, 0, 0, 0) : w.int(0, 0, 0);
}

/**
 * A file up to `section` of its one animation. The default skin holds two attachments in slot 0:
 * the region `a`, and the mesh `b` with three vertices and a sequence.
 */
function animation(version: Version, section: string): SkelWriter {
    const w = start(version).int(1, 0, 2, 1);
    const before = SECTIONS.slice(0, SECTIONS.indexOf(section)).filter(
        (name) => version === '4.2' || name !== 'physics',
    );

    if (version === '4.2') {
        w.u8(0).f(0, 0, 1, 1, 1, 1).int(2).u8(MESH_WITH_SEQUENCE).int(1, 0, 0, 0, 3, 3);
        w.f(0, 0, 1, 0, 0, 1).f(0, 0, 1, 0, 0, 1).int(0, 1, 2);
    } else {
        w.int(0).u8(0).int(0).f(0, 0, 0, 1, 1, 1, 1).i32(-1).bool(false);
        w.int(2, 0).u8(2).int(0).i32(-1).int(3).f(0, 0, 1, 0, 0, 1).int(3).i16(0, 1, 2);
        w.bool(false).f(0, 0, 1, 0, 0, 1).int(3).bool(true).int(1, 0, 0, 0);
    }
    w.int(0, 0, 1).str('x').int(0);

    return w.int(...before.map(() => 0));
}

/** Files that stop right after a value that points nowhere, with a part of the expected message. */
const DAMAGED: [label: string, file: () => SkelWriter, message: RegExp][] = [
    ['a list that is longer than the file', () => head('4.2', []).int(100000), /100000 bones/],
    ['an empty string in the string table', () => head('4.2', ['']), /empty string/],
    ['a bone without a name', () => head('4.1', []).int(1).str(null), /a bone without a name/],
    ['a bone whose parent comes after it', () => bone('4.2', 2).int(0, 0).str('b').int(1), /parent bone 1/],
    ['an unknown inherit mode', () => bone('4.1').int(7), /inherit mode 7/],
    ['a slot on a missing bone', () => bone('4.2').int(0, 0, 1).str('s').int(5), /bone 5/],
    ['an unknown blend mode', () => bone('4.1').int(0, 0, 1).str('s').int(0).i32(-1).i32(-1).int(0, 9), /blend mode 9/],
    [
        'a setup attachment name past the string table',
        () => bone('4.2').int(0, 0, 1).str('s').int(0).i32(-1).i32(-1).int(9),
        /string 9/,
    ],
    ['a skin entry name past the string table', () => start('4.1').int(1, 0, 1, 7), /string 7/],
    ['an unknown attachment type', () => start('4.2').int(1, 0, 1, 1).u8(7), /unknown type 7/],
    ['an unknown 4.1 attachment type', () => start('4.1').int(1, 0, 1, 1, 0).u8(9), /unknown type 9/],
    ['a mesh with a hull larger than itself', () => start('4.2').int(1, 0, 1, 1).u8(2).int(9, 1).f(0, 0, 0, 0), /hull/],
    [
        'a path with a broken vertex count',
        () => start('4.2').int(1, 0, 1, 1).u8(4).int(2).f(0, 0, 0, 0),
        /multiple of 3/,
    ],
    ['a clipping area that ends at a missing slot', () => start('4.1').int(1, 0, 1, 1, 0).u8(6).int(3), /slot 3/],
    ['a linked mesh in a missing skin', () => start('4.2').int(1, 0, 1, 1).u8(3).int(4, 2, 0), /skin 4/],
    ['a linked mesh without its parent', () => start('4.2').int(1, 0, 1, 1).u8(3).int(0, 2, 0), /parent b/],
    [
        'a linked mesh in a skin with an unknown name',
        () => start('4.1').int(1, 0, 1, 1, 0).u8(3).int(0).i32(-1).int(2, 2).bool(false, false).int(0),
        /skin b/,
    ],
    [
        'a linked mesh in an empty default skin',
        () => start('4.1').int(0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0).u8(3).int(0).i32(-1).int(0, 2).bool(false, false),
        /default skin/,
    ],
    [
        'an unknown slot timeline',
        () => animation('4.2', 'slot').int(1, 0, 1).u8(9).int(1),
        /slot timeline has the unknown type 9/,
    ],
    ['a curve timeline without keys', () => animation('4.1', 'slot').int(1, 0, 1).u8(1).int(0), /without keys/],
    [
        'an inherit timeline in a 4.1 file',
        () => animation('4.1', 'bone').int(1, 0, 1).u8(10).int(1, 0),
        /bone timeline has the unknown type 10/,
    ],
    ['a timeline for a missing IK constraint', () => animation('4.2', 'ik').int(1, 0), /IK constraint 0/],
    [
        'a timeline for a missing physics constraint',
        () => animation('4.2', 'physics').int(1, 3),
        /physics constraint 2/,
    ],
    [
        'an unknown physics timeline',
        () => animation('4.2', 'physics').int(1, 0, 1).u8(3).int(1),
        /physics constraint timeline has the unknown type 3/,
    ],
    [
        'a deform timeline for a region',
        () => animation('4.2', 'attachment').int(1, 0, 1, 0, 1, 1).u8(0).int(1),
        /no vertices/,
    ],
    ['a timeline for a missing attachment', () => animation('4.1', 'attachment').int(1, 0, 1, 0, 1, 3), /attachment c/],
    [
        'a deform key outside its mesh',
        () => animation('4.2', 'attachment').int(1, 0, 1, 0, 1, 2).u8(0).int(1, 0).f(0).int(9, 0),
        /moves vertices/,
    ],
    [
        'an unknown sequence mode',
        () => animation('4.1', 'attachment').int(1, 0, 1, 0, 1, 2).u8(1).int(1).f(0).i32(9),
        /unknown mode 9/,
    ],
    [
        'a sequence timeline without a sequence',
        () => animation('4.2', 'attachment').int(1, 0, 1, 0, 1, 1).u8(1).int(1),
        /no sequence/,
    ],
    [
        'an unknown attachment timeline',
        () => animation('4.1', 'attachment').int(1, 0, 1, 0, 1, 1).u8(5).int(1),
        /attachment timeline has the unknown type 5/,
    ],
    ['a draw order key with too many slots', () => animation('4.2', 'drawOrder').int(1).f(0).int(3), /more slots/],
    [
        'a draw order key with its slots out of order',
        () => animation('4.2', 'drawOrder').int(1).f(0).int(2, 1, 0, 0),
        /out of order/,
    ],
    [
        'a draw order key with two slots in one place',
        () => animation('4.1', 'drawOrder').int(1).f(0).int(2, 0, 1, 1, 0),
        /same place/,
    ],
    [
        'a draw order key that leaves the draw order',
        () => animation('4.1', 'drawOrder').int(1).f(0).int(1, 0, 5),
        /out of the draw order/,
    ],
    ['a key for a missing event', () => animation('4.2', 'event').int(1).f(0).int(3), /event 3/],
];

describe('importBinary42 with damaged data', () => {
    it.each(DAMAGED)('rejects %s', async (_label, file, message) => {
        const error = await failure(file().bytes());

        expect(error).toBeInstanceOf(MarrowError);
        expect(error).toMatchObject({ code: 'invalid-data', message: expect.stringMatching(message) });
    });
});
