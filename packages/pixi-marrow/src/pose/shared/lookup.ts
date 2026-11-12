import type { AttachmentData, AttachmentRef, MeshAttachmentData } from '../../model/attachments';
import type { SkeletonModel } from '../../model/model';

/** Finds attachments of a model by skin, slot and name. Built once per model. */
export interface AttachmentLookup {
    /** The index of the default skin: the last skin named `default`. -1 when there is none. */
    readonly defaultSkin: number;
    /** The attachment a skin stores under a slot and a name. */
    get(skin: number, slot: number, name: string): AttachmentData | undefined;
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

function buildLookup(model: SkeletonModel): AttachmentLookup {
    // per skin, per slot: name to attachment
    const tables = model.skins.map((skin) => {
        const slots: (Map<string, AttachmentData> | undefined)[] = [];

        for (const entry of skin.attachments) {
            let names = slots[entry.slot];

            if (names === undefined) {
                names = new Map();
                slots[entry.slot] = names;
            }
            names.set(entry.name, entry.attachment);
        }

        return slots;
    });
    const defaultSkin = model.skins.findLastIndex((skin) => skin.name === 'default');
    const get = (skin: number, slot: number, name: string): AttachmentData | undefined =>
        tables[skin]?.[slot]?.get(name);

    return {
        defaultSkin,
        get,
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
