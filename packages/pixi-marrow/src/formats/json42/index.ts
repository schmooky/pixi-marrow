import { MarrowError } from '../../base/errors';
import type { SkeletonModel } from '../../model/model';
import { readAnimations } from './animations';
import { readConstraints } from './constraints';
import type { Json42Version, SkeletonRefs } from './context';
import type { JsonRoot } from './schema';
import { readBones, readEvents, readSkeletonInfo, readSlots } from './skeleton';
import { readSkins } from './skins';
import { indexNames } from './values';

function readModel(root: JsonRoot, version: Json42Version): SkeletonModel {
    const info = readSkeletonInfo(root, version);
    const bones = readBones(root, version);
    const slots = readSlots(root, bones.index, version);
    const constraints = readConstraints(root, bones.index, slots.index, version);
    const refs: SkeletonRefs = {
        version,
        bones: bones.index,
        boneCount: bones.table.count,
        slots: slots.index,
        slotCount: slots.table.count,
        constraints: constraints.refs,
    };
    const skins = readSkins(root, refs);
    const events = readEvents(root);
    const animations = readAnimations(root, {
        ...refs,
        skins: skins.index,
        attachments: skins.attachments,
        geometry: skins.geometry,
        events: indexNames(events.map((event) => event.name)),
        eventData: events,
    });

    return {
        version,
        ...info,
        bones: bones.table,
        slots: slots.table,
        events,
        constraints: constraints.list,
        skins: skins.list,
        animations,
    };
}

/**
 * Imports a parsed Spine 4.1 or 4.2 JSON skeleton. It is a port of the official `SkeletonJson`
 * of both versions, and reads each file the way the parser of its own version does.
 *
 * Throws a {@link MarrowError} with the code `invalid-data` when the file refers to a name that
 * does not exist or does not have the shape of a Spine export.
 *
 * @param root the parsed JSON
 * @param version the version line of the file, from `sniffSkeleton`
 * @example
 * const root = JSON.parse(await (await fetch('hero.json')).text());
 * const model = importJson42(root, '4.2');
 * console.log(model.bones.count, model.animations.map((animation) => animation.name));
 */
export function importJson42(root: object, version: Json42Version): SkeletonModel {
    try {
        return readModel(root as JsonRoot, version);
    } catch (error) {
        if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
        // a value of the wrong type, for example a number where the format has a list
        throw new MarrowError(
            'invalid-data',
            `The JSON does not have the shape of a Spine skeleton (${error.message}).`,
            {
                fix: 'Export the skeleton again from Spine 4.1 or 4.2.',
            },
        );
    }
}
