import type { AttachmentData, AttachmentRef, MeshAttachmentData } from '../../model/attachments';
import type { SkeletonModel, SkinData } from '../../model/model';

/**
 * Finds attachments of a model by skin, slot and name. Built once per model.
 *
 * A skin index counts the skins of the model first, then the skins that {@link add} added.
 * Every instance of the model shares both.
 */
export interface AttachmentLookup {
    /** The index of the default skin: the last skin named `default`. -1 when there is none. */
    readonly defaultSkin: number;
    /** How many skins an index can point at: those of the model, then those that {@link add} added. */
    readonly skinCount: number;
    /** The skin at an index, or undefined for -1, for an index past {@link skinCount} and for one that {@link drop} freed. */
    skin(index: number): SkinData | undefined;
    /** The skins of the model that a skin is made of, in order: itself for a skin of the model, none for -1. */
    parts(index: number): readonly number[];
    /**
     * Adds a skin made of skins of the model and returns its index. A key that was added before
     * gives the index it got then, and `make` is not called. `combineSkins` is what calls it.
     */
    add(key: string, parts: readonly number[], make: () => SkinData): number;
    /**
     * Frees a skin that {@link add} added: its tables go, and its index stays unused. The next
     * {@link add} of its key makes a new skin with a new index. Does nothing for a skin of the
     * model. `combineSkins` decides when, see `releaseSkin`.
     */
    drop(index: number): void;
    /** The attachment a skin stores under a slot and a name. */
    get(skin: number, slot: number, name: string): AttachmentData | undefined;
    /**
     * The name a skin stores an attachment under for a slot, or undefined. The first in name
     * order when it stores the attachment under several names. Built once per skin and slot.
     */
    nameOf(skin: number, slot: number, attachment: AttachmentData): string | undefined;
    /**
     * The attachment a slot shows for a name, as the official `Skeleton.getAttachment` finds it:
     * in the active skin first, then in the default skin.
     */
    find(activeSkin: number, slot: number, name: string): AttachmentData | undefined;
    /** The attachment a reference points at. */
    resolve(ref: AttachmentRef): AttachmentData | undefined;
}

/** The lookup of each model that has one. Every instance of a skeleton shares it. */
const LOOKUPS = new WeakMap<SkeletonModel, AttachmentLookup>();

/**
 * The lookup tables of a model. They are built at the first call for a model and shared after
 * that, so a model must not change once it has a lookup.
 *
 * @example
 * const lookup = createAttachmentLookup(model);
 * const head = lookup.find(engine.state.skin, model.slots.names.indexOf('head'), 'head');
 */
export function createAttachmentLookup(model: SkeletonModel): AttachmentLookup {
    let lookup = LOOKUPS.get(model);

    if (lookup === undefined) {
        lookup = buildLookup(model);
        LOOKUPS.set(model, lookup);
    }

    return lookup;
}

/** Per slot of one skin: name to attachment. */
type SkinTable = (Map<string, AttachmentData> | undefined)[];

/** Per table of a slot: attachment to the first name it is stored under. */
const NAMES = new WeakMap<Map<string, AttachmentData>, Map<AttachmentData, string>>();

function namesOf(names: Map<string, AttachmentData>): Map<AttachmentData, string> {
    let back = NAMES.get(names);

    if (back === undefined) {
        back = new Map();
        // a table holds its names in name order, as the skin does
        for (const [name, attachment] of names) if (!back.has(attachment)) back.set(attachment, name);
        NAMES.set(names, back);
    }

    return back;
}

function tableOf(skin: SkinData): SkinTable {
    const slots: SkinTable = [];

    for (const entry of skin.attachments) {
        let names = slots[entry.slot];

        if (names === undefined) {
            names = new Map();
            slots[entry.slot] = names;
        }
        names.set(entry.name, entry.attachment);
    }

    return slots;
}

function buildLookup(model: SkeletonModel): AttachmentLookup {
    const own = model.skins.length;
    const tables = model.skins.map(tableOf);
    // the skins that `add` added, after those of the model, with what each is made of and its key
    const made: (SkinData | undefined)[] = [];
    const madeParts: (readonly number[] | undefined)[] = [];
    const keys: string[] = [];
    const byKey = new Map<string, number>();
    const defaultSkin = model.skins.findLastIndex((skin) => skin.name === 'default');
    const get = (skin: number, slot: number, name: string): AttachmentData | undefined =>
        tables[skin]?.[slot]?.get(name);

    return {
        defaultSkin,
        get skinCount() {
            return own + made.length;
        },
        skin: (index) => (index < own ? model.skins[index] : made[index - own]),
        parts: (index) => (index < 0 ? [] : index < own ? [index] : (madeParts[index - own] ?? [])),
        add(key, parts, make) {
            let index = byKey.get(key);

            if (index === undefined) {
                const skin = make();

                index = own + made.length;
                made.push(skin);
                madeParts.push(Object.freeze([...parts]));
                keys.push(key);
                tables.push(tableOf(skin));
                byKey.set(key, index);
            }

            return index;
        },
        drop(index) {
            const at = index - own;

            if (at < 0 || made[at] === undefined) return;
            byKey.delete(keys[at] ?? '');
            made[at] = undefined;
            madeParts[at] = undefined;
            tables[index] = [];
        },
        get,
        nameOf(skin, slot, attachment) {
            const names = tables[skin]?.[slot];

            return names === undefined ? undefined : namesOf(names).get(attachment);
        },
        find: (activeSkin, slot, name) => get(activeSkin, slot, name) ?? get(defaultSkin, slot, name),
        resolve: (ref) => get(ref.skin, ref.slot, ref.name),
    };
}

/**
 * The mesh that holds the geometry of a mesh: the mesh itself, or for a linked mesh the end of
 * its chain of parents. A parent that is missing or not a mesh ends the chain.
 *
 * @example
 * const source = meshSource(lookup, mesh);
 * computeWorldVertices(source, state.world, bone, deform, deformLength, positions);
 */
export function meshSource(lookup: AttachmentLookup, mesh: MeshAttachmentData): MeshAttachmentData {
    let source = mesh;

    // a chain longer than this is a loop in a damaged file
    for (let guard = 0; guard < 64 && source.parent !== null; guard++) {
        const parent = lookup.resolve(source.parent);

        if (parent === undefined || parent.type !== 'mesh') break;
        source = parent;
    }

    return source;
}
