import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { importBinary43 } from '../../src/formats/binary43/index';
import { importSkeleton } from '../../src/formats/import';
import { differences } from '../parity/compare';
import { listFixtures, readFixture } from '../parity/fixtures';
import { officialModel } from '../parity/model-official';

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

/** Writes the primitives of a binary skeleton with the encoding the official reader expects. */
class Bytes {
    private readonly out: number[] = [];

    byte(...values: number[]): this {
        for (const value of values) this.out.push(value & 0xff);

        return this;
    }

    /** Variable-length integers. A negative number takes five bytes. */
    int(...values: number[]): this {
        for (const value of values) {
            let rest = value >>> 0;

            for (; rest > 0x7f; rest >>>= 7) this.out.push((rest & 0x7f) | 0x80);
            this.out.push(rest);
        }

        return this;
    }

    /** A variable-length integer with the sign in the lowest bit. */
    signed(value: number): this {
        return this.int((value << 1) ^ (value >> 31));
    }

    int32(value: number): this {
        return this.byte(value >>> 24, value >>> 16, value >>> 8, value);
    }

    float(...values: number[]): this {
        const view = new DataView(new ArrayBuffer(4));

        for (const value of values) {
            view.setFloat32(0, value);
            this.int32(view.getInt32(0));
        }

        return this;
    }

    string(text: string | null): this {
        if (text === null) return this.int(0);

        return this.int(text.length + 1).byte(...Array.from(text, (char) => char.charCodeAt(0)));
    }

    /** `count` zero bytes: empty lists, or a run of zero integers. */
    zeros(count: number): this {
        return this.byte(...range(count).fill(0));
    }

    /** The floats 0, 1, 2 and so on. */
    ramp(count: number): this {
        return this.float(...range(count));
    }

    bytes(): Uint8Array {
        return Uint8Array.from(this.out);
    }
}

type Write = (w: Bytes) => void;

/** The string table of the test skeleton. The file points at an entry with its position plus 1. */
const NAMES = ['img', 'point', 'box', 'clip', 'path', 'mesh', 'seq', 'linked', 'wmesh'];
const ref = (name: string): number => NAMES.indexOf(name) + 1;
const REGIONS = ['img', 'seq1', 'seq2', 'mesh'].flatMap((name) => [name, 'bounds: 0, 0, 8, 8']);
const ATLAS = ['page.png', 'size: 64, 64', ...REGIONS].join('\n');
/** Flag bits joined into one byte. */
const bits = (...flags: number[]): number => flags.reduce((byte, flag) => byte | flag, 0);
const floatValue = (w: Bytes, key: number, i: number): Bytes => w.float(key * 10 + i);
const colorValue = (w: Bytes, key: number, i: number): Bytes => w.byte(key * 60 + i * 20);

/** A curve timeline of four keys with `count` values each. The keys are joined by a Bezier curve, a step and a line. */
function keys(w: Bytes, count: number, value: (w: Bytes, key: number, i: number) => Bytes): void {
    w.int(4).int(count);
    for (const key of range(4)) {
        w.float(key * 0.5);
        for (const i of range(count)) value(w, key, i);
        if (key === 1) range(count).reduce((out, i) => out.float(0.1, 1 + i, 0.4, 1.5 + i), w.byte(2));
        if (key > 1) w.byte(3 - key);
    }
}

/** Timelines for every slot, bone and constraint timeline type of the format. */
function poseTimelines(w: Bytes): void {
    w.int(1).int(0).int(6).byte(0).int(2).float(0).int(ref('img')).float(0.5).int(0);
    [4, 3, 7, 6, 1].forEach((count, i) => keys(w.byte(i + 1), count, colorValue));
    w.int(1).int(1).int(11);
    [1, 2, 1, 1, 2, 1, 1, 2, 1, 1].forEach((count, type) => keys(w.byte(type), count, floatValue));
    w.byte(10).int(2).float(0).byte(1).float(1).byte(4);
    // IK: a stored mix and softness, then a Bezier key with mix 1, then a stepped key with mix 0
    w.int(1).int(0).int(3).int(2).byte(63).float(0, 0.5, 2);
    w.byte(129).float(0.5).float(0.1, 0.2, 0.3, 0.4, 0.1, 0.2, 0.3, 0.4).byte(64).float(1);
    keys(w.int(1).int(1), 6, floatValue);
    w.int(1).int(2).int(3);
    [1, 1, 3].forEach((count, type) => keys(w.byte(type), count, floatValue));
    // physics: constraint 3 is stored as 4, and 0 stands for every physics constraint
    w.int(2).int(4).int(8);
    for (const type of [0, 1, 2, 4, 5, 6, 7]) keys(w.byte(type), 1, floatValue);
    w.byte(8).int(2).float(0, 1).int(0).int(1).byte(8).int(1).float(0.5);
    w.int(1).int(5).int(2);
    for (const type of [0, 1]) keys(w.byte(type), 1, floatValue);
}

