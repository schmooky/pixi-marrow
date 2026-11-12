import { MarrowError } from '../base/errors';
import { f64, i16, i32 } from '../geometry/read';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import { isNewer, type PoseState } from '../pose/state';
import { checkClip } from './clip-check';
import { u8 } from './read';
import { findEntry, type Template } from './template';

/** The clip of a visible entry that no clipping attachment cuts. */
export const NO_CLIP = -1;

/** What a slot shows when it is no entry of the template. */
const NONE = -1;
/** A region or mesh attachment the template has no range for. */
const FOREIGN = -2;
/** A clipping attachment. */
const CLIPPING = -3;
/** Added to the entry of a slot whose alpha let it show in the pose that was collected last. */
const SHOWS = 0x40000000;

/** What a slot was noted with, without {@link SHOWS}: its entry, or a negative code. */
const entryOf = (noted: number): number => (noted < 0 ? noted : noted & ~SHOWS);

/**
 * The slots of one view that are drawn, in draw order, as entries of its template, each with
 * the clip that cuts it. The index buffers of the view hold this list.
 *
 * @example
 * const seen = new VisibleList(model);
 * if (!seen.resolve(template, state)) console.log('a slot shows an attachment without a vertex range');
 * const count = seen.collect(template, state);
 * if (seen.dirty) ranges.build(template, seen.list, seen.clips, skipped, count);
 */
export class VisibleList {
    /** Per slot: the attachment its entry was resolved for. */
    readonly shown: (AttachmentData | null)[];
    /** The visible entries in draw order. Valid up to {@link count}. */
    readonly list: Int32Array;
    /** Per visible entry: the slot whose clipping attachment cuts it, or `NO_CLIP`. */
    readonly clips: Int16Array;
    /** How many entries are visible. */
    count = 0;
    /** Clipping attachments that are applied in the pose that was collected last. */
    applied = 0;
    /** Visible entries that a clipping attachment cuts in the pose that was collected last. */
    clipped = 0;
    /** True when the list differs from the one the index buffers were written for. */
    dirty = true;
    /**
     * Per slot: the entry of the attachment it shows, or a negative code. An entry has
     * {@link SHOWS} added while the alpha of its slot let it show in the pose that was collected last.
     */
    private readonly entries: Int32Array;
    private readonly bones: Int16Array;
    /** 4.3 ends a clip at its end slot before a clipping attachment of that slot starts. Older versions do not. */
    private readonly endsFirst: boolean;

    constructor(model: SkeletonModel) {
        const slots = model.slots.count;

        this.shown = new Array<AttachmentData | null>(slots).fill(null);
        this.entries = new Int32Array(slots).fill(NONE);
        this.list = new Int32Array(slots);
        this.clips = new Int16Array(slots).fill(NO_CLIP);
        this.bones = model.slots.bones;
        this.endsFirst = model.version === '4.3';
    }

    /** The bytes of the typed arrays of the list. */
    get bytes(): number {
        return this.list.byteLength + this.clips.byteLength + this.entries.byteLength;
    }

    /** Forgets what the slots show, for a template that was built for another skin. */
    reset(): void {
        this.shown.fill(null);
        this.entries.fill(NONE);
        this.count = 0;
        this.dirty = true;
    }

    /**
     * Finds the entry of every slot whose attachment changed since the last call. Returns false
     * when a slot shows a region or a mesh the template has no range for.
     *
     * Throws a {@link MarrowError} for a clipping attachment with fewer than three vertices.
     */
    resolve(template: Template, state: PoseState): boolean {
        const { shown, entries } = this;
        const { attachments } = state;
        let known = true;

        for (let slot = 0; slot < shown.length; slot++) {
            const attachment = attachments[slot] ?? null;

            if (attachment === shown[slot]) continue;
            const entry = attachment?.type === 'clipping' ? CLIPPING : findEntry(template, slot, attachment);

            // a polygon that cannot clip is not remembered, so every update throws until it is gone
            if (attachment?.type === 'clipping') checkClip(attachment);

            // not remembered: when the template cannot be built, the next update asks again
            if (entry === FOREIGN) known = false;
            else {
                shown[slot] = attachment;
                entries[slot] = entry;
            }
        }

        return known;
    }

