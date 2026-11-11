import type { SkeletonModel } from '../../model/model';
import { BinaryInput } from '../shared/binary-input';
import { readAnimations } from './animations';
import { readConstraints, resolveSliders } from './constraints';
import type { ImportState } from './reader';
import { readBones, readEvents, readHeader, readSlots, readStrings } from './skeleton';
import { readSkins, toSkinData } from './skins';

/**
 * Imports a Spine 4.3 binary skeleton. A port of the official 4.3 `SkeletonBinary` reader that
 * builds the model instead of the official data objects.
 *
 * Throws a `MarrowError` for data the format does not allow, and a `RangeError` when the bytes
 * end too early. `importSkeleton` turns the second into a `MarrowError` too.
 */
export function importBinary43(bytes: Uint8Array): SkeletonModel {
    const input = new BinaryInput(bytes);
    const header = readHeader(input);

    readStrings(input);
    const bones = readBones(input, header.nonessential);
    const slots = readSlots(input, bones.count, header.nonessential);
    const state: ImportState = {
        input,
        nonessential: header.nonessential,
        boneCount: bones.count,
        slotCount: slots.count,
        constraints: [],
        skins: [],
        linked: [],
        geometry: new Map(),
        events: [],
    };

    state.constraints = readConstraints(state);
    readSkins(state);
    state.events = readEvents(input);
    const animations = readAnimations(state);

    resolveSliders(state, animations.length);

    return {
        version: '4.3',
        editorVersion: header.editorVersion,
        hash: header.hash,
        x: header.x,
        y: header.y,
        width: header.width,
        height: header.height,
        referenceScale: header.referenceScale,
        bones,
        slots,
        events: state.events,
        constraints: state.constraints,
        skins: state.skins.map(toSkinData),
        animations,
    };
}
