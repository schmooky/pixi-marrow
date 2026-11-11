import {
    BoundingBoxAttachment,
    Color,
    DeformTimeline,
    BinaryInput as OfficialInput,
    RotateTimeline,
    TranslateTimeline,
} from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import { MarrowError } from '../../src/base/errors';
import { BinaryInput } from '../../src/formats/shared/binary-input';
import { writeHexColor, writeRgb888, writeRgba8888 } from '../../src/formats/shared/color';
import { TimelineWriter } from '../../src/formats/shared/timeline-writer';

/** The official classes keep `curves` protected. These let the tests read it. */
class OfficialRotate extends RotateTimeline {
    get curveData(): ArrayLike<number> {
        return this.curves;
    }
}

class OfficialTranslate extends TranslateTimeline {
    get curveData(): ArrayLike<number> {
        return this.curves;
    }
}

class OfficialDeform extends DeformTimeline {
    get curveData(): ArrayLike<number> {
        return this.curves;
    }
}

/** A deterministic stream of bytes. */
function bytes(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length);
    let state = seed;

    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        out[i] = state >>> 24;
    }

    return out;
}

describe('BinaryInput', () => {
    it('reads every primitive like the official reader', () => {
        const data = bytes(4096, 7);
        const ours = new BinaryInput(data);
        const official = new OfficialInput(data);

        for (let i = 0; i < 150; i++) {
            expect(ours.readByte()).toBe(official.readByte());
            expect(ours.readUnsignedByte()).toBe(official.readUnsignedByte());
            expect(ours.readShort()).toBe(official.readShort());
            expect(ours.readInt32()).toBe(official.readInt32());
            expect(ours.readInt(true)).toBe(official.readInt(true));
            expect(ours.readInt(false)).toBe(official.readInt(false));
            expect(ours.readFloat()).toBe(official.readFloat());
            expect(ours.readBoolean()).toBe(official.readBoolean());
        }
    });

    it('reads strings like the official reader', () => {
        const text = new TextEncoder().encode('bone é中 end');
        const data = Uint8Array.from([0, 1, text.length + 1, ...text, 3, 0x61, 0x62]);
        const ours = new BinaryInput(data);
        const official = new OfficialInput(data);

        for (let i = 0; i < 4; i++) expect(ours.readString()).toBe(official.readString());
    });

    it('reads string table entries by index', () => {
        const input = new BinaryInput(Uint8Array.from([0, 1, 2, 9]));

        input.strings.push('first', 'second');
        expect(input.readStringRef()).toBeNull();
        expect(input.readStringRef()).toBe('first');
        expect(input.readStringRef()).toBe('second');
        // index 9 of a table of two: damaged data, not "no string"
        expect(() => input.readStringRef()).toThrow(MarrowError);
    });

    it('starts at the offset of a view into a larger buffer', () => {
        const pool = Uint8Array.from([9, 9, 9, 9, 0x3f, 0x80, 0, 0, 9]);

        expect(new BinaryInput(pool.subarray(4, 8)).readFloat()).toBe(1);
    });

    it('throws a RangeError past the end of the data', () => {
        expect(() => new BinaryInput(new Uint8Array(2)).readInt32()).toThrow(RangeError);
    });
});

