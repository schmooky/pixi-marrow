import type { OfficialRig } from './official';

/** The pose of a skeleton after one step, as the official core computed it. */
export interface ReferenceFrame {
    /** a, b, c, d, worldX, worldY for every bone. */
    bones: Float32Array;
    /** r, g, b, a for every slot. */
    slotColors: Float32Array;
    attachments: readonly (string | null)[];
    /** The slot index at every draw order position. */
    drawOrder: Uint16Array;
    /** The names of the events fired during the step. */
    events: readonly string[];
}

/** How to step an animation when recording it. */
export interface RecordOptions {
    frames: number;
    dt: number;
    loop: boolean;
    skin: string | undefined;
}

/** Plays `animation` from the setup pose on the official core and records the pose after every step. */
export function recordReference(rig: OfficialRig, animation: string, options: RecordOptions): ReferenceFrame[] {
    const playback = rig.play(animation, options.loop, options.skin);
    const frames: ReferenceFrame[] = [];

    for (let i = 0; i < options.frames; i++) {
        const bones = new Float32Array(rig.boneNames.length * 6);
        const slotColors = new Float32Array(rig.slotNames.length * 4);
        const drawOrder = new Uint16Array(rig.slotNames.length);

        playback.step(options.dt);
        playback.readBones(bones);
        playback.readSlotColors(slotColors);
        playback.readDrawOrder(drawOrder);
        frames.push({
            bones,
            slotColors,
            attachments: playback.readAttachments(),
            drawOrder,
            events: playback.takeEvents(),
        });
    }

    return frames;
}

/** The first skin that is not the default one. Rigs built from skins have an empty default skin. */
export function pickSkin(rig: OfficialRig): string | undefined {
    return rig.skinNames.find((name) => name !== 'default');
}

/** Whether every number in the recording is finite. */
export function allFinite(frames: readonly ReferenceFrame[]): boolean {
    return frames.every((frame) => frame.bones.every(Number.isFinite) && frame.slotColors.every(Number.isFinite));
}

/** A short hash of every value in a recording, to tell two recordings apart. */
export function checksum(frames: readonly ReferenceFrame[]): string {
    // FNV-1a, 32 bits
    let hash = 0x811c9dc5;
    const add = (bytes: Uint8Array): void => {
        for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193);
    };
    const text = new TextEncoder();

    for (const frame of frames) {
        for (const values of [frame.bones, frame.slotColors, frame.drawOrder]) {
            add(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
        }
        add(text.encode(frame.attachments.join('\n')));
        add(text.encode(frame.events.join('\n')));
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
}
