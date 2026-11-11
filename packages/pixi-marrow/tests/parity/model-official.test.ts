import * as core41 from 'spine-core-4.1';
import * as core42 from 'spine-core-4.2';
import * as core43 from 'spine-core-4.3';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
    AttachmentData,
    AttachmentRef,
    ConstraintData,
    SkeletonModel,
    TimelineData,
    TimelineKind,
    VertexData,
} from '../../src/core';
import { differences } from './compare';
import { listFixtures, readFixture } from './fixtures';
import { officialModel } from './model-official';
import { timelineKind } from './model-shared';
import { loadOfficial, type OfficialRig, type RigFiles } from './official';

/*
 * Sanity checks for the reference side of model parity. They test the converter from official
 * objects against the playback rig of official.ts and against the rules of the model itself.
 */

/** Numbers per key in `frames`, the same in every official version. */
const ENTRIES: Record<TimelineKind, number> = {
    rotate: 2,
    translate: 3,
    translateX: 2,
    translateY: 2,
    scale: 3,
    scaleX: 2,
    scaleY: 2,
    shear: 3,
    shearX: 2,
    shearY: 2,
    inherit: 2,
    rgba: 5,
    rgb: 4,
    alpha: 2,
    rgba2: 8,
    rgb2: 7,
    attachment: 1,
    deform: 1,
    sequence: 3,
    event: 1,
    drawOrder: 1,
    drawOrderFolder: 1,
    ikConstraint: 6,
    transformConstraint: 7,
    pathConstraintPosition: 2,
    pathConstraintSpacing: 2,
    pathConstraintMix: 4,
    physicsConstraintInertia: 2,
    physicsConstraintStrength: 2,
    physicsConstraintDamping: 2,
    physicsConstraintMass: 2,
    physicsConstraintWind: 2,
    physicsConstraintGravity: 2,
    physicsConstraintMix: 2,
    physicsConstraintReset: 1,
    slider: 2,
    sliderMix: 2,
};
const SLOT_KINDS = new Set<TimelineKind>(['rgba', 'rgb', 'alpha', 'rgba2', 'rgb2', 'attachment', 'deform', 'sequence']);
const NO_TARGET = new Set<TimelineKind>(['event', 'drawOrder', 'drawOrderFolder']);
/** The official classes of these kinds do not extend CurveTimeline. */
const UNCURVED = new Set<TimelineKind>([...NO_TARGET, 'attachment', 'sequence', 'inherit', 'physicsConstraintReset']);
/** The floats of one bezier curve in an official `curves` array. */
const BEZIER_SIZE = 18;
/** The order of the constraint kinds in the one list of a 4.1 or 4.2 model. */
const LEGACY_ORDER: ConstraintData['type'][] = ['ik', 'transform', 'path', 'physics'];

const inRange = (index: number, count: number): boolean => Number.isInteger(index) && index >= 0 && index < count;

/** The skin entry a reference points at, or undefined. */
function resolve(model: SkeletonModel, ref: AttachmentRef): AttachmentData | undefined {
    return model.skins[ref.skin]?.attachments.find((entry) => entry.slot === ref.slot && entry.name === ref.name)
        ?.attachment;
}

/** The vertices of an attachment. A linked mesh has them on its parent. */
function geometry(model: SkeletonModel, attachment: AttachmentData | undefined): VertexData | undefined {
    if (attachment === undefined || attachment.type === 'region' || attachment.type === 'point') return undefined;
    if (attachment.type === 'mesh' && attachment.parent) return geometry(model, resolve(model, attachment.parent));

    return attachment;
}

/** The constraint type the target of a timeline kind must have, or undefined for other kinds. */
function constraintType(kind: TimelineKind): ConstraintData['type'] | undefined {
    if (kind === 'ikConstraint') return 'ik';
    if (kind === 'transformConstraint') return 'transform';
    if (kind.startsWith('pathConstraint')) return 'path';
    if (kind.startsWith('physicsConstraint')) return 'physics';

    return kind.startsWith('slider') ? 'slider' : undefined;
}

