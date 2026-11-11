/**
 * What the render check runs: the rigs of fixtures/manifest.json that have page images, with the
 * placement, the skins and the animations of each. Every skeleton is read with the built core, so
 * the plan needs no browser.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** What an animation can key, most telling for a picture first. The choice covers these. */
const INTEREST = ['deform', 'attachments', 'drawOrder', 'colors', 'sequences', 'bones'];
/** Steps of a sequence after which both sides are drawn. The last one is past the loop point. */
const CAPTURES = [0, 7, 15, 26];
/**
 * One step as a share of a loop: about 24 steps per loop. Not a plain fraction, so a capture does
 * not fall on a key, where the rounding of a key time would decide which side of it is drawn.
 */
const LOOP_SHARE = 0.0421;
/** The share of the picture the setup pose bounds fill, so a moving rig stays inside. */
const FILL = 0.6;
/** A rig that would be drawn smaller than this gets a picture of twice the size. */
const MIN_SCALE = 0.35;
/**
 * The part of a skeleton to frame, as x, y, width and height in skeleton units, where the setup
 * bounds are no good. The bounds of the tank are 7200 units wide, and most of that is ground.
 */
const FRAMES = { 'tank-pro': [-1450, -349, 2800, 1299] };
/**
 * What an animation can key that changes which slots are drawn: a slot appears, vanishes when its
 * alpha reaches 0, moves in the draw order or shows another region. The index buffer may be
 * rewritten then, and must stay otherwise.
 */
const REWRITERS = ['colors', 'attachments', 'drawOrder', 'sequences'];
/** The slot the tooling proof tints and hides, per rig. */
const PROOF_SLOTS = { 'spineboy-pro': { tint: 'torso', hide: 'eye' } };

/** The time step of an animation. One without a duration is a pose, and gets a frame of 30 per second. */
const stepOf = (info) => (info.duration > 0 ? info.duration * LOOP_SHARE : 1 / 30);

/** Animations that cover the most features, then the ones with the most timelines. */
function chooseAnimations(infos, limit) {
    const moving = infos.filter((info) => info.duration > 0);
    const pool = moving.length ? [...moving] : [...infos];
    const chosen = [];
    const seen = new Set();
    const gain = (info) => info.features.filter((feature) => INTEREST.includes(feature) && !seen.has(feature)).length;

    while (chosen.length < limit && pool.length) {
        pool.sort((a, b) => gain(b) - gain(a) || b.timelines - a.timelines || a.name.localeCompare(b.name));
        const [best] = pool.splice(0, 1);

        chosen.push(best);
        for (const feature of best.features) seen.add(feature);
    }

    return chosen;
}

/** The two skins with the most attachments, or one null when the rig has the default skin only. */
function chooseSkins(model) {
    const named = model.skins.filter((skin) => skin.name !== 'default');

    if (named.length === 0) return [null];

    return [...named]
        .sort((a, b) => b.attachments.length - a.attachments.length || a.name.localeCompare(b.name))
        .slice(0, 2)
        .map((skin) => skin.name);
}

/** The picture size, where the skeleton origin goes and how large it is drawn: the frame, centered. */
function placement([x, y, frameWidth, frameHeight], baseSize) {
    const width = Math.max(frameWidth, 1);
    const height = Math.max(frameHeight, 1);
    const fit = (size) => Math.round(Math.min((size * FILL) / width, (size * FILL) / height) * 1e4) / 1e4;
    const size = fit(baseSize) < MIN_SCALE ? baseSize * 2 : baseSize;
    const scale = fit(size);

    return {
        size,
        scale,
        // skeletons are drawn with y down, so the top of the frame is at -(y + height)
        x: Math.round((size / 2 - (x + width / 2) * scale) * 100) / 100,
        y: Math.round((size / 2 + (y + height / 2) * scale) * 100) / 100,
    };
}

/**
 * The animations of the buffer check: the chosen ones, plus one that keys none of REWRITERS when
 * the chosen ones all do, so the index buffer is watched where it must stay.
 */
function steadyAnimations(infos, chosen) {
    const quiet = (info) => !info.features.some((feature) => REWRITERS.includes(feature));
    const list = [...chosen];

    if (!list.some(quiet)) {
        const extra = infos.find((info) => info.duration > 0 && quiet(info));

        if (extra) list.push(extra);
    }

    return list.map((info) => ({ animation: info.name, dt: stepOf(info), features: info.features }));
}

/**
 * The rigs to run, in manifest order.
 *
 * @param options.root The repo root.
 * @param options.size Width and height of the picture in pixels. A rig that would be small gets twice that.
 * @param options.animations How many animations per rig, or Infinity for all of them.
 * @param options.only A part of `<version>/<rig>` to keep, or null for every rig.
 */
export async function planRigs({ root, size, animations, only }) {
    const core = await import(pathToFileURL(join(root, 'packages/pixi-marrow/dist/core.js')).href);
    const manifest = JSON.parse(readFileSync(join(root, 'fixtures/manifest.json'), 'utf8'));
    const rigs = [];

    for (const entry of manifest.files) {
        const id = `${entry.version}/${entry.rig}`;

        if (!entry.images || (only && !id.includes(only))) continue;
        const cached = (file) => {
            const path = join(root, 'fixtures/.cache', entry.version, basename(file.path));

            if (!existsSync(path)) throw new Error(`${file.path} is not downloaded. Run: pnpm fixtures`);

            return path;
        };

        for (const file of [entry.json, entry.atlas, ...entry.images, ...(entry.pma?.images ?? [])]) cached(file);
        const model = await core.importSkeleton(new Uint8Array(readFileSync(cached(entry.skel))));
        const info = core.describeSkeleton(model);
        const placed = placement(FRAMES[entry.rig] ?? [model.x, model.y, model.width, model.height], size);
        const skins = chooseSkins(model);
        const chosen = chooseAnimations(info.animations, animations);
        const sequences = skins.flatMap((skin, skinIndex) =>
            // the second skin plays the first animation only
            (skinIndex === 0 ? chosen : chosen.slice(0, 1)).map((animation) => ({
                skin,
                animation: animation.name,
                dt: stepOf(animation),
                captures: animation.duration > 0 ? CAPTURES : CAPTURES.slice(0, 2),
            })),
        );

        rigs.push({
            id,
            version: entry.version,
            rig: entry.rig,
            // Spine 4.1 has no official Pixi v8 runtime
            official: entry.version === '4.1' ? null : entry.version,
            files: {
                skel: basename(entry.skel.path),
                json: basename(entry.json.path),
                atlas: basename(entry.atlas.path),
                pma: entry.pma ? basename(entry.pma.atlas.path) : null,
            },
            size: placed.size,
            placement: { x: placed.x, y: placed.y, scale: placed.scale },
            features: info.features,
            // with additive slots the alpha of a transparent target differs from the official one by design
            additive: info.features.includes('additiveBlend'),
            // only normal and additive slots: the whole skeleton fits one draw call
            oneDraw: !info.features.includes('multiplyBlend') && !info.features.includes('screenBlend'),
            sequences,
            steady: steadyAnimations(info.animations, chosen),
            steadySkin: skins[0],
            rewriters: REWRITERS,
            proof: PROOF_SLOTS[entry.rig] ?? null,
        });
    }

    return rigs;
}
