import { MarrowError } from '../base/errors';
import type { BakedClip } from './clip';

/*
 * Baked clips as bytes, for a file that a build writes and a game loads. The layout: the four
 * bytes `MRWB`, the format number and the length of a JSON head as two 32-bit numbers in little
 * endian, the head, then every array, each at an offset that is a multiple of 8. The head holds
 * the plain fields of each clip and, per array, its offset and its length.
 */

const MAGIC = 'MRWB';
const FORMAT = 1;
const PREAMBLE = 12;

type ClipArray = Float64Array | Float32Array | Int32Array | Int16Array | Uint16Array | Uint8Array;

/** The arrays of a clip, by name, in the order they are written. */
const arraysOf = (clip: BakedClip): [string, ClipArray][] => [
    ['placement', clip.placement],
    ['bones', clip.bones],
    ['world', clip.world],
    ['colorSlots', clip.colorSlots],
    ['colorMasks', clip.colorMasks],
    ['colors', clip.colors],
    ['darkSlots', clip.darkSlots],
    ['darkMasks', clip.darkMasks],
    ['darkColors', clip.darkColors],
    ['attachmentSlots', clip.attachmentSlots],
    ['attachments', clip.attachments],
    ['sequenceSlots', clip.sequenceSlots],
    ['sequences', clip.sequences],
    ['deformSlots', clip.deformSlots],
    ['deformStarts', clip.deformStarts],
    ['deformLengths', clip.deformLengths],
    ['deforms', clip.deforms],
    ['drawOrders', clip.drawOrders],
    ['drawOrderFrames', clip.drawOrderFrames],
];

/** The plain fields of a clip in the head, and where each of its arrays is. */
interface ClipHead {
    animation: string;
    skins: string[];
    fps: number;
    duration: number;
    frames: number;
    hash: string | null;
    boneCount: number;
    slotCount: number;
    attachmentNames: (string | null)[];
    /** Per array: its byte offset after the head, and how many numbers it has. */
    arrays: Record<string, [number, number] | undefined>;
}

const align = (offset: number): number => Math.ceil(offset / 8) * 8;

/**
 * Writes baked clips as bytes, for a file. `decodeBakedClips` reads them back.
 *
 * @example
 * writeFileSync('hero.bake', encodeBakedClips(await bakeAnimations(model)));
 */
export function encodeBakedClips(clips: readonly BakedClip[]): Uint8Array {
    checkByteOrder();
    let offset = 0;
    const heads: ClipHead[] = clips.map((clip) => {
        const arrays: Record<string, [number, number]> = {};

        for (const [name, array] of arraysOf(clip)) {
            arrays[name] = [offset, array.length];
            offset = align(offset + array.byteLength);
        }

        return {
            animation: clip.animation,
            skins: [...clip.skins],
            fps: clip.fps,
            duration: clip.duration,
            frames: clip.frames,
            hash: clip.hash,
            boneCount: clip.boneCount,
            slotCount: clip.slotCount,
            attachmentNames: [...clip.attachmentNames],
            arrays,
        };
    });
    const head = new TextEncoder().encode(JSON.stringify({ clips: heads }));
    const start = align(PREAMBLE + head.length);
    const bytes = new Uint8Array(start + offset);
    const view = new DataView(bytes.buffer);

    for (let i = 0; i < MAGIC.length; i++) bytes[i] = MAGIC.charCodeAt(i);
    view.setUint32(4, FORMAT, true);
    view.setUint32(8, head.length, true);
    bytes.set(head, PREAMBLE);
    clips.forEach((clip, i) => {
        for (const [name, array] of arraysOf(clip)) {
            const at = heads[i]?.arrays[name]?.[0] ?? 0;

            bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), start + at);
        }
    });

    return bytes;
}

/** True on a host that keeps numbers little-endian, as the arrays of the bytes are. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Throws on a big-endian host, whose arrays would read the bytes of every number in the wrong order. */
function checkByteOrder(): void {
    if (LITTLE_ENDIAN) return;
    throw new MarrowError('unsupported-feature', 'Baked clips are little-endian, and this host is big-endian.', {
        fix: 'Bake the clips on this host, with bakeAnimations, in place of reading bytes.',
    });
}

