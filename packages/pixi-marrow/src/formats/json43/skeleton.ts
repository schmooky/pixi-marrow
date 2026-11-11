import {
    BLEND_MODES,
    BONE_SETUP_STRIDE,
    type BoneTable,
    type EventData,
    INHERIT_MODES,
    type SlotTable,
} from '../../model/model';
import { writeHexColor } from '../shared/color';
import { enumIndex, type ImportContext, requireName } from './context';
import type { JsonBone, JsonEvent, JsonSlot } from './schema';

/** Reads `bones`. A bone can name only a parent that comes before it. */
export function readBones(maps: readonly JsonBone[], ctx: ImportContext): BoneTable {
    const count = maps.length;
    const table: BoneTable = {
        count,
        names: [],
        parents: new Int16Array(count),
        setup: new Float32Array(count * BONE_SETUP_STRIDE),
        lengths: new Float32Array(count),
        inherit: new Uint8Array(count),
        skinRequired: new Uint8Array(count),
    };

    maps.forEach((map, i) => {
        const name = requireName(map.name, `Bone ${i}`);
        const user = `Bone "${name}"`;
        const setup = [
            map.x ?? 0,
            map.y ?? 0,
            map.rotation ?? 0,
            map.scaleX ?? 1,
            map.scaleY ?? 1,
            map.shearX ?? 0,
            map.shearY ?? 0,
        ];

        table.names.push(name);
        table.parents[i] = map.parent ? ctx.bones.require(map.parent, user) : -1;
        table.setup.set(setup, i * BONE_SETUP_STRIDE);
        table.lengths[i] = map.length ?? 0;
        table.inherit[i] = enumIndex(INHERIT_MODES, map.inherit ?? 'normal', `The inherit mode of ${user}`);
        table.skinRequired[i] = map.skin ? 1 : 0;
        ctx.bones.add(name, i);
    });
    ctx.boneCount = count;

    return table;
}

/** Reads `slots`. */
export function readSlots(maps: readonly JsonSlot[], ctx: ImportContext): SlotTable {
    const count = maps.length;
    const table: SlotTable = {
        count,
        names: [],
        bones: new Int16Array(count),
        colors: new Float32Array(count * 4).fill(1),
        darkColors: new Float32Array(count * 3),
        hasDark: new Uint8Array(count),
        attachments: [],
        blendModes: new Uint8Array(count),
        visible: new Uint8Array(count),
    };
    const dark = new Float32Array(4);

    maps.forEach((map, i) => {
        const name = requireName(map.name, `Slot ${i}`);
        const user = `Slot "${name}"`;

        table.names.push(name);
        table.bones[i] = ctx.bones.require(map.bone, user);
        if (map.color) writeHexColor(map.color, table.colors, i * 4);
        if (map.dark) {
            writeHexColor(map.dark, dark, 0);
            table.darkColors.set(dark.subarray(0, 3), i * 3);
            table.hasDark[i] = 1;
        }
        table.attachments.push(map.attachment ?? null);
        table.blendModes[i] = enumIndex(BLEND_MODES, map.blend ?? 'normal', `The blend mode of ${user}`);
        table.visible[i] = (map.visible ?? true) ? 1 : 0;
        ctx.slots.add(name, i);
    });
    ctx.slotCount = count;

    return table;
}

/** Reads `events`. Volume and balance are read only for an event with audio, as in the official parser. */
export function readEvents(maps: Readonly<Record<string, JsonEvent>>, ctx: ImportContext): EventData[] {
    return Object.entries(maps).map(([name, map], index) => {
        const audioPath = map.audio ?? null;
        const data: EventData = {
            name,
            int: map.int ?? 0,
            float: map.float ?? 0,
            string: map.string ?? '',
            audioPath,
            volume: audioPath ? (map.volume ?? 0) : 0,
            balance: audioPath ? (map.balance ?? 0) : 0,
        };

        ctx.events.add(name, { index, data });

        return data;
    });
}