/** Deform and sequence timelines, draw order keys and events. */
function otherTimelines(w: Bytes): void {
    w.int(2).int(0).int(2);
    // sequence keys: mode 2 with index 1, then mode 6 with index 0
    w.int(0).int(1).int(ref('seq')).byte(1).int(2).float(0).int32(18).float(0.1).float(0.5).int32(6).float(0.2);
    // positions: the setup vertices, a Bezier curve to a run of two values, a step to all six
    w.int(1).int(1).int(ref('mesh')).byte(0).int(3).int(1).float(0).int(0);
    w.float(0.5).byte(2).float(0.1, 0.2, 0.3, 0.8).int(2).int(1).float(5, 6);
    w.float(1).byte(1).int(6).int(0).float(1, 2, 3, 4, 5, 6);
    // offsets of a weighted mesh, then a linked mesh, which uses the vertices of its parent
    w.int(1).int(1).int(2).int(2);
    w.int(ref('wmesh')).byte(0).int(2).int(0).float(0).int(0).float(1).byte(0).int(2).int(4).float(7, 8);
    w.int(ref('linked')).byte(0).int(1).int(0).float(0.25).int(0);
    // draw order: the setup order, slot 0 two places up, slot 2 two places down
    w.int(3).float(0).int(0).float(1).int(1).int(0).int(2).float(2).int(1).int(2).int(-2);
    w.int(1).int(2).int(0, 2).int(2).float(0).int(1).int(0).int(1).float(1).int(0);
    w.int(3).float(0).int(0).signed(5).float(2).string(null);
    w.float(0.5).int(1).signed(-1).float(0.25).string('x').float(0.75, 0.5);
    w.float(1).int(1).signed(0).float(0).string(null).float(1, 0);
}

/**
 * The parts of a skeleton that holds what the official example exports lack, in file order.
 *
 * @param editor true to add the editor data a file can hold
 */