const broken = (why: string): MarrowError =>
    new MarrowError('invalid-data', `The bytes are no baked clips: ${why}.`, {
        fix: 'Pass the bytes that encodeBakedClips wrote, unchanged.',
    });

/** Reads the head of the bytes. Throws for bytes that do not start like baked clips. */
function readHeads(bytes: Uint8Array): { heads: ClipHead[]; start: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length < PREAMBLE || String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) {
        throw broken('they do not start with MRWB');
    }
    if (view.getUint32(4, true) !== FORMAT) throw broken(`format ${view.getUint32(4, true)} is not ${FORMAT}`);
    const length = view.getUint32(8, true);
    let parsed: unknown;

    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(PREAMBLE, PREAMBLE + length)));
    } catch {
        throw broken('the head is not JSON');
    }
    const clips = typeof parsed === 'object' && parsed !== null && 'clips' in parsed ? parsed.clips : undefined;

    if (!Array.isArray(clips)) throw broken('the head lists no clips');

    return { heads: clips, start: align(PREAMBLE + length) };
}

/**
 * Reads the baked clips that `encodeBakedClips` wrote. Throws a `MarrowError` for bytes that
 * are not such clips. Hand the clips to an asset with `addBakedClips`, which checks them
 * against the skeleton.
 *
 * @example
 * const clips = decodeBakedClips(new Uint8Array(await (await fetch('hero.bake')).arrayBuffer()));
 * addBakedClips(asset, clips);
 */
export function decodeBakedClips(bytes: Uint8Array): BakedClip[] {
    checkByteOrder();
    const { heads, start } = readHeads(bytes);

    try {
        return heads.map((head) => clipOf(bytes, start, head));
    } catch (error) {
        if (error instanceof MarrowError) throw error;
        throw broken('a clip in the head lacks a field');
    }
}

/** One clip of the bytes, from its head. */
function clipOf(bytes: Uint8Array, start: number, head: ClipHead): BakedClip {
    // a copy, so that every array starts at a multiple of its size
    const take = (name: string, size: number): ArrayBufferLike => {
        const place = head.arrays[name];
        const [at, length] = place ?? [-1, -1];
        const from = bytes.byteOffset + start + at;

        const whole = Number.isInteger(at) && Number.isInteger(length);

        if (!(whole && at >= 0 && length >= 0 && start + at + length * size <= bytes.length)) {
            throw broken(`the array ${name} is missing or runs past the end`);
        }

        return bytes.buffer.slice(from, from + length * size);
    };

    return {
        animation: String(head.animation),
        skins: head.skins.map(String),
        fps: Number(head.fps),
        duration: Number(head.duration),
        frames: Number(head.frames),
        hash: head.hash === null ? null : String(head.hash),
        boneCount: Number(head.boneCount),
        slotCount: Number(head.slotCount),
        attachmentNames: head.attachmentNames.map((name) => (name === null ? null : String(name))),
        placement: new Float64Array(take('placement', 8)),
        bones: new Int16Array(take('bones', 2)),
        world: new Float32Array(take('world', 4)),
        colorSlots: new Int16Array(take('colorSlots', 2)),
        colorMasks: new Uint8Array(take('colorMasks', 1)),
        colors: new Float32Array(take('colors', 4)),
        darkSlots: new Int16Array(take('darkSlots', 2)),
        darkMasks: new Uint8Array(take('darkMasks', 1)),
        darkColors: new Float32Array(take('darkColors', 4)),
        attachmentSlots: new Int16Array(take('attachmentSlots', 2)),
        attachments: new Int16Array(take('attachments', 2)),
        sequenceSlots: new Int16Array(take('sequenceSlots', 2)),
        sequences: new Int32Array(take('sequences', 4)),
        deformSlots: new Int16Array(take('deformSlots', 2)),
        deformStarts: new Int32Array(take('deformStarts', 4)),
        deformLengths: new Int32Array(take('deformLengths', 4)),
        deforms: new Float32Array(take('deforms', 4)),
        drawOrders: new Int16Array(take('drawOrders', 2)),
        drawOrderFrames: new Uint16Array(take('drawOrderFrames', 2)),
    };
}
