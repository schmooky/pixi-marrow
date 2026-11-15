import { describe, expect, it } from 'vitest';
import { addBakedClips, bakeAnimation } from '../../src/bake';
import { MarrowError } from '../../src/base/errors';
import { importSkeleton, sniffSkeleton } from '../../src/core';
import { hashOfInts, hashOfText } from '../../src/formats/shared/hash';
import { listFixtures, readFixture } from '../parity/fixtures';

/*
 * What an audit of the readers found: counts without a bound, a hash in two forms, a dark color
 * timeline without a dark color, and JSON that was told from binary data by the name of its file.
 */

type Version = '4.1' | '4.2' | '4.3';
const VERSIONS: readonly Version[] = ['4.1', '4.2', '4.3'];
const EDITOR: Record<Version, string> = { '4.1': '4.1.24', '4.2': '4.2.43', '4.3': '4.3.75-beta' };

/** Writes the primitive values of a binary skeleton. */
class Bytes {
    private readonly out: number[] = [];

    u8(...values: number[]): this {
        this.out.push(...values.map((value) => value & 0xff));

        return this;
    }

    /** Variable-length integers, written unsigned. */
    int(...values: number[]): this {
        for (let value of values) {
            while (value > 0x7f) {
                this.out.push((value & 0x7f) | 0x80);
                value >>>= 7;
            }
            this.out.push(value);
        }

        return this;
    }