    /**
     * Whether a pose that is newer than a version changes the list. The draw order is newer, or
     * a slot that is newer shows another attachment or has an alpha that reached 0 or left it.
     * A color, a deform or a sequence index that changed otherwise leaves the list as it is.
     * Bones are active or not by the skin, which lays the vertex ranges out again.
     *
     * @param seen The version of the pose the list was collected for.
     */
    relists(template: Template, state: PoseState, seen: number): boolean {
        const { shown, entries } = this;
        const { slotStamps, attachments, colors } = state;
        const { tints } = template;

        if (isNewer(state.drawOrderStamp, seen)) return true;
        for (let slot = 0; slot < shown.length; slot++) {
            if (!isNewer(Number(slotStamps[slot]), seen)) continue;
            if ((attachments[slot] ?? null) !== shown[slot]) return true;
            const noted = i32(entries, slot);

            if (noted < 0) continue;
            const shows = f64(colors, slot * 4 + 3) * f64(tints, entryOf(noted) * 4 + 3) !== 0;

            if (shows !== noted >= SHOWS) return true;
        }

        return false;
    }

    /**
     * Lists the visible entries in draw order, each with the clip that cuts it. A slot is hidden
     * without a region or mesh attachment, on an inactive bone, and when its alpha times the alpha
     * of the attachment is 0. Sets {@link dirty} when the list differs from the one before.
     *
     * The clip rules are those of the official `SkeletonClipping` and of the loop that drives it.
     * A clipping attachment on an active bone starts a clip unless one is active. The clip ends
     * after its end slot, hidden or not, or with the draw order. A slot that shows a clipping
     * attachment does not end a clip, except that 4.3 ends the active clip there first when the
     * slot is its end slot. An inactive bone starts no clip.
     */
    collect(template: Template, state: PoseState): number {
        const { entries, bones } = this;
        const { tints } = template;
        const { drawOrder, active, colors } = state;
        let count = 0;
        let applied = 0;
        let clipped = 0;
        let clip = NO_CLIP;
        let end = NO_CLIP;

        for (let i = 0; i < drawOrder.length; i++) {
            const slot = i16(drawOrder, i);
            const entry = entryOf(i32(entries, slot));
            const live = u8(active, i16(bones, slot)) === 1;

            if (live && entry === CLIPPING) {
                if (this.endsFirst && slot === end) clip = NO_CLIP;
                if (clip === NO_CLIP) {
                    clip = slot;
                    end = this.endSlot(slot);
                    applied++;
                }
                continue;
            }
            if (entry >= 0 && this.alpha(f64(colors, slot * 4 + 3) * f64(tints, entry * 4 + 3), slot, entry) && live) {
                this.show(count++, entry, clip);
                if (clip !== NO_CLIP) clipped++;
            }
            if (slot === end) {
                clip = NO_CLIP;
                end = NO_CLIP;
            }
        }
        if (count !== this.count) this.dirty = true;
        this.count = count;
        this.applied = applied;
        this.clipped = clipped;

        return count;
    }

    /** Whether a pose still shows what the slots were resolved for, with the skin of a template. */
    inStep(template: Template, state: PoseState): boolean {
        const { shown } = this;
        const { attachments } = state;

        if (state.skin !== template.skin) return false;
        for (let slot = 0; slot < shown.length; slot++) {
            if ((attachments[slot] ?? null) !== shown[slot]) return false;
        }

        return true;
    }

    /**
     * Moves the list from one template to another one that was laid out for the same skin and
     * the same attachments. The slots, their order and their clips stay. The entry numbers are
     * those of the new template. `state` must be in step, see {@link inStep}.
     */
    carry(from: Template, to: Template, state: PoseState): void {
        const { list, entries, count } = this;

        for (let i = 0; i < count; i++) list[i] = i32(from.slots, i32(list, i));
        this.shown.fill(null);
        entries.fill(NONE);
        this.resolve(to, state);
        for (let i = 0; i < count; i++) {
            const slot = i32(list, i);
            const entry = i32(entries, slot);

            if (entry < 0) {
                throw new MarrowError('invalid-data', 'A visible slot has no vertex range after a new layout.', {
                    fix: 'Report this as a bug of pixi-marrow.',
                });
            }
            list[i] = entry;
            // a slot of the list shows
            entries[slot] = entry | SHOWS;
        }
        this.dirty = true;
    }

    /** Notes whether the alpha of a slot with an entry lets it show, for {@link relists}, and returns that. */
    private alpha(alpha: number, slot: number, entry: number): boolean {
        this.entries[slot] = alpha === 0 ? entry : entry | SHOWS;

        return alpha !== 0;
    }

    /** The last slot the clipping attachment of a slot cuts, or `NO_CLIP` when it cuts to the end. */
    private endSlot(slot: number): number {
        const attachment = this.shown[slot];

        return attachment?.type === 'clipping' ? attachment.endSlot : NO_CLIP;
    }

    /** Puts an entry and its clip at a place of the list. Sets {@link dirty} when they are new there. */
    private show(at: number, entry: number, clip: number): void {
        if (this.list[at] === entry && this.clips[at] === clip) return;
        this.list[at] = entry;
        this.clips[at] = clip;
        this.dirty = true;
    }
}