function parts(editor: boolean): Record<string, Write> {
    const extra = (w: Bytes, write: Write): void => {
        if (editor) write(w);
    };
    const bone = (w: Bytes, name: string, parent: number, inherit: number): void => {
        w.string(name);
        if (parent >= 0) w.int(parent);
        w.float(30, 1, 2, 1.5, 0.5, 10, -10)
            .byte(inherit)
            .float(50)
            .byte(Number(parent > 0));
        extra(w, () => w.int32(0x11223344).string('icon').float(1, 0).byte(1));
    };
    const slot = (w: Bytes, name: string, boneIndex: number, dark: number, attachment: number, blend: number): void => {
        w.string(name).int(boneIndex).int32(0xff8040c0).int32(dark).int(attachment).int(blend);
        extra(w, () => w.byte(0));
    };
    const weights = (w: Bytes): void => {
        w.int(3).int(6);
        for (const i of range(3)) w.int(1, i).float(i, i + 1, 1);
    };

    return {
        strings: (w) => NAMES.reduce((out, name) => out.string(name), w.int(NAMES.length)),
        bones: (w) => ['root', 'arm', 'hand'].forEach((name, i) => bone(i === 0 ? w.int(3) : w, name, i - 1, i * 2)),
        slots(w) {
            slot(w.int(3), 'front', 0, -1, ref('img'), 0);
            slot(w, 'mid', 1, 0x00102030, 0, 1);
            slot(w, 'back', 2, -1, 0, 3);
        },
        constraints(w) {
            w.int(7).string('ik').byte(0).int(1, 1).int(2).byte(255).byte(2).float(0.5, 4);
            // two source properties, the first with two targets
            w.string('transform').byte(2).int(1, 1).int(2).byte(0x5a);
            w.byte(0).float(10).byte(2).byte(1).float(1, 2, 3).byte(5).float(4, 5, 6);
            w.byte(3).float(0.5).byte(1).byte(0).float(7, 8, 9);
            w.byte(0b100101).float(11, 12, 13).byte(0b010010).float(0.25, 0.75);
            // percent position, proportional spacing, chain scale rotation and an offset rotation
            w.string('path')
                .byte(1)
                .int(2, 1, 2)
                .int(2)
                .byte(bits(2, 12, 32, 128))
                .float(15, 0.5, 0.25, 1, 0.5, 0.75);
            // a scale X below -2 stands for the volume mode, one below 0 for the uniform mode
            w.string('physics')
                .byte(3)
                .int(1)
                .byte(bits(2, 8, 16, 64, 128))
                .float(1, 0.5, -2.5, 300)
                .byte(60);
            w.float(0.5, 100, 0.85, 4, 1, -1)
                .byte(bits(1, 16, 128))
                .float(0.8);
            w.string('physics2')
                .byte(3)
                .int(2)
                .byte(bits(1, 4, 16, 32))
                .float(2, -0.25, 3)
                .byte(30)
                .zeros(21);
            // a slider that a bone drives, then one that runs on its own time
            w.string('slider')
                .byte(4)
                .byte(bits(2, 8, 16, 32, 64, 128))
                .float(1.5, 0.5)
                .int(1)
                .float(3)
                .byte(2)
                .float(4, 5);
            w.string('slider2')
                .byte(4)
                .byte(bits(1, 4, 8, 16))
                .float(2);
        },
        defaultSkin(w) {
            w.int(2).int(0).int(3);
            w.int(ref('img')).byte(bits(32, 128)).int32(0x80ff00ff).float(45, 1, 2, 1, 1, 8, 8);
            w.int(ref('seq')).byte(64).int(2, 1, 1, 1).float(0, 0, 1, 1, 8, 8);
            w.int(ref('point')).byte(5).float(90, 3, 4);
            extra(w, () => w.int32(-1));
            w.int(1).int(4).int(ref('box')).byte(bits(1, 16));
            weights(w);
            extra(w, () => w.int32(-1));
            w.int(ref('clip'))
                .byte(bits(6, 32, 64))
                .int(2)
                .int(3)
                .float(0, 0, 1, 0, 0, 1);
            extra(w, () => w.int32(-1));
            w.int(ref('path'))
                .byte(bits(4, 16, 32))
                .int(6)
                .ramp(12)
                .float(1.5, 3);
            extra(w, () => w.int32(-1));
            // a mesh whose timelines also apply to slots 0 and 2
            w.int(ref('mesh')).byte(2).int(3).int(3).float(0, 0, 4, 0, 0, 4).float(0, 0, 1, 0, 0, 1);
            w.int(0, 1, 2).int(2, 0, 2);
            extra(w, () => w.int(2).int(0, 1).float(16, 32));
        },
        skins(w) {
            w.int(1).string('skin1');
            extra(w, () => w.int32(-1));
            w.int(1, 2).int(2, 0, 3).int(1).int(2).int(2);
            // a linked mesh with its own path, then a weighted mesh stored under another name
            w.int(ref('linked'))
                .byte(bits(3, 16, 128))
                .int(ref('img'))
                .int(1, 0, ref('mesh'));
            extra(w, () => w.float(1, 2));
            w.int(ref('wmesh'))
                .byte(bits(2, 8, 128))
                .int(ref('img'))
                .int(3);
            weights(w);
            w.float(0, 0, 1, 0, 0, 1).int(0, 1, 2).int(0);
            extra(w, () => w.int(0).float(4, 4));
        },
        events(w) {
            w.int(2).string('plain').signed(-3).float(1.5).string('hello').string(null);
            w.string('sound').signed(7).float(0).string(null).string('snd.wav').float(0.5, -0.25);
        },
        animations(w) {
            w.int(2).string('all').int(0);
            poseTimelines(w);
            otherTimelines(w);
            extra(w, () => w.int32(-1));
            // one rotate key for bone 0, and nothing else
            w.string('short').int(1, 0, 1, 0, 1).byte(0).int(1, 0).float(2, 90).zeros(9);
            extra(w, () => w.int32(-1));
        },
        sliders: (w) => w.int(0).int(1),
    };
}