function tableProblems(model: SkeletonModel): string[] {
    const { bones, slots } = model;
    const problems: string[] = [];
    const lengths: [string, number, number][] = [
        ['bones.names', bones.names.length, bones.count],
        ['bones.parents', bones.parents.length, bones.count],
        ['bones.setup', bones.setup.length, bones.count * 7],
        ['bones.lengths', bones.lengths.length, bones.count],
        ['bones.inherit', bones.inherit.length, bones.count],
        ['bones.skinRequired', bones.skinRequired.length, bones.count],
        ['slots.names', slots.names.length, slots.count],
        ['slots.bones', slots.bones.length, slots.count],
        ['slots.colors', slots.colors.length, slots.count * 4],
        ['slots.darkColors', slots.darkColors.length, slots.count * 3],
        ['slots.hasDark', slots.hasDark.length, slots.count],
        ['slots.attachments', slots.attachments.length, slots.count],
        ['slots.blendModes', slots.blendModes.length, slots.count],
        ['slots.visible', slots.visible.length, slots.count],
    ];

    for (const [name, actual, expected] of lengths) {
        if (actual !== expected) problems.push(`${name} has length ${actual}, expected ${expected}`);
    }
    bones.parents.forEach((parent, i) => {
        if (parent < -1 || parent >= i) problems.push(`bone ${i} has parent ${parent}`);
    });
    slots.bones.forEach((bone, i) => {
        if (!inRange(bone, bones.count)) problems.push(`slot ${i} has bone ${bone}`);
    });
    if (bones.inherit.some((mode) => mode > 4)) problems.push('a bone has an unknown inherit mode');
    if (slots.blendModes.some((mode) => mode > 3)) problems.push('a slot has an unknown blend mode');

    return problems;
}

/** Every bone index a constraint holds. */
function constraintBones(constraint: ConstraintData): number[] {
    if (constraint.type === 'physics') return [constraint.bone];
    if (constraint.type === 'slider') return constraint.bone === -1 ? [] : [constraint.bone];
    if (constraint.type === 'ik') return [...constraint.bones, constraint.target];
    if (constraint.type === 'transform') return [...constraint.bones, constraint.source];

    return [...constraint.bones];
}

function constraintProblems(model: SkeletonModel): string[] {
    const problems: string[] = [];
    const legacy = model.version !== '4.3';
    const ranks = model.constraints.map((constraint) => LEGACY_ORDER.indexOf(constraint.type));

    model.constraints.forEach((constraint, i) => {
        if (constraintBones(constraint).some((bone) => !inRange(bone, model.bones.count))) {
            problems.push(`constraint ${i} has a bad bone`);
        }
        if (constraint.type === 'path' && !inRange(constraint.slot, model.slots.count)) {
            problems.push(`constraint ${i} has slot ${constraint.slot}`);
        }
        if (constraint.type === 'slider' && !inRange(constraint.animation, model.animations.length)) {
            problems.push(`constraint ${i} has animation ${constraint.animation}`);
        }
        if ((constraint.order !== undefined) !== legacy) problems.push(`constraint ${i} has order ${constraint.order}`);
        if (legacy && (ranks[i] ?? 0) < (ranks[i - 1] ?? 0)) {
            problems.push(`constraint ${i} of type ${constraint.type} is out of order`);
        }
    });

    return problems;
}

