import type { AttachmentRef } from '../../src/core';
import { DT, ODD, type PoseScript, pick, script } from './pose-script';
import type { PoseRigInfo } from './pose-shared';

/*
 * Scripts for several skins at once and for writes to slots from outside the engine. The display
 * object hands out slots and takes a list of skins. The official counterparts are a skin that
 * `Skin.addSkin` filled with each skin in order, and writes to `slot.color`, `slot.darkColor` and
 * `slot.setAttachment`, or to the same on `slot.pose` in 4.3.
 *
 * What the official runtime does is the rule. A later skin wins where two store an attachment
 * under one slot and name. A written value stays until a timeline keys the slot or a setup pose
 * call. A slot that a slider poses shows it with the next update.
 */

/** Up to three skins of a rig for combining, the default skin last, so that it rarely wins. */
function skinsToCombine(rig: PoseRigInfo): number[] {
    const all = Array.from({ length: rig.skins }, (_, i) => i);
    const named = all.slice(1);

    return [...named.slice(0, 2), ...named.slice(-1), 0].filter((skin, i, list) => list.indexOf(skin) === i);
}

/** Combined skins, in every order that changes what wins, and back to one skin and to none. */
function combined(rig: PoseRigInfo): PoseScript[] {
    if (rig.skins === 0) return [];
    const { a, b } = pick(rig, 2);
    const [first = 0, second = first, third = second] = skinsToCombine(rig);

    return [
        script('combined skins', (s) => {
            s.skins([first, second]);
            s.setupPoseSlots();
            s.set(0, a, true);
            s.update(DT, 4);
            // the other order lets the other skin win where both store a name
            s.skins([second, first]);
            s.update(DT, 3);
            s.skins([first, second, third]);
            s.update(ODD, 3);
            s.skins([first]);
            s.update(DT, 2);
            s.skins([first, second]);
            // the same list again changes nothing
            s.skins([first, second]);
            s.update(DT, 2);
            s.skins([]);
            s.update(DT, 2);
            s.skins([third, first]);
            s.setupPose();
            s.set(0, b, true);
            s.update(ODD, 4);
        }),
        script('combined from no skin', (s) => {
            s.skin(-1);
            // with no skin before, slots take their setup attachment from the combined skin
            s.skins([second, third]);
            s.set(0, b, true);
            s.update(DT, 3);
            s.skin(first);
            s.update(DT, 2);
            s.skins([first, first]);
            s.update(DT, 2);
        }),
    ];
}

/**
 * More lists of skins than the engines keep while no instance shows them, then the first list
 * again. Our side frees the oldest combined skins and builds the first one anew. The official
 * side builds a new skin every time.
 */
function manyLists(rig: PoseRigInfo): PoseScript[] {
    const named = Array.from({ length: rig.skins - 1 }, (_, i) => i + 1);

    if (named.length < 5) return [];
    const { a } = pick(rig, 3);
    const lists: number[][] = [];

    for (let i = 0; i < named.length && lists.length < 12; i++) {
        for (let j = i + 1; j < named.length && lists.length < 12; j++) {
            lists.push([named[i] ?? 1, named[j] ?? 2]);
        }
    }

    return [
        script('many lists of skins', (s) => {
            s.set(0, a, true);
            for (const list of lists) {
                s.skins(list);
                s.update(DT, 1);
            }
            s.skins(lists[0] ?? []);
            s.setupPoseSlots();
            s.update(ODD, 3);
        }),
    ];
}

/** The slots a script writes, picked for the animation it plays. */
function slotsFor(rig: PoseRigInfo, animation: number) {
    const keyed = new Set(rig.animations[animation]?.keyedSlots ?? []);
    const bySlot = new Map<number, AttachmentRef[]>();

    for (const ref of rig.entries) bySlot.set(ref.slot, [...(bySlot.get(ref.slot) ?? []), ref]);
    const withAttachments = [...bySlot.keys()];
    const unkeyed = withAttachments.filter((slot) => !keyed.has(slot));
    const swappable = withAttachments.find((slot) => (bySlot.get(slot)?.length ?? 0) > 1);

    return {
        /** A slot no timeline of the animation keys. */
        free: unkeyed[0] ?? 0,
        /** A slot the animation keys. The free slot when it keys none. */
        keyed: [...keyed][0] ?? unkeyed[0] ?? 0,
        /** A slot with more than one attachment to choose from, and two of its attachments. */
        swap: swappable,
        refs: (slot: number): AttachmentRef[] => bySlot.get(slot) ?? [],
    };
}

