import type { SkeletonModel } from '../../model/model';
import { BinaryInput } from '../shared/binary-input';
import { readAnimations } from './animation';
import { readConstraints } from './constraints';
import { readBones, readEvents, readHeader, readSlots, readStrings } from './skeleton';
import { linkMeshes, readSkins, skinData } from './skins';
import type { BinaryVersion, ImportState } from './state';

/**
 * Imports a Spine 4.1 or 4.2 binary skeleton. It reads the bytes in the order and with the
 * layout of the official `SkeletonBinary` of that version, and keeps lengths in file units.
 *
 * Throws a `MarrowError` when an index in the file points nowhere, and a `RangeError` when the
 * data ends early.
 */
export function importBinary42(bytes: Uint8Array, version: BinaryVersion): SkeletonModel {
    const input = new BinaryInput(bytes);
    const { nonessential, ...header } = readHeader(input, version);
    const state: ImportState = {
        input,
        version,
        byteLength: bytes.byteLength,
        nonessential,
        boneCount: 0,
        slotCount: 0,
        ikCount: 0,
        transformCount: 0,
        pathCount: 0,
        physicsCount: 0,
        hasDefaultSkin: false,
        skins: [],
        events: [],
        linkedMeshes: [],
        geometry: new Map(),
    };

    readStrings(state);
    const bones = readBones(state);
    const slots = readSlots(state);
    const constraints = readConstraints(state);

    readSkins(state);
    linkMeshes(state);
    const events = readEvents(state);
    const animations = readAnimations(state);

    return { version, ...header, bones, slots, events, constraints, skins: state.skins.map(skinData), animations };
}