function versionFieldProblems(model: SkeletonModel): string[] {
    const problems: string[] = [];
    const legacy = model.version !== '4.3';
    const only = (i: number, field: string, value: unknown, expected: boolean): void => {
        if ((value !== undefined) !== expected) problems.push(`constraint ${i} has ${field} ${String(value)}`);
    };

    model.constraints.forEach((constraint, i) => {
        if (constraint.type === 'ik') {
            only(i, 'uniform', constraint.uniform, legacy);
            only(i, 'scaleYMode', constraint.scaleYMode, !legacy);
        }
        if (constraint.type === 'transform') {
            only(i, 'relative', constraint.relative, legacy);
            only(i, 'local', constraint.local, legacy);
            only(i, 'localSource', constraint.localSource, !legacy);
            only(i, 'localTarget', constraint.localTarget, !legacy);
            only(i, 'additive', constraint.additive, !legacy);
            only(i, 'clamp', constraint.clamp, !legacy);
            only(i, 'properties', constraint.properties, !legacy);
            if (constraint.offsets.length !== 6)
                problems.push(`constraint ${i} has ${constraint.offsets.length} offsets`);
        }
        if (constraint.type === 'physics') only(i, 'scaleYMode', constraint.scaleYMode, model.version === '4.3');
        if (constraint.type === 'physics' && model.version === '4.1') problems.push('a 4.1 model has physics');
        if (constraint.type === 'slider' && legacy) problems.push(`a ${model.version} model has a slider`);
    });
    if (model.version === '4.1' && model.referenceScale !== 100) problems.push('a 4.1 reference scale is not 100');
    if (model.version === '4.1' && model.slots.visible.some((flag) => flag !== 1))
        problems.push('a 4.1 slot is hidden');

    return problems;
}

function meshProblems(model: SkeletonModel, attachment: AttachmentData, at: string): string[] {
    if (attachment.type !== 'mesh') return [];
    const problems: string[] = [];
    const { parent, timelineAttachment } = attachment;

    if (parent) {
        const sizes = [attachment.vertices.length, attachment.regionUVs.length, attachment.triangles.length];

        if (resolve(model, parent)?.type !== 'mesh') problems.push(`${at}: the parent is not a mesh in a skin`);
        if (sizes.some((size) => size !== 0) || attachment.bones !== null) problems.push(`${at}: linked with arrays`);
        if (attachment.worldVerticesLength !== 0 || attachment.hullLength !== 0) problems.push(`${at}: linked lengths`);
    } else {
        if (attachment.regionUVs.length !== attachment.worldVerticesLength) problems.push(`${at}: UV count`);
        if (attachment.triangles.length % 3 !== 0) problems.push(`${at}: triangle count`);
        if (attachment.triangles.some((index) => index * 2 >= attachment.worldVerticesLength)) {
            problems.push(`${at}: a triangle points past the vertices`);
        }
    }
    if (timelineAttachment && resolve(model, timelineAttachment) === undefined) {
        problems.push(`${at}: the timeline attachment is not in a skin`);
    }

    return problems;
}

/** Checks the official vertex encoding: plain x, y pairs, or bone counts with x, y, weight triples. */
function vertexProblems(model: SkeletonModel, attachment: AttachmentData, at: string): string[] {
    const data = attachment.type === 'mesh' && attachment.parent ? undefined : geometry(model, attachment);

    if (data === undefined) return [];
    if (data.bones === null) return data.vertices.length === data.worldVerticesLength ? [] : [`${at}: vertex count`];
    let vertices = 0;
    let weights = 0;

    for (let i = 0; i < data.bones.length; i += (data.bones[i] ?? 0) + 1) {
        vertices++;
        weights += data.bones[i] ?? 0;
    }
    if (vertices * 2 !== data.worldVerticesLength) return [`${at}: weighted vertex count`];
    if (data.bones.some((bone) => bone >= model.bones.count)) return [`${at}: a weight has a bad bone`];

    return weights * 3 === data.vertices.length ? [] : [`${at}: weight count`];
}

/** Timeline slots exist in 4.3 only. They are left out when there are none, and they hold slot indices. */
function timelineSlotProblems(model: SkeletonModel, attachment: AttachmentData, at: string): string[] {
    const slots = attachment.type === 'mesh' ? attachment.timelineSlots : undefined;

    if (slots === undefined) return [];
    if (model.version !== '4.3' || slots.length === 0) return [`${at}: timeline slots are set`];

    return slots.every((slot) => inRange(slot, model.slots.count)) ? [] : [`${at}: a timeline slot is not a slot`];
}

