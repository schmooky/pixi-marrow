/*
 * Browser part of scripts/check-render.mjs: asks the runtime which render modes it has, before a
 * comparison trusts a mode. See scripts/render/mode.js for how a mode is read back.
 */
import { RENDER_MODES } from './mode.js';
import { BACKGROUNDS } from './pixels.js';

/** The ways to ask for a render mode: each mode by name, and the default. */
const ASKED = [...RENDER_MODES, 'auto'];

/**
 * Draws one instance of ours once for each way to ask for a render mode, and reads back the mode
 * the runtime reports for it.
 *
 * @param files `skeleton` and `atlas` as addresses, `skin` or null, `animation`, and the
 * `placement` of the instance in the picture of the studio.
 * @returns Per way to ask, `mesh`, `batched` and `auto`: the `mode` that drew and the `reason`
 * the report gives. A `mode` of null says that the runtime reports none.
 */
export async function probeModes(ours, studio, { skeleton, atlas, skin, animation, placement }) {
    const readings = {};

    for (const asked of ASKED) {
        const instance = await ours.create({ skeleton, atlas, mode: asked });

        try {
            if (skin) instance.setSkin(skin);
            instance.place(placement);
            instance.play(animation);
            instance.update(0);
            studio.draw(instance.root, BACKGROUNDS.solid);
            readings[asked] = await instance.mode();
        } finally {
            instance.destroy();
        }
    }

    return readings;
}

/**
 * Which modes of ours a page draws, from what the runtime reports and what the command line asks.
 *
 * A runtime that reports no mode has one render path. It ignores `renderMode`, so a picture that
 * was asked for as batched would be the mesh picture under another name. Its batched comparisons
 * do not run, unless `trustMode` takes the mode that was asked for as the mode that drew.
 *
 * A runtime that reports modes may still draw meshes where the batched mode was asked for: the
 * option says that a skeleton draws with meshes while a clipping attachment cuts a visible slot,
 * and when its atlas has too many pages. So the batched comparisons run whatever the instance
 * reports, and every frame notes the mode that drew it. The mesh mode by name must be the mesh
 * mode: it is the reference of the other one.
 *
 * @param options.renderMode `both`, `mesh` or `batched`: what the command line asks for. `auto`
 * draws the default options alone, for a scene that runs each mode on a page of its own.
 * @param options.trustMode True to run the batched comparisons on a runtime that reports no mode.
 * @returns `run` says for `mesh`, `batched` and `auto` whether its instances are drawn. `entry`
 * is the case for the report.
 */
export function chooseModes(readings, { renderMode, trustMode }) {
    const wanted = RENDER_MODES.filter((mode) => renderMode === 'both' || renderMode === mode);
    const known = ASKED.some((asked) => readings[asked].mode !== null);
    const reasons = [];

    if (known && wanted.includes('mesh') && readings.mesh.mode !== 'mesh') {
        reasons.push(`renderMode 'mesh' was asked for and the instance reports ${readings.mesh.mode ?? 'no mode'}`);
    }
    if (!known && !trustMode && renderMode === 'batched') {
        reasons.push('the batched mode was asked for by name and the runtime reports no render mode');
    }
    const run = {
        mesh: wanted.includes('mesh'),
        batched: wanted.includes('batched') && (known || trustMode === true),
        auto: false,
    };

    // the default is compared with the mode it picked, so both must be there
    run.auto = renderMode === 'auto' || (run.mesh && run.batched);

    return {
        run,
        entry: {
            label: 'render mode',
            kind: 'mode',
            reasons,
            info: { known, trusted: !known && trustMode === true, readings, run },
        },
    };
}
