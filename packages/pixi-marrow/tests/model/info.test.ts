import { describe, expect, it } from 'vitest';
import type { MeshAttachmentData, RegionAttachmentData } from '../../src/model/attachments';
import { describeSkeleton } from '../../src/model/info';
import type { SkeletonModel } from '../../src/model/model';
import type { TimelineData, TimelineKind } from '../../src/model/timelines';

const WHITE = Float64Array.of(1, 1, 1, 1);

const region = (name: string): RegionAttachmentData => ({
    type: 'region',
    name,
    path: name,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    width: 8,
    height: 8,
    color: WHITE,
    sequence: null,
});

const mesh = (name: string, overrides: Partial<MeshAttachmentData> = {}): MeshAttachmentData => ({
    type: 'mesh',
    name,
    path: name,
    color: WHITE,
    width: 0,
    height: 0,
    regionUVs: new Float32Array(8),
    triangles: Uint16Array.of(0, 1, 2, 2, 3, 0),
    hullLength: 8,
    vertices: new Float32Array(8),
    bones: null,
    worldVerticesLength: 8,
    parent: null,
    timelineAttachment: null,
    sequence: null,
    ...overrides,
});

const timeline = (kind: TimelineKind): TimelineData => ({ kind, target: 0, frames: Float32Array.of(0), curves: null });

/** A skeleton with two bones, three slots and no features. Tests add what they need. */
function model(overrides: Partial<SkeletonModel> = {}): SkeletonModel {
    return {
        version: '4.2',
        editorVersion: '4.2.22',
        hash: null,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        referenceScale: 100,
        bones: {
            count: 2,
            names: ['root', 'arm'],
            parents: Int16Array.of(-1, 0),
            setup: new Float64Array(14),
            lengths: new Float64Array(2),
            inherit: new Uint8Array(2),
            skinRequired: new Uint8Array(2),
        },
        slots: {
            count: 3,
            names: ['body', 'glow', 'hand'],
            bones: Int16Array.of(0, 0, 1),
            colors: new Float64Array(12).fill(1),
            darkColors: new Float64Array(9),
            hasDark: new Uint8Array(3),
            attachments: ['body', null, 'hand'],
            blendModes: new Uint8Array(3),
            visible: new Uint8Array(3).fill(1),
        },
        events: [],
        constraints: [],
        skins: [
            {
                name: 'default',
                bones: new Int16Array(0),
                constraints: new Int16Array(0),
                attachments: [
                    { slot: 0, name: 'body', attachment: region('body') },
                    { slot: 2, name: 'hand', attachment: region('hand') },
                ],
            },
        ],
        animations: [],
        ...overrides,
    };
}