function skinProblems(model: SkeletonModel): string[] {
    const problems: string[] = [];

    model.skins.forEach((skin, s) => {
        if (skin.bones.some((bone) => !inRange(bone, model.bones.count))) problems.push(`skin ${s} has a bad bone`);
        if (skin.constraints.some((index) => !inRange(index, model.constraints.length))) {
            problems.push(`skin ${s} has a bad constraint`);
        }
        skin.attachments.forEach((entry, i) => {
            const at = `skin ${s} slot ${entry.slot} ${entry.name}`;
            const before = skin.attachments[i - 1];
            const sorted =
                before === undefined ||
                before.slot < entry.slot ||
                (before.slot === entry.slot && before.name < entry.name);

            if (!sorted) problems.push(`${at}: not sorted`);
            if (!inRange(entry.slot, model.slots.count)) problems.push(`${at}: bad slot`);
            if (entry.attachment.type === 'clipping' && entry.attachment.endSlot !== -1) {
                if (!inRange(entry.attachment.endSlot, model.slots.count)) problems.push(`${at}: bad end slot`);
            }
            problems.push(...meshProblems(model, entry.attachment, at), ...vertexProblems(model, entry.attachment, at));
            problems.push(...timelineSlotProblems(model, entry.attachment, at));
        });
    });

    return problems;
}

function targetProblems(model: SkeletonModel, { kind, target }: TimelineData): string[] {
    const type = constraintType(kind);

    if (NO_TARGET.has(kind)) return target === -1 ? [] : [`target ${target}`];
    if (type === undefined) {
        const count = SLOT_KINDS.has(kind) ? model.slots.count : model.bones.count;

        return inRange(target, count) ? [] : [`target ${target}`];
    }
    // an official physics timeline with index -1 applies to every physics constraint
    if (type === 'physics' && target === -1) return [];
    const found = model.constraints[target]?.type;

    return found === type ? [] : [`target ${target} is ${found}, expected ${type}`];
}

function isPermutation(order: Int16Array, count: number): boolean {
    return order.length === count && new Set(order).size === count && order.every((slot) => inRange(slot, count));
}

function payloadProblems(model: SkeletonModel, timeline: TimelineData): string[] {
    const { kind, frames } = timeline;
    const problems: string[] = [];
    const keys = frames.length / ENTRIES[kind];
    const sized = (name: string, list: readonly unknown[] | undefined, expected: boolean): void => {
        if (expected ? list?.length !== keys : list !== undefined) problems.push(`${name} has length ${list?.length}`);
    };
    const refers = kind === 'deform' || kind === 'sequence';
    const target = timeline.attachment && resolve(model, timeline.attachment);
    const shape = geometry(model, target);
    const deformLength = shape?.bones ? (shape.vertices.length / 3) * 2 : shape?.vertices.length;
    const orderCount = kind === 'drawOrderFolder' ? timeline.folderSlots?.length : model.slots.count;

    sized('attachmentNames', timeline.attachmentNames, kind === 'attachment');
    sized('vertices', timeline.vertices, kind === 'deform');
    sized('events', timeline.events, kind === 'event');
    sized('drawOrders', timeline.drawOrders, kind === 'drawOrder' || kind === 'drawOrderFolder');
    if ((timeline.folderSlots !== undefined) !== (kind === 'drawOrderFolder')) problems.push('folderSlots');
    if ((timeline.attachment !== undefined) !== refers) problems.push('attachment');
    if (refers && target === undefined) problems.push('the attachment is not in a skin');
    if (kind === 'sequence' && target?.type !== 'region' && target?.type !== 'mesh') problems.push('sequence target');
    if (timeline.vertices?.some((key) => key.length !== deformLength)) problems.push('deform length');
    if (timeline.drawOrders?.some((order) => order && !isPermutation(order, orderCount ?? 0))) {
        problems.push('a draw order is not a permutation');
    }
    timeline.events?.forEach((key, i) => {
        if (key.time !== frames[i] || !inRange(key.event, model.events.length)) problems.push(`event key ${i}`);
    });

    return problems;
}