describe('TimelineWriter', () => {
    it('builds the arrays of a one-value timeline like the official class', () => {
        const official = new OfficialRotate(3, 2, 0);
        const ours = new TimelineWriter(3, 2, 2);
        const keys = [
            [0, 10],
            [0.5, -20],
            [1.25, 35.5],
        ] as const;

        keys.forEach(([time, value], frame) => {
            official.setFrame(frame, time, value);
            ours.frames.set([time, value], frame * 2);
        });
        official.setBezier(0, 0, 0, 0, 10, 0.1, 12, 0.4, -25, 0.5, -20);
        ours.setBezier(0, 0, 0, 0, 10, 0.1, 12, 0.4, -25, 0.5, -20);
        official.setStepped(1);
        ours.setStepped(1);
        official.shrink(1);
        ours.shrink(1);

        expect(ours.frames).toEqual(official.frames);
        expect(ours.curves).toEqual(official.curveData);
    });

    it('builds the arrays of a two-value timeline like the official class', () => {
        const official = new OfficialTranslate(2, 2, 0);
        const ours = new TimelineWriter(2, 3, 2);

        official.setFrame(0, 0, 1, 2);
        official.setFrame(1, 1, 30, -40);
        ours.frames.set([0, 1, 2, 1, 30, -40]);
        for (const [value, from, to] of [
            [0, 1, 30],
            [1, 2, -40],
        ] as const) {
            official.setBezier(value, 0, value, 0, from, 0.3, from + 5, 0.6, to - 5, 1, to);
            ours.setBezier(value, 0, value, 0, from, 0.3, from + 5, 0.6, to - 5, 1, to);
        }
        official.setLinear(1);
        ours.setLinear(1);

        expect(ours.frames).toEqual(official.frames);
        expect(ours.curves).toEqual(official.curveData);
    });

    it('packs deform curves like the official deform timeline, which differs from the generic one', () => {
        const count = 200;
        const official = new OfficialDeform(count + 1, count, 0, new BoundingBoxAttachment('box'));
        const ours = new TimelineWriter(count + 1, 1, count);
        const generic = new TimelineWriter(count + 1, 1, count);
        // control points from a deterministic stream, one curve per key
        const random = bytes(count * 4, 3);
        const unit = (index: number): number => (random[index] ?? 0) / 255;

        for (let frame = 0; frame <= count; frame++) {
            official.setFrame(frame, frame, [0, 0]);
            ours.frames[frame] = frame;
        }
        for (let bezier = 0; bezier < count; bezier++) {
            const cx1 = bezier + unit(bezier * 4) * 0.5;
            const cy1 = unit(bezier * 4 + 1) * 1.5;
            const cx2 = bezier + 0.5 + unit(bezier * 4 + 2) * 0.5;
            const cy2 = unit(bezier * 4 + 3) * 1.5;

            official.setBezier(bezier, bezier, 0, bezier, 0, cx1, cy1, cx2, cy2, bezier + 1, 1);
            ours.setDeformBezier(bezier, bezier, 0, bezier, cx1, cy1, cx2, cy2, bezier + 1);
            generic.setBezier(bezier, bezier, 0, bezier, 0, cx1, cy1, cx2, cy2, bezier + 1, 1);
        }

        expect(ours.frames).toEqual(official.frames);
        expect(ours.curves).toEqual(official.curveData);
        expect(generic.curves).not.toEqual(official.curveData);
    });

    it('has no curves when the timeline does not interpolate', () => {
        const writer = new TimelineWriter(2, 1, null);

        expect(writer.curves).toBeNull();
        expect(() => writer.setStepped(0)).toThrow('timeline that has none');
    });
});

describe('colors', () => {
    it('reads hex strings like the official Color', () => {
        for (const hex of ['ff8000', 'ff800040', '#0a141e28', '00000000']) {
            const official = new Color().setFromString(hex);
            const ours = new Float64Array(4);

            writeHexColor(hex, ours, 0);
            expect(ours).toEqual(Float64Array.of(official.r, official.g, official.b, official.a));
        }
    });

    it('reads packed integers like the official Color', () => {
        const official = new Color();
        const ours = new Float64Array(4);

        Color.rgba8888ToColor(official, 0xff804020 | 0);
        writeRgba8888(0xff804020 | 0, ours, 0);
        expect(ours).toEqual(Float64Array.of(official.r, official.g, official.b, official.a));

        Color.rgb888ToColor(official, 0x102030);
        writeRgb888(0x102030, ours, 0);
        expect(ours.subarray(0, 3)).toEqual(Float64Array.of(official.r, official.g, official.b));
    });
});
