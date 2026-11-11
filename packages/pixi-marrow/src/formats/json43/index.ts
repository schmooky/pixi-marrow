import type { SkeletonModel } from '../../model/model';
import { readAnimations } from './animations';
import { linkSliderAnimations, readConstraints } from './constraints';
import { ImportContext, invalid } from './context';
import type { JsonRoot } from './schema';
import { readBones, readEvents, readSlots } from './skeleton';
import { readSkins } from './skins';

/** Reads the file in the order of the official `SkeletonJson.readSkeletonData`. */
function readModel(root: JsonRoot): SkeletonModel {
    const header = root.skeleton ?? {};
    const constraintMaps = root.constraints ?? [];
    const ctx = new ImportContext();

    if (typeof header.spine !== 'string') throw invalid('The JSON has no "skeleton.spine" version field.');
    const bones = readBones(root.bones ?? [], ctx);
    const slots = readSlots(root.slots ?? [], ctx);

    readConstraints(constraintMaps, ctx);
    const skins = readSkins(root.skins ?? [], ctx);
    const events = readEvents(root.events ?? {}, ctx);
    const animations = readAnimations(root.animations ?? {}, ctx);

    linkSliderAnimations(constraintMaps, ctx);

    return {
        version: '4.3',
        editorVersion: header.spine,
        hash: header.hash ?? null,
        x: header.x ?? 0,
        y: header.y ?? 0,
        width: header.width ?? 0,
        height: header.height ?? 0,
        referenceScale: header.referenceScale ?? 100,
        bones,
        slots,
        events,
        constraints: ctx.constraints,
        skins,
        animations,
    };
}

/**
 * Imports a Spine 4.3 JSON skeleton. A port of the official `SkeletonJson` of spine-core 4.3.
 *
 * Throws a `MarrowError` with the code `invalid-data` when the file refers to a name that does
 * not exist, or when a value has the wrong type.
 *
 * @param source the parsed JSON
 * @example
 * const model = importJson43(JSON.parse(text));
 * console.log(model.bones.count, model.animations.map((animation) => animation.name));
 */
export function importJson43(source: object): SkeletonModel {
    try {
        return readModel(source as JsonRoot);
    } catch (error) {
        // a value of the wrong type, for example a number where the file must hold a list
        if (error instanceof TypeError || error instanceof RangeError) {
            throw invalid(`The skeleton JSON does not have the shape of a Spine 4.3 export: ${error.message}.`);
        }
        throw error;
    }
}