/** Writes to the attachment, the color and the dark color of slots, while playing and at rest. */
function writes(rig: PoseRigInfo): PoseScript[] {
    if (rig.slots === 0 || rig.entries.length === 0) return [];
    const { a, b, duration } = pick(rig, 1);
    const slots = slotsFor(rig, a);
    const [one, two] = slots.refs(slots.swap ?? slots.free);
    const other = slots.refs(slots.keyed)[0] ?? one ?? null;
    const swap = slots.swap ?? slots.free;
    const scripts = [
        script('slot attachment writes', (s) => {
            s.set(0, a, true);
            s.update(DT, 2);
            s.slotAttachment(swap, two ?? one ?? null);
            s.update(DT, 3);
            s.slotAttachment(swap, null);
            s.update(DT, 2);
            // a slot the animation keys gets its key back in the next update
            s.slotAttachment(slots.keyed, other);
            s.update(ODD, 2);
            s.slotAttachment(swap, one ?? null);
            s.setupPoseSlots();
            s.update(DT, 2);
        }),
        script('slot color writes', (s) => {
            const entry = s.set(0, a, true);

            s.update(DT, 2);
            s.slotColor(slots.free, 0.3, 0.6, 0.9, 0.5);
            s.update(DT, 3);
            // outside 0 and 1 is clamped on both sides, on a slot no key overwrites before the comparison
            s.slotColor(slots.free, 1.4, -0.2, 0.5, 2);
            s.update(ODD, 2);
            // the same color again changes nothing
            s.slotColor(slots.free, 1.4, -0.2, 0.5, 2);
            s.update(DT, 1);
            s.slotColor(slots.keyed, 0.9, 0.8, 0.7, 0.6);
            s.update(ODD, 2);
            // a track below 1 mixes the key with the written color
            s.configure(entry, { alpha: 0.5 });
            s.slotColor(slots.keyed, 0.1, 0.2, 0.3, 0.4);
            s.update(DT, 2);
            s.setupPoseSlots();
            s.update(DT, 2);
        }),
        script('slot writes at rest', (s) => {
            // the slots of the animation that rests: one it keys and one it does not
            const resting = slotsFor(rig, b);
            const [first, second] = resting.refs(resting.swap ?? resting.free);

            s.set(0, b, false);
            s.update(Math.max(DT, duration(b) * 0.6), 3);
            s.slotColor(resting.free, 0.5, 0.25, 0.75, 1);
            s.update(DT, 2);
            s.slotColor(resting.keyed, 0.25, 0.5, 0.75, 0.5);
            s.update(DT, 2);
            s.slotAttachment(resting.swap ?? resting.free, second ?? null);
            s.update(DT, 2);
            s.slotAttachment(resting.swap ?? resting.free, second ?? null);
            s.update(DT, 1);
            s.slotAttachment(resting.keyed, first ?? null);
            s.update(DT, 1);
            s.skins(skinsToCombine(rig).slice(0, 2));
            s.update(DT, 2);
        }),
        script('every slot written', (s) => {
            // every slot, so that a slot a 4.3 slider poses, a linked mesh and a sequence get a write too
            const all = Array.from({ length: Math.min(rig.slots, 80) }, (_, slot) => slot);
            const write = (n: number): void => {
                for (const slot of all) {
                    const refs = slots.refs(slot);

                    s.slotColor(slot, ((slot + n) % 5) / 4, ((slot + 2 * n) % 3) / 2, 0.5, ((slot + n) % 4) / 3);
                    if (refs.length > 0) s.slotAttachment(slot, refs[(slot + n) % refs.length] ?? null);
                }
            };

            s.set(0, a, true);
            s.update(DT, 1);
            write(1);
            s.update(DT, 2);
            write(2);
            s.update(ODD, 2);
            s.clearTracks();
            write(3);
            s.update(DT, 2);
        }),
    ];
    const dark = rig.darkSlots[0];

    if (dark !== undefined) {
        scripts.push(
            script('dark color writes', (s) => {
                s.set(0, a, true);
                s.update(DT, 2);
                s.slotDark(dark, 0.2, 0.1, 0.4);
                s.update(DT, 3);
                // with no track nothing keys the slot before the comparison: the clamp shows
                s.clearTracks();
                s.slotDark(dark, -1, 0.5, 3);
                s.update(ODD, 2);
                s.setupPoseSlots();
                s.update(DT, 1);
            }),
        );
    }

    return scripts;
}

/** Several skins at once, and writes to slots from outside the engine. */
export function slotScripts(rig: PoseRigInfo): PoseScript[] {
    if (rig.animations.length === 0) return [];

    return [...combined(rig), ...manyLists(rig), ...writes(rig)];
}
