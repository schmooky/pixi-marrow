import { MarrowError } from '../../base/errors';
import type { AttachmentData, VertexData } from '../../model/attachments';
import type { ConstraintData } from '../../model/constraints';
import type { EventData } from '../../model/model';

const EXPORT_FIX = 'Export the skeleton again from Spine 4.3.';

/** Builds the error for data this importer cannot read. */
export function invalid(message: string): MarrowError {
    return new MarrowError('invalid-data', message, { fix: EXPORT_FIX });
}

/** A name the file must hold. Throws when it is missing or empty. */
export function requireName(name: string | undefined, what: string): string {
    if (typeof name !== 'string' || name === '') throw invalid(`${what} has no name.`);

    return name;
}

/** A list the file must hold. Throws when it is missing. */
export function requireList<T>(list: readonly T[] | undefined, what: string): readonly T[] {
    if (!Array.isArray(list)) throw invalid(`${what} is missing or is not a list.`);

    return list;
}

/**
 * Checks an enum name from the file against the names that exist. The first letter can be in
 * either case, as in the official `Utils.enumValue`.
 */
export function enumName<T extends string>(names: readonly T[], value: string, what: string): T {
    const wanted = value.charAt(0).toLowerCase() + value.slice(1);
    const found = names.find((name) => name === wanted);

    if (found === undefined) {
        throw new MarrowError('invalid-data', `${what} has the unknown value "${value}".`, {
            fix: 'Use one of the valid values, or export the skeleton again from Spine 4.3.',
            validNames: names,
        });
    }

    return found;
}

/** The position of an enum name from the file in the list of names. Throws when it is not one of them. */
export function enumIndex(names: readonly string[], value: string, what: string): number {
    return names.indexOf(enumName(names, value, what));
}

/** Values by name. A name finds the first value stored under it, as the official lookups do. */
export class NameMap<T> {
    private readonly kind: string;
    private readonly values: Map<string, T> = new Map();

    /** @param kind what the names stand for, for example `bone` */
    constructor(kind: string) {
        this.kind = kind;
    }

    /** Stores a value under a name. A name that is taken keeps its first value. */
    add(name: string, value: T): void {
        if (!this.values.has(name)) this.values.set(name, value);
    }

    /**
     * The value of a name the file refers to. Throws when nothing has that name.
     *
     * @param user what refers to the name, as the start of a sentence
     */
    require(name: string | undefined, user: string): T {
        // the official lookups reject an empty name
        const value = name ? this.values.get(name) : undefined;

        if (value === undefined) {
            throw new MarrowError(
                'invalid-data',
                `${user} refers to the ${this.kind} "${String(name)}", which does not exist.`,
                {
                    fix: `Use the name of an existing ${this.kind}, or export the skeleton again from Spine 4.3.`,
                    validNames: [...this.values.keys()],
                },
            );
        }

        return value;
    }
}

/** The attachments of one skin, by slot index, then by the name the skin stores them under. */
export type SkinAttachments = Map<number, Map<string, AttachmentData>>;

/** A skin that was read: its index and its attachments. */
export interface SkinEntry {
    index: number;
    attachments: SkinAttachments;
}

/** An event that was read: its index and its default values. */
export interface EventEntry {
    index: number;
    data: EventData;
}

/** What the importer has read so far, for the parts of the file that refer to it by name. */
export class ImportContext {
    readonly bones: NameMap<number> = new NameMap('bone');
    readonly slots: NameMap<number> = new NameMap('slot');
    readonly skins: NameMap<SkinEntry> = new NameMap('skin');
    readonly events: NameMap<EventEntry> = new NameMap('event');
    readonly animations: NameMap<number> = new NameMap('animation');
    /** Every constraint, in file order. */
    readonly constraints: ConstraintData[] = [];
    /** The vertices a linked mesh took from its source. The official parser copies them at load. */
    readonly geometry: Map<AttachmentData, VertexData> = new Map();
    boneCount: number = 0;
    slotCount: number = 0;
    private readonly constraintNames: Record<ConstraintData['type'], NameMap<number>> = {
        ik: new NameMap('IK constraint'),
        transform: new NameMap('transform constraint'),
        path: new NameMap('path constraint'),
        physics: new NameMap('physics constraint'),
        slider: new NameMap('slider'),
    };

    /** Appends a constraint to the one constraint list. */
    addConstraint(data: ConstraintData): void {
        this.constraintNames[data.type].add(data.name, this.constraints.length);
        this.constraints.push(data);
    }

    /**
     * The index in the constraint list of the first constraint with this type and name.
     * Throws when there is none.
     */
    constraint(type: ConstraintData['type'], name: string | undefined, user: string): number {
        return this.constraintNames[type].require(name, user);
    }
}