    i32(...values: number[]): this {
        for (const value of values)
            this.out.push(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

        return this;
    }

    f(...values: number[]): this {
        const view = new DataView(new ArrayBuffer(4));

        for (const value of values) {
            view.setFloat32(0, value);
            this.out.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        }

        return this;
    }

    str(text: string): this {
        return this.int(text.length + 1).u8(...text.split('').map((char) => char.charCodeAt(0)));
    }

    zeros(count: number): this {
        return this.u8(...new Array<number>(count).fill(0));
    }

    bytes(): Uint8Array {
        return Uint8Array.from(this.out);
    }
}

/** A binary file up to its bones: the header without editor data and an empty string table. */
function head(version: Version): Bytes {
    const w = new Bytes().i32(0x11223344, 0x55667788).str(EDITOR[version]).f(0, 0, 10, 10);

    if (version !== '4.1') w.f(100);

    return w.u8(0).int(0);
}

/** One root bone, in the layout of the version. */
function rootBone(w: Bytes, version: Version): Bytes {
    w.int(1).str('root');

    // 4.3 stores the length after the inherit mode
    return version === '4.3' ? w.f(0, 0, 0, 1, 1, 0, 0).u8(0).f(0).u8(0) : w.f(0, 0, 0, 1, 1, 0, 0, 0).u8(0, 0);
}

/** A binary file with one slot and one animation, which has an rgb2 timeline for that slot. */
function twoColorSkel(version: Version, dark: number): Uint8Array {
    const w = rootBone(head(version), version);

    w.int(1).str('glow').int(0).i32(-1, dark).int(0, 0);
    // no constraints: 4.1 has three lists, 4.2 has four, 4.3 has one
    w.zeros(version === '4.1' ? 3 : version === '4.2' ? 4 : 1);
    // no default skin, no skins, no events, then one animation with its count of timelines
    w.zeros(3).int(1).str('flash').int(1);
    // one slot with one timeline of type 4, rgb2: one key, no curve, then a time and two colors
    w.int(1, 0, 1).u8(4).int(1, 0).f(0).u8(255, 128, 0, 16, 32, 48);

    return w.zeros(16).bytes();
}

function twoColorJson(version: Version, dark: string | undefined): string {
    return JSON.stringify({
        skeleton: { spine: EDITOR[version], hash: 'ESIzRFVmd4g' },
        bones: [{ name: 'root' }],
        slots: [{ name: 'glow', bone: 'root', dark }],
        animations: { flash: { slots: { glow: { rgb2: [{ light: 'ff8000', dark: '102030' }] } } } },
    });
}

async function failure(source: string | Uint8Array): Promise<MarrowError> {
    const error = await importSkeleton(source).then(
        () => undefined,
        (reason: unknown) => reason,
    );

    if (!(error instanceof MarrowError)) throw new Error(`expected a MarrowError, got ${String(error)}`);

    return error;
}

describe('counts in a binary skeleton', () => {
    it.each(VERSIONS)(
        'refuses a %s header that claims 100 million bones, and makes no room for them',
        async (version) => {
            const bytes = head(version).int(100_000_000).zeros(64).bytes();
            const before = process.memoryUsage().arrayBuffers;
            const start = performance.now();
            const error = await failure(bytes);

            expect(error.code).toBe('invalid-data');
            expect(error.message).toContain('claims to hold 100000000 bones');
            expect(performance.now() - start).toBeLessThan(200);
            expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(1 << 20);
        },
    );

    it.each(VERSIONS)(
        'refuses a %s file whose slots, skins or keys claim more than the file holds',
        async (version) => {
            const slots = rootBone(head(version), version).int(90_000_000).zeros(64).bytes();
            const constraints = version === '4.1' ? 3 : version === '4.2' ? 4 : 1;
            const oneSlot = (): Bytes =>
                rootBone(head(version), version).int(1).str('glow').int(0).i32(-1, -1).int(0, 0);
            const base = (): Bytes => oneSlot().zeros(constraints);
            // a default skin with 80 million slots, then 70 million skins, then a timeline with 60 million keys
            const skinSlots = base().int(80_000_000).zeros(64).bytes();
            const skins = base().int(0).int(70_000_000).zeros(64).bytes();
            const keys = base().zeros(3).int(1).str('a').int(1).int(1, 0, 1).u8(1).int(60_000_000).zeros(64).bytes();

            for (const [bytes, count] of [
                [slots, 90_000_000],
                [skinSlots, 80_000_000],
                [skins, 70_000_000],
                [keys, 60_000_000],
            ] as const) {
                const error = await failure(bytes);

                expect(error.code).toBe('invalid-data');
                expect(error.message).toContain(`claims to hold ${count} `);
            }
        },
    );

    it.each(VERSIONS)('refuses more than 32,767 bones or slots in a %s file, binary and JSON', async (version) => {
        const manyBones = head(version).int(40_000).zeros(40_000).bytes();
        const manySlots = rootBone(head(version), version).int(40_000).zeros(40_000).bytes();
        const names = Array.from({ length: 32_768 }, (_, i) => ({ name: `n${i}`, bone: 'n0' }));
        const skeleton = { spine: EDITOR[version] };
        const jsonBones = JSON.stringify({ skeleton, bones: names.map(({ name }) => ({ name })) });
        const jsonSlots = JSON.stringify({ skeleton, bones: [{ name: 'n0' }], slots: names });

        for (const [source, what] of [
            [manyBones, 'bones: 40000'],
            [manySlots, 'slots: 40000'],
            [jsonBones, 'bones: 32768'],
            [jsonSlots, 'slots: 32768'],
        ] as const) {
            const error = await failure(source);

            expect(error.code).toBe('unsupported-feature');
            expect(error.message).toContain(`The number of ${what}. The model holds at most 32767.`);
        }
    });
});

describe('a dark color timeline', () => {
    it.each(VERSIONS)('imports for a %s slot with a dark color, binary and JSON', async (version) => {
        for (const source of [twoColorSkel(version, 0x00102030), twoColorJson(version, '102030')]) {
            const model = await importSkeleton(source);

            expect(model.slots.hasDark[0]).toBe(1);
            expect(model.animations[0]?.timelines.map((timeline) => timeline.kind)).toEqual(['rgb2']);
        }
    });

    it.each(VERSIONS)('fails at the import for a %s slot without a dark color, binary and JSON', async (version) => {
        for (const source of [twoColorSkel(version, -1), twoColorJson(version, undefined)]) {
            const error = await failure(source);

            expect(error.code).toBe('invalid-data');
            expect(error.message).toContain(
                'The animation "flash" animates the dark color of the slot "glow", which has none.',
            );
            expect(error.fix).toContain('Tint black');
        }
    });
});

describe('the hash of a skeleton', () => {
    it('is 16 hex digits in the byte order of the file, from both forms', () => {
        expect(hashOfInts(0x52654f09, 0x104f1dc8)).toBe('52654f09104f1dc8');
        expect(hashOfInts(-1, 5)).toBe('ffffffff00000005');
        expect(hashOfInts(0, 0)).toBeNull();
        expect(hashOfText('UmVPCRBPHcg')).toBe('52654f09104f1dc8');
        expect(hashOfText('UmVPCRBPHcg=')).toBe('52654f09104f1dc8');
        expect(hashOfText('/2dOCTLjcJ4')).toBe('ff674e0932e3709e');
    });

    it('keeps text that is not the base64 of 8 bytes, and takes no text as no hash', () => {
        expect(hashOfText('h')).toBe('h');
        expect(hashOfText('pose-suite!')).toBe('pose-suite!');
        expect(hashOfText('AAAAAAAAAAA')).toBeNull();
        expect(hashOfText(' ')).toBeNull();
        expect(hashOfText(null)).toBeNull();
        expect(hashOfText(undefined)).toBeNull();
    });

    it('is the same for the .json and the .skel of one export, in every fixture', async () => {
        const fixtures = listFixtures();
        let pairs = 0;

        for (const json of fixtures.filter((fixture) => fixture.format === 'json')) {
            const skel = fixtures.find(
                (other) => other.format === 'binary' && other.rig === json.rig && other.version === json.version,
            );

            if (skel === undefined) continue;
            const text = String(readFixture(json).skeleton);
            const bytes = readFixture(skel).skeleton;

            if (typeof bytes === 'string') throw new Error('a binary fixture holds bytes');
            const stored: unknown = JSON.parse(text).skeleton.hash;
            const fromJson = (await importSkeleton(text)).hash;
            const fromSkel = (await importSkeleton(bytes)).hash;

            expect(fromSkel, skel.id).toBe(Buffer.from(bytes.subarray(0, 8)).toString('hex'));
            expect(fromJson, json.id).toMatch(/^[0-9a-f]{16}$/);
            // two of the official examples were exported at two times: their files hold two hashes
            if (Buffer.from(String(stored), 'base64').equals(Buffer.from(bytes.subarray(0, 8)))) {
                expect(fromJson, json.id).toBe(fromSkel);
                pairs++;
            }
        }
        expect(pairs).toBeGreaterThan(40);
    });

    it('lets a clip that was baked from the .json play on the .skel', async () => {
        const files = (id: string) => {
            const fixture = listFixtures().find((candidate) => candidate.id === id);

            if (fixture === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);

            return readFixture(fixture).skeleton;
        };
        const fromJson = await importSkeleton(files('4.2/spineboy-pro.json'));
        const fromSkel = await importSkeleton(files('4.2/spineboy-pro.skel'));
        // JSON rounds times to four digits: a clip moves when its animation lasts the same in both files
        const same = fromJson.animations.find(
            (animation, i) => animation.duration > 0 && animation.duration === fromSkel.animations[i]?.duration,
        );

        if (same === undefined) throw new Error('no animation lasts the same in both exports');
        const clip = await bakeAnimation(fromJson, same.name);

        expect(clip.hash).toBe(fromSkel.hash);
        expect(clip.hash).not.toBeNull();
        expect(() => addBakedClips({ model: fromSkel }, [clip])).not.toThrow();
        expect(() => addBakedClips({ model: fromSkel }, [{ ...clip, hash: '0000000000000001' }])).toThrow(
            /hash|skeleton/,
        );
    });
});

describe('JSON that arrives as bytes', () => {
    const text = twoColorJson('4.2', '102030');
    const bytes = new TextEncoder().encode(text);

    it('is told from binary data by its content', async () => {
        expect(sniffSkeleton(bytes)).toEqual({ format: 'json', version: '4.2', editorVersion: '4.2.43' });
        expect(sniffSkeleton(bytes.buffer).format).toBe('json');
        expect(sniffSkeleton(new TextEncoder().encode(`\uFEFF \n\t${text}`)).format).toBe('json');
        expect((await importSkeleton(bytes)).slots.names).toEqual(['glow']);
        expect((await importSkeleton(bytes.slice().buffer)).animations[0]?.name).toBe('flash');
        expect((await importSkeleton(`\uFEFF${text}`)).slots.names).toEqual(['glow']);
    });

    it('stays binary when the hash of a .skel file starts with the byte of "{"', async () => {
        const skel = twoColorSkel('4.2', 0x00102030);

        skel[0] = 0x7b;
        expect(sniffSkeleton(skel).format).toBe('binary');
        expect((await importSkeleton(skel)).hash).toBe('7b22334455667788');
    });

    it.each(VERSIONS)('keeps the exact editor version of a %s file on the model', async (version) => {
        for (const source of [twoColorSkel(version, 0), twoColorJson(version, '000000')]) {
            const model = await importSkeleton(source);

            expect(model.version).toBe(version);
            expect(model.editorVersion).toBe(EDITOR[version]);
        }
    });

    it('says that an HTML page is not a skeleton, as bytes and as text', async () => {
        const html = '<!doctype html>\n<html><head><title>My game</title></head></html>';

        for (const source of [html, `\n  ${html}`, new TextEncoder().encode(html)]) {
            const error = await failure(source);

            expect(error.code).toBe('invalid-data');
            expect(error.message).toContain('is an HTML or XML page, not a skeleton');
            expect(error.fix).toContain('Check the URL');
        }
    });

    it('still says what is wrong with bytes that are neither', async () => {
        expect((await failure(new Uint8Array(64))).message).toContain('no version string');
        expect((await failure(new TextEncoder().encode('{"bones":[]}'))).message).toContain('"skeleton.spine"');
    });
});