/** The bytes of the test skeleton. A part in `faults` replaces the part of the same name. */
function skeleton(editor: boolean, faults: Record<string, Write> = {}): Uint8Array {
    const w = new Bytes().int32(0x12345678).int32(0x0abcdef0).string('4.3.01').float(-10, -20, 100, 200, 100);

    w.byte(editor ? 1 : 0);
    if (editor) w.float(30).string('./images/').string(null);
    for (const write of Object.values({ ...parts(editor), ...faults })) write(w);

    return w.bytes();
}

/** An animation that is empty up to timeline section number `section`, which `write` fills. */
const animation =
    (section: number, write: Write): Write =>
    (w) =>
        write(
            w
                .int(1)
                .string('bad')
                .zeros(section + 1),
        );

/** The message of the `invalid-data` error an import throws, or `no error`. */
function messageOf(bytes: Uint8Array): string {
    try {
        importBinary43(bytes);
    } catch (error) {
        if (error instanceof MarrowError && error.code === 'invalid-data') return error.message;
        throw error;
    }

    return 'no error';
}

/** Parts for a skeleton with one empty skin and one empty animation. Both sliders play that animation. */
const NO_ANIMATIONS: Record<string, Write> = {
    skins: (w) => w.int(1).string('only').zeros(3),
    animations: (w) => w.int(1).string('none').zeros(12),
    sliders: (w) => w.zeros(2),
};
const fixtures = listFixtures().filter((fixture) => fixture.version === '4.3' && fixture.format === 'binary');

describe('importBinary43', () => {
    it('reads a view at an offset into a larger buffer like the plain bytes', async () => {
        for (const fixture of fixtures) {
            const { skeleton: plain } = readFixture(fixture);

            if (typeof plain === 'string') throw new Error('A binary fixture holds bytes');
            const padded = new Uint8Array(plain.length + 20).fill(0xab);

            padded.set(plain, 7);
            const view = padded.subarray(7, 7 + plain.length);

            expect(differences(await importSkeleton(view), await importSkeleton(plain))).toEqual([]);
        }
    });

    it('rejects data that is cut short', async () => {
        const [first] = fixtures;

        if (first === undefined) throw new Error('There is no 4.3 binary fixture');
        const { skeleton: plain } = readFixture(first);

        if (typeof plain === 'string') throw new Error('A binary fixture holds bytes');
        for (const length of [64, 1000, plain.length >> 1, plain.length - 1]) {
            const cut = importSkeleton(plain.slice(0, length));

            await expect(cut).rejects.toBeInstanceOf(MarrowError);
            await expect(cut).rejects.toMatchObject({ code: 'invalid-data' });
        }
        expect(() => importBinary43(plain.slice(0, 1000))).toThrow(RangeError);
    });

    it.each([false, true])('reads what the example exports lack like the official reader, editor data %s', (editor) => {
        const bytes = skeleton(editor);
        const model = importBinary43(bytes);

        expect(differences(model, officialModel('4.3', { skeleton: bytes, atlas: ATLAS }))).toEqual([]);
        expect(model.hash).toBe('abcdef012345678');
        expect(model.skins.map((skin) => skin.name)).toEqual(['default', 'skin1']);
        expect(model.constraints[5]).toMatchObject({ animation: 0, bone: 1, property: 'y', time: editor ? 0 : 1.5 });
        expect(model.constraints[5]).toMatchObject({ max: editor ? 1.5 : 0 });
        expect(model.slots.visible[0]).toBe(editor ? 0 : 1);
        expect(model.animations[0]?.timelines).toHaveLength(40);
        // every timeline kind and every attachment type of the format
        expect(new Set(model.animations[0]?.timelines.map((timeline) => timeline.kind)).size).toBe(37);
        const types = model.skins.flatMap((skin) => skin.attachments.map((entry) => entry.attachment.type));

        expect(new Set(types).size).toBe(6);
    });

    it('keeps setup values as the 64-bit numbers the official reader holds', () => {
        const model = importBinary43(skeleton(false));
        const entries = model.skins[0]?.attachments ?? [];
        const [image, path] = ['img', 'path'].map((name) => entries.find((entry) => entry.name === name)?.attachment);

        expect(model.bones.setup.slice(0, 7)).toEqual(Float64Array.of(1, 2, 30, 1.5, 0.5, 10, -10));
        expect(model.bones.lengths).toEqual(Float64Array.of(50, 50, 50));
        // a color byte divided by 255 has more digits than a 32-bit float holds
        expect(model.slots.colors.slice(0, 4)).toEqual(Float64Array.of(1, 128 / 255, 64 / 255, 192 / 255));
        expect(model.slots.darkColors.slice(3, 6)).toEqual(Float64Array.of(16 / 255, 32 / 255, 48 / 255));
        expect(image).toMatchObject({ type: 'region', color: Float64Array.of(128 / 255, 1, 0, 1) });
        expect(path).toMatchObject({ type: 'path', lengths: Float64Array.of(1.5, 3) });
        expect(model.constraints[1]).toMatchObject({ offsets: Float64Array.of(11, 0, 12, 0, 0, 13) });
    });

    it('keeps the timeline slots of a mesh, and leaves the field out when it has none', () => {
        const [first, second] = importBinary43(skeleton(false)).skins;
        const mesh = first?.attachments.find((entry) => entry.name === 'mesh')?.attachment;
        const others = second?.attachments.map((entry) => 'timelineSlots' in entry.attachment);

        expect(mesh).toMatchObject({ type: 'mesh', timelineSlots: Int16Array.of(0, 2) });
        // a linked mesh and a mesh with an empty list
        expect(others).toEqual([false, false]);
    });

    it('leaves the default skin out when it has no attachments', () => {
        const bytes = skeleton(false, { defaultSkin: (w) => w.int(0), ...NO_ANIMATIONS });
        const model = importBinary43(bytes);

        expect(differences(model, officialModel('4.3', { skeleton: bytes, atlas: ATLAS }))).toEqual([]);
        expect(model.skins.map((skin) => skin.name)).toEqual(['only']);
        expect(model.animations).toEqual([{ name: 'none', duration: 0, timelines: [] }]);
    });

    it('reads a clipping attachment without an end slot', () => {
        const defaultSkin: Write = (w) => w.int(1).int(0).int(1).int(ref('clip')).byte(6).int(-1).int(0);
        const bytes = skeleton(false, { defaultSkin, ...NO_ANIMATIONS });
        const model = importBinary43(bytes);

        expect(differences(model, officialModel('4.3', { skeleton: bytes, atlas: ATLAS }))).toEqual([]);
        expect(model.skins[0]?.attachments[0]).toMatchObject({ slot: 0, name: 'clip', attachment: { endSlot: -1 } });
    });
});