describe('describeSkeleton', () => {
    it('lists names and counts of a plain skeleton, with no features', () => {
        const info = describeSkeleton(model());

        expect(info).toMatchObject({
            version: '4.2',
            editorVersion: '4.2.22',
            bones: ['root', 'arm'],
            slots: ['body', 'glow', 'hand'],
            skins: ['default'],
            events: [],
            constraints: [],
            animations: [],
            features: [],
        });
        expect(info.counts).toEqual({
            bones: 2,
            slots: 3,
            skins: 1,
            constraints: 0,
            animations: 0,
            attachments: 2,
            regions: 2,
            meshes: 0,
            meshVertices: 0,
            maxBonesPerVertex: 0,
        });
        expect(JSON.parse(JSON.stringify(info))).toEqual(info);
    });

    it('reports meshes, weights and linked meshes, and counts a linked mesh with its parent vertices', () => {
        const weighted = mesh('cape', {
            // two vertices: one moved by two bones, one by three
            bones: Int16Array.of(2, 0, 1, 3, 0, 1, 1),
            vertices: new Float32Array(15),
            worldVerticesLength: 4,
        });
        const linked = mesh('cape-alt', {
            parent: { skin: 0, slot: 0, name: 'cape' },
            vertices: new Float32Array(0),
            regionUVs: new Float32Array(0),
            triangles: new Uint16Array(0),
            worldVerticesLength: 0,
            hullLength: 0,
        });
        const info = describeSkeleton(
            model({
                skins: [
                    {
                        name: 'default',
                        bones: new Int16Array(0),
                        constraints: new Int16Array(0),
                        attachments: [
                            { slot: 0, name: 'cape', attachment: weighted },
                            { slot: 0, name: 'plain', attachment: mesh('plain') },
                        ],
                    },
                    {
                        name: 'alt',
                        bones: Int16Array.of(1),
                        constraints: new Int16Array(0),
                        attachments: [{ slot: 0, name: 'cape', attachment: linked }],
                    },
                ],
            }),
        );

        expect(info.features).toEqual(['meshes', 'weights', 'linkedMeshes', 'skinBones']);
        expect(info.counts).toMatchObject({ attachments: 3, meshes: 3, meshVertices: 2 + 4 + 2, maxBonesPerVertex: 3 });
    });

    it('does not follow a linked mesh whose parent is missing or loops', () => {
        const orphan = mesh('orphan', { parent: { skin: 0, slot: 2, name: 'nowhere' }, worldVerticesLength: 0 });
        const loop = mesh('loop', { parent: { skin: 0, slot: 1, name: 'loop' }, worldVerticesLength: 6 });
        const skins = [
            {
                name: 'default',
                bones: new Int16Array(0),
                constraints: new Int16Array(0),
                attachments: [
                    { slot: 0, name: 'orphan', attachment: orphan },
                    { slot: 1, name: 'loop', attachment: loop },
                ],
            },
        ];

        expect(describeSkeleton(model({ skins })).counts.meshVertices).toBe(3);
    });

    it('reports blend modes, dark tint, sequences, clipping, paths and constraints', () => {
        const base = model();
        const info = describeSkeleton(
            model({
                slots: { ...base.slots, blendModes: Uint8Array.of(1, 2, 3), hasDark: Uint8Array.of(0, 1, 0) },
                constraints: [
                    {
                        type: 'ik',
                        name: 'aim',
                        skinRequired: false,
                        bones: Int16Array.of(1),
                        target: 0,
                        mix: 1,
                        softness: 0,
                        bendDirection: 1,
                        compress: false,
                        stretch: false,
                    },
                ],
                skins: [
                    {
                        name: 'default',
                        bones: new Int16Array(0),
                        constraints: new Int16Array(0),
                        attachments: [
                            {
                                slot: 0,
                                name: 'spin',
                                attachment: {
                                    ...region('spin'),
                                    sequence: { count: 4, start: 1, digits: 2, setupIndex: 0 },
                                },
                            },
                            {
                                slot: 1,
                                name: 'clip',
                                attachment: {
                                    type: 'clipping',
                                    name: 'clip',
                                    endSlot: 2,
                                    convex: false,
                                    inverse: false,
                                    vertices: new Float32Array(6),
                                    bones: null,
                                    worldVerticesLength: 6,
                                },
                            },
                            {
                                slot: 2,
                                name: 'rail',
                                attachment: {
                                    type: 'path',
                                    name: 'rail',
                                    closed: false,
                                    constantSpeed: true,
                                    lengths: new Float64Array(1),
                                    vertices: new Float32Array(12),
                                    bones: null,
                                    worldVerticesLength: 12,
                                },
                            },
                        ],
                    },
                ],
            }),
        );

        expect(info.features).toEqual([
            'clipping',
            'paths',
            'sequences',
            'darkTint',
            'additiveBlend',
            'multiplyBlend',
            'screenBlend',
            'ik',
        ]);
        expect(info.constraints).toEqual([{ name: 'aim', type: 'ik' }]);
    });

    it('lists what each animation keys', () => {
        const kinds: TimelineKind[] = ['rotate', 'rgba2', 'attachment', 'deform', 'sequence', 'drawOrderFolder'];
        const more: TimelineKind[] = ['event', 'inherit', 'sliderMix', 'physicsConstraintReset'];
        const info = describeSkeleton(
            model({
                animations: [
                    { name: 'all', duration: 2, timelines: [...kinds, ...more].map(timeline) },
                    { name: 'walk', duration: 1, timelines: [timeline('translateX'), timeline('alpha')] },
                    { name: 'empty', duration: 0, timelines: [] },
                ],
            }),
        );

        expect(info.animations).toEqual([
            {
                name: 'all',
                duration: 2,
                timelines: 10,
                features: [
                    'bones',
                    'colors',
                    'attachments',
                    'deform',
                    'sequences',
                    'drawOrder',
                    'events',
                    'inherit',
                    'constraints',
                    'physics',
                ],
            },
            { name: 'walk', duration: 1, timelines: 2, features: ['bones', 'colors'] },
            { name: 'empty', duration: 0, timelines: 0, features: [] },
        ]);
    });
});