function timelineProblems(model: SkeletonModel, timeline: TimelineData): string[] {
    const { kind, frames, curves } = timeline;
    const entries = ENTRIES[kind];
    const problems = [...targetProblems(model, timeline), ...payloadProblems(model, timeline)];

    if (frames.length % entries !== 0) problems.push(`frames has length ${frames.length}`);
    if (UNCURVED.has(kind) !== (curves === null)) problems.push(`curves is ${curves === null ? 'null' : 'set'}`);
    if (curves && (curves.length - frames.length / entries) % BEZIER_SIZE !== 0) {
        problems.push(`curves has length ${curves.length}`);
    }
    for (let i = entries; i < frames.length; i += entries) {
        if ((frames[i] ?? 0) < (frames[i - entries] ?? 0)) problems.push(`key ${i / entries} goes back in time`);
    }

    return problems;
}

function animationProblems(model: SkeletonModel): string[] {
    return model.animations.flatMap((animation) =>
        animation.timelines.flatMap((timeline, i) =>
            timelineProblems(model, timeline).map((problem) => `${animation.name} ${i} ${timeline.kind}: ${problem}`),
        ),
    );
}

/** The model kinds of the concrete timeline classes an official core exports. Base classes have no kind. */
function exportedKinds(core: Record<string, unknown>): TimelineKind[] {
    const bases = /^(Curve|BoneTimeline\d|SlotCurve|ConstraintTimeline\d|PhysicsConstraintTimeline$|Timeline$)/;

    return Object.entries(core).flatMap(([name, value]) =>
        typeof value === 'function' && /^[A-Z]\w*Timeline$/.test(name) && !bases.test(name)
            ? [timelineKind(value.prototype)]
            : [],
    );
}

describe('the official timeline classes', () => {
    const all = Object.keys(ENTRIES).sort();
    const without = (...missing: string[]): string[] => all.filter((kind) => !missing.some((m) => kind.startsWith(m)));

    it('have a model kind each, in every version', () => {
        const legacy = ['slider', 'drawOrderFolder'];

        expect(exportedKinds(core41).sort()).toEqual(without(...legacy, 'physicsConstraint', 'inherit'));
        expect(exportedKinds(core42).sort()).toEqual(without(...legacy));
        expect(exportedKinds(core43).sort()).toEqual(all);
    });
});

/** A hand-written 4.3 skeleton with the slots a, b and c on one bone and the given default skin. */
function synthetic(attachments: object, more: object = {}): RigFiles {
    const slots = ['a', 'b', 'c'].map((name) => ({ name, bone: 'root' }));
    const skins = [{ name: 'default', attachments }];

    return {
        skeleton: JSON.stringify({ skeleton: { spine: '4.3.00' }, bones: [{ name: 'root' }], slots, skins, ...more }),
        atlas: ['page.png', 'size: 8,8', 'filter: Linear,Linear', 'm', 'bounds: 0,0,4,4', ''].join('\n'),
    };
}

const TRIANGLE = { path: 'm', uvs: [0, 0, 1, 0, 1, 1], triangles: [0, 1, 2], vertices: [0, 0, 4, 0, 4, 4], hull: 3 };
/** A linked mesh that takes its geometry from the attachment `source` of slot a. */
const linked = (source: string, more: object = {}) => ({ type: 'linkedmesh', path: 'm', source, slot: 'a', ...more });

