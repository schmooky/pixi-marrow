import { MarrowError } from '../base/errors';
import { SPINE_VERSIONS, type SpineVersion } from '../base/version';

/** What {@link sniffSkeleton} found in a skeleton file. */
export interface SkeletonSniff {
    /** How the skeleton is stored. */
    format: 'json' | 'binary';
    /** The version line the file belongs to. */
    version: SpineVersion;
    /** The full version string from the file, for example `4.2.22`. */
    editorVersion: string;
}

/**
 * A skeleton file: JSON text, parsed JSON, or the bytes of a file. Bytes are a `.skel` file or
 * JSON text. The content decides which, not a file name.
 */
export type SkeletonSource = string | Uint8Array | ArrayBuffer | object;

const EXPORT_FIX = 'Export the skeleton from Spine 4.1, 4.2 or 4.3 as JSON or binary.';
/** A binary skeleton starts with 8 bytes of hash. The version string follows. */
const HASH_BYTES = 8;
const MAX_VERSION_LENGTH = 32;

const invalid = (message: string): MarrowError => new MarrowError('invalid-data', message, { fix: EXPORT_FIX });

function jsonTextVersion(text: string): string {
    const match = /"spine"\s*:\s*"([^"]*)"/.exec(text);

    if (match?.[1] === undefined) throw invalid('The JSON has no "skeleton.spine" version field.');

    return match[1];
}

function jsonObjectVersion(source: object): string {
    if ('skeleton' in source && typeof source.skeleton === 'object' && source.skeleton !== null) {
        const skeleton = source.skeleton;

        if ('spine' in skeleton && typeof skeleton.spine === 'string') return skeleton.spine;
    }
    throw invalid('The JSON has no "skeleton.spine" version field.');
}

function binaryVersion(bytes: Uint8Array): string {
    let offset = HASH_BYTES;
    let stored = 0;

    // the string length is a variable-length integer, 7 bits per byte, low bits first
    for (let shift = 0; ; shift += 7) {
        const byte = bytes[offset++];

        if (byte === undefined || shift > 28) throw invalid('The binary skeleton header is cut short.');
        stored |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
    }
    // the stored length counts one extra, and 0 means "no string"
    const length = stored - 1;

    if (length < 1 || length > MAX_VERSION_LENGTH || offset + length > bytes.length) {
        throw invalid('The binary skeleton has no version string where Spine 4 files keep it.');
    }
    const version = String.fromCharCode(...bytes.subarray(offset, offset + length));

    if (!/^\d+\.\d+/.test(version)) {
        throw invalid('The binary skeleton has no version string where Spine 4 files keep it.');
    }

    return version;
}

/** The first byte that is not white space or part of a byte order mark, or -1 when there is none. */
function firstByte(bytes: Uint8Array): number {
    for (const byte of bytes) {
        if (byte > 0x20 && byte !== 0xef && byte !== 0xbb && byte !== 0xbf) return byte;
    }

    return -1;
}

/**
 * The text that bytes hold, as UTF-8 without a byte order mark.
 *
 * @example
 * const root = JSON.parse(textOfBytes(bytes));
 */
export function textOfBytes(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes);
}

/** The error for a web page where a skeleton was expected. A server answers a wrong URL with one. */
const page = (): MarrowError =>
    new MarrowError('invalid-data', 'The data is an HTML or XML page, not a skeleton: it starts with "<".', {
        fix: 'Check the URL of the skeleton. A server that does not find a file can answer with its index page.',
    });

/**
 * Bytes are a binary skeleton when a version string is where Spine 4 keeps it. If not, bytes that
 * start with `{` are JSON text. The hash of a binary file can start with any byte, so the
 * version string is looked for first.
 */
function sniffBytes(bytes: Uint8Array): SkeletonSniff {
    let version: string;

    try {
        version = binaryVersion(bytes);
    } catch (error) {
        const first = firstByte(bytes);

        if (first === 0x7b) return supported('json', jsonTextVersion(textOfBytes(bytes)));
        if (first === 0x3c) throw page();
        throw error;
    }

    return supported('binary', version);
}

function supported(format: SkeletonSniff['format'], editorVersion: string): SkeletonSniff {
    const line = /^(\d+\.\d+)/.exec(editorVersion)?.[1];
    const version = SPINE_VERSIONS.find((candidate) => candidate === line);

    if (version === undefined) {
        throw new MarrowError('unsupported-version', `The skeleton was exported from Spine ${editorVersion}.`, {
            fix: 'Export it again from Spine 4.1, 4.2 or 4.3.',
            validNames: SPINE_VERSIONS,
        });
    }

    return { format, version, editorVersion };
}

/**
 * Reads the format and the Spine version of a skeleton file without importing it. Bytes that
 * hold JSON text count as JSON: the content decides, not a file name.
 * Throws a {@link MarrowError} when the data is not a skeleton or the version is not supported.
 *
 * @example
 * const bytes = new Uint8Array(await (await fetch('hero.skel')).arrayBuffer());
 * const { format, version } = sniffSkeleton(bytes); // 'binary', '4.2'
 */
export function sniffSkeleton(source: SkeletonSource): SkeletonSniff {
    if (typeof source === 'string') {
        if (source.trimStart().startsWith('<')) throw page();

        return supported('json', jsonTextVersion(source));
    }
    if (source instanceof Uint8Array) return sniffBytes(source);
    if (source instanceof ArrayBuffer) return sniffBytes(new Uint8Array(source));

    return supported('json', jsonObjectVersion(source));
}
