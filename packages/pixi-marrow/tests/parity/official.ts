import type { SpineVersion } from '../../src/core';
import { load41 } from './official41';
import { load42 } from './official42';
import { load43 } from './official43';

/** The text or bytes of a skeleton and the text of its atlas. */
export interface RigFiles {
    skeleton: string | Uint8Array;
    atlas: string;
}

/** A skeleton loaded by the official spine-core of its own version: the reference for parity. */
export interface OfficialRig {
    readonly version: SpineVersion;
    readonly boneNames: readonly string[];
    readonly slotNames: readonly string[];
    readonly skinNames: readonly string[];
    readonly animations: readonly { name: string; duration: number }[];
    readonly constraintCount: number;
    /** A fresh skeleton in the setup pose with `animation` on track 0. */
    play(animation: string, loop: boolean, skin: string | undefined): OfficialPlayback;
}

/** One skeleton instance being stepped. Readers copy the current pose out in a fixed layout. */
export interface OfficialPlayback {
    /** Advances time, applies the animation and solves the pose. */
    step(dt: number): void;
    /** Writes a, b, c, d, worldX, worldY for every bone. */
    readBones(out: Float32Array): void;
    /** Writes r, g, b, a for every slot. */
    readSlotColors(out: Float32Array): void;
    /** The attachment name of every slot, or null. */
    readAttachments(): (string | null)[];
    /** Writes the slot index at every draw order position. */
    readDrawOrder(out: Uint16Array): void;
    /** The names of the events fired since the last call. */
    takeEvents(): string[];
}

/** Loads a skeleton with the official core that matches its version. */
export function loadOfficial(version: SpineVersion, files: RigFiles): OfficialRig {
    if (version === '4.1') return load41(files);
    if (version === '4.2') return load42(files);

    return load43(files);
}