/** Starts the attachment of the default skin that slot 0 stores as `img`. `write` adds the damaged rest. */
const attachment =
    (write: Write): Write =>
    (w) =>
        write(w.int(1).int(0).int(1).int(1));
/** Starts a timeline for the attachment a skin stores under `name`. */
const timelineOf = (w: Bytes, slot: number, name: string): Bytes => w.int(1, 0, 1, slot, 1, ref(name));

/**
 * One damaged part per case: a piece of the message the import must throw, the part, and its bytes.
 * A number as the part stands for that timeline section of an animation.
 */
const FAULTS: [message: string, part: string | number, write: Write][] = [
    ['string table entry has no name', 'strings', (w) => w.int(1).string('')],
    ['parent bone 1', 'bones', (w) => w.int(2).string('a').ramp(7).byte(0).float(0).byte(0).string('b').int(1)],
    ['inherit mode 9', 'bones', (w) => w.int(1).string('a').ramp(7).byte(9)],
    ['A bone has no name', 'bones', (w) => w.int(1).string(null)],
    ['bone 9', 'slots', (w) => w.int(1).string('s').int(9)],
    ['refers to string 99', 'slots', (w) => w.int(1).string('s').int(0).int32(-1).int32(-1).int(99)],
    ['blend mode 7', 'slots', (w) => w.int(1).string('s').int(0).int32(-1).int32(-1).int(0).int(7)],
    ['has type 9', 'constraints', (w) => w.int(1).string('c').byte(9)],
    ['scale Y mode 3', 'constraints', (w) => w.int(1).string('c').byte(0).int(0).int(0).byte(2).byte(3)],
    ['bone property 6', 'constraints', (w) => w.int(1).string('c').byte(4).byte(64).int(0).float(0).byte(6)],
    ['rotate mode 3', 'constraints', (w) => w.int(1).string('c').byte(1).int(0).int(0).byte(48).ramp(5)],
    ['has no name', 'defaultSkin', attachment((w) => w.byte(8).int(0))],
    ['has type 7', 'defaultSkin', attachment((w) => w.byte(7))],
    ['has no path', 'defaultSkin', attachment((w) => w.byte(19).int(0))],
    ['ends at slot 9', 'defaultSkin', attachment((w) => w.byte(6).int(9).int(0))],
    ['slot 9', 'defaultSkin', attachment((w) => w.byte(2).zeros(2).int(1, 9))],
    ['bone 9', 'defaultSkin', attachment((w) => w.byte(17).int(1).int(2).int(1).int(9))],
    ['names no parent', 'defaultSkin', attachment((w) => w.byte(3).int(0).int(0).int(0))],
    ['no parent mesh "point"', 'defaultSkin', attachment((w) => w.byte(3).int(0).int(0).int(ref('point')))],
    ['skin 5', 'defaultSkin', attachment((w) => w.byte(3).int(0).int(5).int(ref('img')))],
    ['skin "default" has no name', 'defaultSkin', (w) => w.int(1).int(0).int(1).int(0)],
    ['constraint 99', 'skins', (w) => w.int(1).string('k').int(0).int(1).int(99)],
    ['An event has no name', 'events', (w) => w.int(1).string(null)],
    ['animation 7', 'sliders', (w) => w.int(7)],
    ['slot 9', 0, (w) => w.int(1).int(9)],
    ['slot timeline type 6', 0, (w) => w.int(1).int(0).int(1).byte(6).int(1)],
    ['has no keys', 0, (w) => w.int(1).int(0).int(1).byte(0).int(0)],
    ['curve type 3', 0, (w) => w.int(1, 0, 1).byte(5).int(2, 0).float(0).byte(0).float(1).byte(0, 3)],
    ['more Bezier curves', 0, (w) => w.int(1, 0, 1).byte(5).int(2, 0).float(0).byte(0).float(1).byte(0, 2)],
    ['bone timeline type 11', 1, (w) => w.int(1).int(0).int(1).byte(11).int(1)],
    ['inherit mode 5', 1, (w) => w.int(1).int(0).int(1).byte(10).int(1).float(0).byte(5)],
    ['constraint 99', 2, (w) => w.int(1).int(99)],
    ['type ik points at constraint 1', 2, (w) => w.int(1).int(1)],
    ['path timeline type 3', 4, (w) => w.int(1).int(2).int(1).byte(3)],
    ['not a physics constraint', 5, (w) => w.int(1).int(1)],
    ['physics timeline type 3', 5, (w) => w.int(1).int(4).int(1).byte(3).int(1)],
    ['slider timeline type 2', 6, (w) => w.int(1).int(5).int(1).byte(2)],
    ['skin 9', 7, (w) => w.int(1).int(9)],
    ['does not name the attachment', 7, (w) => w.int(1, 0, 1, 0, 1, 0)],
    ['attachment "mesh" of slot 0', 7, (w) => timelineOf(w, 0, 'mesh')],
    ['has no vertices', 7, (w) => timelineOf(w, 0, 'img').byte(0, 1)],
    ['attachment timeline type 2', 7, (w) => timelineOf(w, 0, 'img').byte(2, 1)],
    ['has no texture', 7, (w) => timelineOf(w, 1, 'box').byte(1, 1)],
    ['sequence mode 9', 7, (w) => timelineOf(w, 0, 'seq').byte(1, 1).float(0).int32(9)],
    ['moves 9 slots', 8, (w) => w.int(1).float(0).int(9)],
    ['slot 0 out of turn', 8, (w) => w.int(1).float(0).int(2).int(1, 1).int(0)],
    ['to place 1', 8, (w) => w.int(1).float(0).int(2).int(0, 1).int(1, 0)],
    ['to place 9', 8, (w) => w.int(1).float(0).int(1).int(0, 9)],
    ['event 9', 10, (w) => w.int(1).float(0).int(9)],
];

describe('importBinary43 with damaged data', () => {
    it.each(FAULTS)('throws "%s"', (message, part, write) => {
        const faults = typeof part === 'string' ? { [part]: write } : { animations: animation(part, write) };

        expect(messageOf(skeleton(false, faults))).toContain(message);
    });

    it('rejects a file without a version string', () => {
        expect(messageOf(new Bytes().int32(1).int32(2).string(null).bytes())).toContain('no version string');
    });
});
