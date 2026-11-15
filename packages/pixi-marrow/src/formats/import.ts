import { MarrowError } from '../base/errors';
import type { SkeletonModel } from '../model/model';
import { type SkeletonSource, sniffSkeleton, textOfBytes } from './sniff';

const EXPORT_FIX = 'Export the skeleton again from Spine 4.1, 4.2 or 4.3.';

function parseJson(text: string): object {
    try {
        return JSON.parse(text);
    } catch {
        throw new MarrowError('invalid-data', 'The skeleton JSON cannot be parsed.', { fix: EXPORT_FIX });
    }
}

async function importJson(source: SkeletonSource, version: SkeletonModel['version']): Promise<SkeletonModel> {
    let root: object;

    // bytes that hold JSON text, for example a file that was fetched without a look at its name
    if (source instanceof ArrayBuffer) root = parseJson(textOfBytes(new Uint8Array(source)));
    else if (source instanceof Uint8Array) root = parseJson(textOfBytes(source));
    else root = typeof source === 'string' ? parseJson(source.replace(/^\uFEFF/, '')) : source;

    if (version === '4.3') return (await import('./json43/index')).importJson43(root);

    return (await import('./json42/index')).importJson42(root, version);
}

async function importBinary(source: SkeletonSource, version: SkeletonModel['version']): Promise<SkeletonModel> {
    const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;

    if (!(bytes instanceof Uint8Array)) {
        throw new MarrowError('invalid-data', 'A binary skeleton must be passed as bytes.', {
            fix: 'Pass a Uint8Array or an ArrayBuffer.',
        });
    }
    try {
        if (version === '4.3') return (await import('./binary43/index')).importBinary43(bytes);

        return (await import('./binary42/index')).importBinary42(bytes, version);
    } catch (error) {
        // reading past the end of the data
        if (error instanceof RangeError) {
            throw new MarrowError('invalid-data', 'The binary skeleton ends before its data does.', {
                fix: EXPORT_FIX,
            });
        }
        throw error;
    }
}

/**
 * Imports a skeleton file into a {@link SkeletonModel}. Accepts JSON text, parsed JSON, or the
 * bytes of a `.skel` file or of a JSON file, from Spine 4.1, 4.2 or 4.3. The content of the bytes
 * decides the format. The reader for the format and version of the file is loaded on demand.
 *
 * Throws a {@link MarrowError} when the data is not a skeleton, is damaged, or is from another version.
 *
 * @example
 * const bytes = new Uint8Array(await (await fetch('hero.skel')).arrayBuffer());
 * const model = await importSkeleton(bytes);
 * console.log(model.bones.count, model.animations.map((animation) => animation.name));
 */
export async function importSkeleton(source: SkeletonSource): Promise<SkeletonModel> {
    const { format, version } = sniffSkeleton(source);

    return format === 'json' ? importJson(source, version) : importBinary(source, version);
}
