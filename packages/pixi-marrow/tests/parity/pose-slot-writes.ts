import type { AttachmentRef } from '../../src/core';
import type { OfficialDriver } from './pose-shared';

/*
 * The writes of the official runtime that a slot handle and a list of skins mirror, for every
 * version. 4.1 and 4.2 write the slot itself, 4.3 writes the pose of the slot, as code outside
 * the official runtime does between two updates.
 */

/** A color of an official core. `set` clamps, as `Color.set` does in every version. */
interface OfficialColor {
    set(r: number, g: number, b: number, a: number): unknown;
}

/** What a write reaches of one slot: the slot in 4.1 and 4.2, `slot.pose` in 4.3. */
interface OfficialSlotPose {
    color: OfficialColor;
    darkColor: OfficialColor | null;
    setAttachment(attachment: never): void;
}

/** A skin of an official core, as far as combining skins needs it. */
export interface OfficialSkin {
    addSkin(skin: never): void;
    getAttachment(slot: number, name: string): unknown;
}

/** What a version gives the writes. */
export interface SlotWriteParts<S extends OfficialSkin> {
    skins: readonly S[];
    /** A new empty skin of the core. */
    makeSkin(name: string): S;
    /** The official `Skeleton.setSkin`, null for none. */
    setSkin(skin: S | null): void;
    slotPose(slot: number): OfficialSlotPose | undefined;
}

export type SlotWrites = Pick<
    OfficialDriver,
    'setSkin' | 'setSkins' | 'skins' | 'setColor' | 'setDarkColor' | 'writeAttachment'
>;

/**
 * The skin calls and the slot writes of an official driver. Several skins become a new skin that
 * `Skin.addSkin` fills with each of them, as code with the official runtime does it. A new skin
 * every call, so the official side never shares one.
 */
export function slotWrites<S extends OfficialSkin>(parts: SlotWriteParts<S>): SlotWrites {
    let active: readonly number[] = [];
    const skinAt = (index: number): S => {
        const skin = parts.skins[index];

        if (skin === undefined) throw new Error(`The rig has no skin ${index}`);

        return skin;
    };
    const pose = (slot: number): OfficialSlotPose => {
        const found = parts.slotPose(slot);

        if (found === undefined) throw new Error(`The rig has no slot ${slot}`);

        return found;
    };

    const setSkin = (index: number): void => {
        parts.setSkin(index === -1 ? null : skinAt(index));
        active = index === -1 ? [] : [index];
    };

    return {
        setSkin,
        setSkins(indices) {
            if (indices.length < 2) {
                setSkin(indices[0] ?? -1);

                return;
            }
            const combined = parts.makeSkin('combined');

            for (const index of indices) combined.addSkin(skinAt(index) as never);
            parts.setSkin(combined);
            active = [...indices];
        },
        get skins() {
            return active;
        },
        setColor(slot, r, g, b, a) {
            pose(slot).color.set(r, g, b, a);
        },
        setDarkColor(slot, r, g, b) {
            const dark = pose(slot).darkColor;

            if (dark === null) throw new Error(`The slot ${slot} has no dark color`);
            dark.set(r, g, b, 1);
        },
        writeAttachment(slot: number, ref: AttachmentRef | null) {
            const attachment = ref === null ? null : skinAt(ref.skin).getAttachment(ref.slot, ref.name);

            if (ref !== null && attachment === null) throw new Error(`The skin ${ref.skin} has no ${ref.name}`);
            pose(slot).setAttachment(attachment as never);
        },
    };
}
