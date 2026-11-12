import type { Container } from 'pixi.js';
import type { CoverSearch } from './cover-search';
import { cutCode } from './cut-code';
import type { Template } from './template';
import type { VisibleList } from './visible';

/*
 * Covered slots, as far as every view holds them. A slot whose vertices all lie inside the
 * opaque rectangle of a slot drawn later shows no pixel, so its triangles are left out of the
 * index buffer.
 *
 * Only a layout that was made with outlines has an opaque rectangle. The code that searches
 * loads with the outlines, see `cut-code.ts` and `cover-search.ts`. A view without them holds
 * one mark per slot, all 0, and draws every slot.
 */

/**
 * The marks of the covered slots of one view, and the search that sets them once a layout has
 * an opaque rectangle to test with. A view that never has one holds one flag per slot and no more.
 *
 * @example
 * const cover = new CoverTest(model.slots.count);
 * if (cover.follow(template, seen, state.world, bones, view.container, moved, relisted)) {
 *     ranges.build(template, seen.list, seen.clips, cover.skipped, seen.count);
 * }
 */
export class CoverTest {
    /** Per visible entry: 1 when a later slot covers it. */
    readonly skipped: Uint8Array;
    /** Slots that are covered at the moment. */
    covered = 0;
    /**
     * True while a search for covered slots is owed: the pose moved since the last one. A view at
     * rest keeps calling {@link follow} until that search has run, and then stops.
     */
    owes = false;
    /** The search, from the first layout with an opaque rectangle on. */
    private search: CoverSearch | undefined;

    /** @param slots The slot count of the model: the most entries that can be visible. */
    constructor(slots: number) {
        this.skipped = new Uint8Array(slots);
    }

    /** The bytes of the typed arrays of the test. */
    get bytes(): number {
        return this.search?.bytes ?? this.skipped.byteLength;
    }

    /**
     * Brings the marks in line with a pose that a view is about to draw. Most frames have no
     * work, see `CoverSearch.follow`. Returns whether a mark changed, which asks for new index
     * buffers.
     *
     * @param container The container of the view. Asked about only when there is work.
     * @param moved Whether a vertex moved or the list changed.
     * @param relisted Whether the list, a clip or a hiding alpha changed.
     */
    follow(
        template: Template,
        visible: VisibleList,
        world: Float64Array,
        bones: Int16Array,
        container: Container,
        moved: boolean,
        relisted: boolean,
    ): boolean {
        // a layout without an opaque rectangle has nothing to test with
        if (template.opaqueCount === 0) {
            this.owes = false;

            return false;
        }
        // the code that gave the layout its rectangles is the code that searches
        this.search ??= cutCode()?.createSearch(this.skipped);

        return this.note(this.search?.follow(template, visible, world, bones, container, moved, relisted));
    }

    /**
     * Marks no entry as covered. Returns whether a mark changed. Marks that were taken away are
     * owed a search: an update finds them again once Pixi draws the skeleton as its vertices say.
     */
    clear(): boolean {
        return this.note(this.search?.clear());
    }

    /** Takes over what the search found. `changed` is what it returned, or undefined without a search. */
    private note(changed: boolean | undefined): boolean {
        const { search } = this;

        if (search !== undefined) {
            this.covered = search.covered;
            this.owes = search.owes;
        }

        return changed === true;
    }
}
