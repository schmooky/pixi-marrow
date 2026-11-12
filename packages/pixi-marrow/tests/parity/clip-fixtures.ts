import { importSkeleton } from '../../src/formats/import';
import { meshSource } from '../../src/pose/shared/lookup';
import type { ClipCase, ClipSlot } from './clip-check';
import { type Fixture, listFixtures, readFixture } from './fixtures';
import type { GeometryRig } from './geometry-check';
import type { OfficialShown } from './geometry-official';

/*
 * The clips of the fixtures as cases for the CPU clip kernel. The official core of a fixture's
 * version plays every animation. At every frame each clipping attachment that is shown gives two
 * cases: its polygon in world space with the slots it cuts, and with all other slots that draw.
 *
 * The slots a clip cuts are those between its slot and its end slot in the setup order. A draw
 * order key can change that for a frame. The kernel does not care which slots it gets.
 */

/** Frames stepped per animation, and how many of them make one loop. */
const FRAMES = 12;
const FRAMES_PER_LOOP = 9;
/** The two triangles of a region attachment. */
const QUAD = Uint16Array.of(0, 1, 2, 0, 2, 3);

/** The fixtures whose skeleton has a clipping attachment, found with our importer. */
export async function clipFixtures(): Promise<Fixture[]> {
    const found: Fixture[] = [];

    for (const fixture of listFixtures()) {
        const model = await importSkeleton(readFixture(fixture).skeleton);
        const attachments = model.skins.flatMap((skin) => skin.attachments);

        if (attachments.some(({ attachment }) => attachment.type === 'clipping')) found.push(fixture);
    }

    return found;
}

/** What a renderer holds for a slot that draws: 32-bit positions and texture coordinates, and triangles. */
function slotOf(rig: GeometryRig, shown: OfficialShown): ClipSlot | null {
    const attachment = rig.lookup.resolve(shown.ref);
    const world: number[] = [];

    if (shown.texture === null || (attachment?.type !== 'region' && attachment?.type !== 'mesh')) return null;
    shown.computeWorld(0, shown.worldVerticesLength, world, 0, 2);

    return {
        positions: Float32Array.from(world),
        uvs: Float32Array.from(shown.texture.uvs),
        triangles: attachment.type === 'region' ? QUAD : meshSource(rig.lookup, attachment).triangles,
    };
}

/** What a frame gives a visitor for one clip that is shown. */
export interface FixtureClip {
    /** The animation, the frame and the slot of the clip. */
    where: string;
    /** The slot and the name of the clipping attachment. */
    key: string;
    /** Whether the polygon has no weights and no deform: one bone moves it, and its shape stays. */
    rigid: boolean;
    /** The polygon with the slots between the clip and its end slot. */
    cut: ClipCase;
    /** The polygon with every other slot that draws. */
    rest: ClipCase;
}

/** The clips of the frame an official playback is at. */
function clipsOf(rig: GeometryRig, label: string, shown: OfficialShown[], visit: (clip: FixtureClip) => void): void {
    for (const clip of shown) {
        const attachment = rig.lookup.resolve(clip.ref);

        if (attachment?.type !== 'clipping') continue;
        const polygon: number[] = [];
        const { inverse, convex, endSlot } = attachment;
        const cut: ClipSlot[] = [];
        const rest: ClipSlot[] = [];

        clip.computeWorld(0, clip.worldVerticesLength, polygon, 0, 2);
        for (const other of shown) {
            const slot = slotOf(rig, other);
            // an end slot that is not behind the clip never ends it: the official loop skips the slot of the clip
            const inside = other.slot > clip.slot && (endSlot <= clip.slot || other.slot <= endSlot);

            if (slot !== null) (inside ? cut : rest).push(slot);
        }
        const key = `${rig.model.slots.names[clip.slot]}/${clip.ref.name}`;

        visit({
            where: `${label} ${key}`,
            key,
            rigid: attachment.bones === null && clip.deform.length === 0,
            cut: { polygon, inverse, convex, slots: cut },
            rest: { polygon, inverse, convex, slots: rest },
        });
    }
}

/**
 * Plays every animation of a rig in the official core, and the setup pose of every skin, and
 * hands every clip of every frame to `visit`.
 */
export function walkClips(rig: GeometryRig, visit: (clip: FixtureClip) => void): void {
    const { animations, skins } = rig.official;

    animations.forEach((animation, index) => {
        // the skins take turns, so that the animations show the attachments of every skin
        const playback = rig.official.play(animation.name, skins[index % skins.length]);
        const dt = (animation.duration > 0 ? animation.duration : 1) / FRAMES_PER_LOOP;

        for (let frame = 0; frame < FRAMES; frame++) {
            playback.step(frame === 0 ? 0 : dt);
            clipsOf(rig, `${animation.name} frame ${frame}`, playback.shown(), visit);
        }
    });
    for (const skin of [undefined, ...skins]) {
        const playback = rig.official.play(undefined, skin);

        playback.step(0);
        clipsOf(rig, `setup of skin ${skin}`, playback.shown(), visit);
    }
}
