import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import type { Cuts } from './cuts';
import type { Draft } from './drafts';
import type { Template } from './template';

/*
 * The layouts that instances share. Most of a template is the same for every instance of a
 * model that shows the same skin with the same cuts: what an entry is, where its vertices are,
 * its texture coordinates. Those arrays are laid out once per model and layout. An instance gets
 * a template that points at them and has arrays of its own for what its pose writes.
 *
 * A layout is kept while an instance holds it. A view lets its template go when it lays itself
 * out again and when it is destroyed.
 */

/** A layout that instances share, and how many of them hold it. */
interface SharedLayout {
    /** The arrays of the layout, with the frames of the setup pose. No instance writes to them. */
    readonly template: Template;
    /** Whether a sequence can rewrite texture coordinates, so that every instance needs its own. */
    readonly sequenced: boolean;
    uses: number;
    readonly key: string;
    /** The layouts of the model, which this one leaves when its last instance lets go. */
    readonly store: Map<string, SharedLayout>;
}

/** Per model: the layouts its instances hold at the moment, by what decides a layout. */
const layouts = new WeakMap<SkeletonModel, Map<string, SharedLayout>>();

/** Per template of an instance: the layout it shares. */
const owners = new WeakMap<Template, SharedLayout>();

/** The templates whose instance still draws with them: each one counts in the uses of its layout. */
const held = new WeakSet<Template>();

/** A number per object that decides a layout: an atlas, outlines, an attachment. */
const ids = new WeakMap<object, number>();
let nextId = 1;

function idOf(thing: object): number {
    let id = ids.get(thing);

    if (id === undefined) {
        id = nextId++;
        ids.set(thing, id);
    }

    return id;
}

/**
 * What decides a layout, as text: the atlas, the skin, the cuts and the attachments of the
 * entries in their order. Two instances with the same text can share their layout.
 *
 * @example
 * const key = layoutKey(atlas, state.skin, false, cuts, draftEntries(model, atlas, lookup, state.skin, null, cuts));
 */
export function layoutKey(
    atlas: AtlasModel,
    skin: number,
    dark: boolean,
    cuts: Cuts | undefined,
    drafts: readonly Draft[],
): string {
    const cut =
        cuts === undefined
            ? 'none'
            : `${idOf(cuts.outlines)} ${cuts.tight} ${cuts.hollow} ${cuts.opaque} ${cuts.pages.join('')}`;

    return `${idOf(atlas)} ${skin} ${dark} ${cut} ${drafts.map((draft) => idOf(draft.attachment)).join(' ')}`;
}

/**
 * The template of one instance of a layout. It shares every array that no pose writes, and has
 * its own for the rest. A layout with a sequence gets its own texture coordinates too.
 */
function instanceOf(shared: SharedLayout, vertexColors: boolean): Template {
    const master = shared.template;
    const entries = master.slots.length;
    // a GPU buffer cannot be empty, so there is room for one vertex at least
    const room = Math.max(master.vertexCount, 1);
    const statics = shared.sequenced ? master.statics.slice() : master.statics;

    return {
        ...master,
        frames: master.frames.slice(),
        pages: master.pages.slice(),
        light: new Uint8Array(entries * 4),
        dark: new Uint8Array(entries * 4),
        positions: new Float32Array(room * 2),
        statics,
        flags: shared.sequenced ? new Uint8Array(statics.buffer) : master.flags,
        colors: new Uint8Array(vertexColors ? room * (master.hasDark ? 8 : 4) : 0),
    };
}

/**
 * The template of one more instance of a layout. `build` lays the layout out when no instance of
 * the model holds it yet.
 *
 * @param key What decides the layout, see {@link layoutKey}.
 * @param vertexColors Whether the instance needs a color per vertex, which the mesh mode uploads.
 *
 * @example
 * const template = shareLayout(model, key, true, () => layOut(model, atlas, skin, drafts, dark));
 */
export function shareLayout(model: SkeletonModel, key: string, vertexColors: boolean, build: () => Template): Template {
    let store = layouts.get(model);

    if (store === undefined) {
        store = new Map();
        layouts.set(model, store);
    }
    let shared = store.get(key);

    if (shared === undefined) {
        const template = build();

        shared = { template, sequenced: template.frameCounts.some((frames) => frames > 1), uses: 0, key, store };
        store.set(key, shared);
    }
    shared.uses++;
    const template = instanceOf(shared, vertexColors);

    owners.set(template, shared);
    held.add(template);

    return template;
}

/**
 * Lets a template of `buildTemplate` go: its instance draws no more with it. A layout
 * that no instance holds is forgotten, and the next instance lays it out again.
 *
 * @example
 * releaseTemplate(template);
 * template = buildTemplate(model, atlas, lookup, state.skin, state.attachments, false);
 */
export function releaseTemplate(template: Template): void {
    const shared = owners.get(template);

    // a template is let go once
    if (shared === undefined || !held.delete(template)) return;
    shared.uses--;
    if (shared.uses === 0) shared.store.delete(shared.key);
}

/**
 * Whether a template has texture coordinates of its own. It shares them with the other
 * instances of its layout unless an entry has a sequence.
 *
 * @example
 * const bytes = ownsStatics(template) ? template.statics.byteLength : 0;
 */
export function ownsStatics(template: Template): boolean {
    return owners.get(template)?.sequenced !== false;
}
