import type { AttachmentRef, SpineVersion } from '../../src/core';
import { loadGeometry41 } from './geometry-41';
import { loadGeometry42 } from './geometry-42';
import { loadGeometry43 } from './geometry-43';
import type { RigFiles } from './official';

/*
 * What the geometry parity test reads from an official core. One file per version fills these
 * shapes from its own classes. The numbers are copies, in the array type the official object holds.
 */

/** What the official runtime holds for the region a region or mesh attachment shows. */
export interface OfficialTexture {
    /** The position of the texture region in the official atlas. */
    region: number;
    /** The texture coordinates: 8 for a region attachment, two per vertex for a mesh. */
    uvs: Float32Array | Float64Array;
    /** Region attachment only. The 8 vertex offsets: 32-bit in 4.1 and 4.2, 64-bit in 4.3. */
    offsets: Float32Array | Float64Array | null;
}

/** What the official loader holds for one sequence index of a region or mesh attachment. */
export interface OfficialFrame extends OfficialTexture {
    /**
     * Mesh only. The official UV math run again on the region UVs rounded to 32 bits, which is how
     * the model stores them. The official JSON reader keeps them as 64-bit numbers.
     */
    roundedUvs: Float32Array | Float64Array | null;
}

/** A region or mesh attachment of a skin, with one frame per sequence index. */
export interface OfficialDrawable {
    ref: AttachmentRef;
    type: 'region' | 'mesh';
    /** Mesh only. The region UVs as the official loader holds them: 64-bit numbers for a JSON file. */
    regionUVs: Float64Array | null;
    frames: OfficialFrame[];
}

/** An attachment on a slot at the current frame of a playback. */
export interface OfficialShown {
    slot: number;
    /** The index of the slot's bone. */
    bone: number;
    /** The skin entry that stores the attachment, found by identity. */
    ref: AttachmentRef;
    type: 'region' | 'mesh' | 'boundingbox' | 'path' | 'clipping';
    /** The slot's sequence index as the animation left it. -1 means the setup index. */
    sequenceIndex: number;
    /** The region shown now, with its texture coordinates and offsets. Null for an attachment without a texture. */
    texture: OfficialTexture | null;
    /** Mesh only. The region UVs the official mesh holds: 64-bit numbers for a JSON file. */
    regionUVs: ArrayLike<number> | null;
    /** The slot's deform. Empty when the attachment is not deformed. */
    deform: readonly number[];
    /** How many numbers the official `computeWorldVertices` can write: 8 for a region attachment. */
    worldVerticesLength: number;
    /**
     * Runs the official `computeWorldVertices` into a plain array, which keeps 64-bit numbers.
     * A region attachment has no `start` and `count`: it always writes its 4 vertices.
     */
    computeWorld(start: number, count: number, out: number[], offset: number, stride: number): void;
}

/** One official skeleton instance being stepped. */
export interface OfficialGeometryPlayback {
    /** Advances time, applies the animation and solves the pose. */
    step(dt: number): void;
    /** Writes a, b, c, d, worldX, worldY for every bone: the layout of `PoseState.world`. */
    readBones(out: Float64Array): void;
    /** Every slot that shows a region, mesh, bounding box, path or clipping attachment. */
    shown(): OfficialShown[];
    /**
     * Every such attachment of every skin, shown or not, on the slot its skin stores it for. This
     * reaches attachments that no animation shows. Call it in the setup pose, where no slot has a deform.
     */
    stored(): OfficialShown[];
}

/** A skeleton and its atlas loaded by the official core of one version. */
export interface OfficialGeometry {
    readonly version: SpineVersion;
    readonly animations: readonly { name: string; duration: number }[];
    readonly skins: readonly string[];
    /** Every region and mesh attachment of every skin. */
    drawables(): OfficialDrawable[];
    /** A fresh skeleton in the setup pose. Without an animation it stays there. */
    play(animation: string | undefined, skin: string | undefined): OfficialGeometryPlayback;
}

/** Loads a skeleton with its real atlas in the official core of its version. */
export function loadOfficialGeometry(version: SpineVersion, files: RigFiles): OfficialGeometry {
    if (version === '4.1') return loadGeometry41(files);
    if (version === '4.2') return loadGeometry42(files);

    return loadGeometry43(files);
}