// No official example has timeline slots, so these skeletons are written by hand.
describe('the timeline slots of a 4.3 attachment', () => {
    it('are on the source mesh of linked meshes that inherit its timelines from other slots', () => {
        const own = linked('m', { timelines: false });
        const skin = { a: { m: { type: 'mesh', ...TRIANGLE } }, b: { l: linked('m') }, c: { k: own, l: linked('m') } };
        const model = officialModel('4.3', synthetic(skin));
        const meshes = model.skins.flatMap(({ attachments }) =>
            attachments.flatMap(({ attachment }) => (attachment.type === 'mesh' ? [attachment] : [])),
        );

        expect(meshes.map((mesh) => mesh.timelineSlots)).toEqual([
            Int16Array.of(1, 2),
            undefined,
            undefined,
            undefined,
        ]);
        expect(skinProblems(model)).toEqual([]);
        meshes.forEach((mesh) => {
            mesh.timelineSlots = Int16Array.of(model.slots.count);
        });
        expect(skinProblems(model)).toHaveLength(meshes.length);
    });

    it('throw on an attachment that is no mesh, which the model cannot hold', () => {
        // The official JSON loader takes any attachment as the source of a linked mesh.
        const region = { path: 'm', width: 4, height: 4 };
        const files = synthetic({ a: { r: region }, b: { l: linked('r', { sequence: { count: 0 } }) } });

        expect(() => officialModel('4.3', files)).toThrow('timeline slots');
    });
});

describe('the 64-bit setup values of a JSON skeleton', () => {
    it('are the official numbers, not rounded to 32 bits', () => {
        // 0.1 and 0.2 are no 32-bit floats. The color byte 33 is 51 / 255, which is 0.2.
        const bones = [{ name: 'root', x: 0.1, length: 0.1 }];
        const slots = [{ name: 'a', bone: 'root', color: '33333333', dark: '333333' }];
        const constraints = [{ type: 'transform', name: 't', bones: ['root'], source: 'root', x: 0.1 }];
        const path = { type: 'path', vertexCount: 3, vertices: [0, 0, 1, 1, 2, 2], lengths: [0.1] };
        const skin = { a: { p: path, r: { path: 'm', width: 4, height: 4, color: '33333333' } } };
        const model = officialModel('4.3', synthetic(skin, { bones, slots, constraints }));
        const fifths = Float64Array.of(0.2, 0.2, 0.2, 0.2);
        const attachments = model.skins.flatMap((entries) => entries.attachments.map((entry) => entry.attachment));

        expect(model.bones.setup[0]).toBe(0.1);
        expect(model.bones.lengths).toEqual(Float64Array.of(0.1));
        expect(model.slots.colors).toEqual(fifths);
        expect(model.slots.darkColors).toEqual(fifths.slice(1));
        expect(model.constraints).toMatchObject([{ offsets: Float64Array.of(0, 0.1, 0, 0, 0, 0) }]);
        expect(attachments).toMatchObject([{ lengths: Float64Array.of(0.1) }, { color: fifths }]);
    });
});

describe.each(listFixtures())('$id', (fixture) => {
    let model: SkeletonModel;
    let rig: OfficialRig;

    beforeAll(() => {
        const files = readFixture(fixture);

        model = officialModel(fixture.version, files);
        rig = loadOfficial(fixture.version, files);
    });

    it('has the names and counts of the official rig', () => {
        expect(model.version).toBe(fixture.version);
        expect(model.editorVersion.startsWith(fixture.version)).toBe(true);
        expect(model.bones.names).toEqual(rig.boneNames);
        expect(model.slots.names).toEqual(rig.slotNames);
        expect(model.skins.map((skin) => skin.name)).toEqual(rig.skinNames);
        expect(model.animations.map(({ name, duration }) => ({ name, duration }))).toEqual(rig.animations);
        expect(model.constraints.length).toBe(rig.constraintCount);
    });

    it('has consistent bone, slot and constraint tables', () => {
        expect(model.bones.parents[0]).toBe(-1);
        expect(tableProblems(model)).toEqual([]);
        expect(constraintProblems(model)).toEqual([]);
        expect(versionFieldProblems(model)).toEqual([]);
    });

    it('has sorted skins whose references resolve', () => {
        expect(skinProblems(model)).toEqual([]);
    });

    it('has timelines in the official layout', () => {
        expect(animationProblems(model)).toEqual([]);
    });

    it('converts to the same model twice', () => {
        expect(differences(officialModel(fixture.version, readFixture(fixture)), model)).toEqual([]);
    });
});
