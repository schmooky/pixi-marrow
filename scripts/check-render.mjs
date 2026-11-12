#!/usr/bin/env node
/**
 * Draws skeletons with pixi-marrow and with the official Pixi runtime in headless Chrome and
 * compares the pixels. Unit tests run in Node without a GPU, so this is where the picture itself
 * is measured.
 *
 * usage: pnpm check:render [--renderer=webgl|webgpu|both] [--only=4.3/spineboy] [--animations=3|all]
 *                          [--render-mode=both|mesh|batched] [--strict-rebuilds] [--trust-mode]
 *                          [--strict-clipping] [--self-test] [--verbose] [--shots=4]
 *                          [--out=.shots/render] [--size=512] [--dist=<folder>] [--pixi=8.16]
 *
 * The rigs are the entries of fixtures/manifest.json that have page images. For each one a few
 * animations play on both sides with the same time steps. Both sides run as they ship and solve
 * every constraint: IK, transform, path, physics and sliders. Physics has state, so both sides
 * get the same updates from the same start: scripts/render/sides.js says how. At four steps each
 * side is drawn alone into a render texture, once on a transparent and once on a solid background,
 * and the raw pixels are read back. A rig with physics is drawn at a fifth step, deep in its
 * second loop. Per frame the check reports the largest channel difference and the share of the
 * covered pixels that differ by more than 1 and by more than 8 (of 255).
 *
 * Ours is drawn after `asset.optimized` has resolved, with the default cuts of overdraw. Those
 * are therefore part of every comparison with the official runtime.
 *
 * Render modes. pixi-marrow draws a skeleton with meshes of its own or as a part of the batches
 * of its render group: `renderMode: 'auto' | 'mesh' | 'batched'`. Every rig is drawn in both
 * modes, each asked for by name, and each is held to the same rules against the official
 * runtime. The official frames are drawn once and serve both. The lines of the mesh mode are the
 * ones this check had before there were modes. The batched mode has lines of its own.
 *
 * The page never takes the mode it asked for as the mode that drew. It reads the mode back from
 * the runtime: `stats.renderMode`, else the row `renderMode` of `perf.report()`. A runtime that
 * reports no mode has one render path, and its batched comparisons do not run. A runtime may draw
 * meshes where the batched mode was asked for, for example while a clip cuts a visible slot.
 * Such a frame is compared like any other, and the report counts those frames: they say nothing
 * about batching.
 *
 *   official twice             two official instances. No difference is allowed: the tooling is exact
 *   proof, ...                 an instance made wrong on purpose. It must be rejected, at both
 *                              placements
 *   ours                       pixi-marrow against the official runtime, from the binary export
 *   ours, json                 the same from the JSON export
 *   .., json and binary        one runtime, both exports. Spine 4.1 has no official Pixi v8 runtime,
 *                              so for 4.1 this is the only reference
 *   ours is not empty          4.1 only: every animation draws something
 *   .., premultiplied atlas    one runtime, the straight and the premultiplied atlas of a rig
 *   draw calls                 `stats.drawCalls` says what the GPU interface saw. A skeleton with
 *                              normal and additive slots only is one draw call, plus the ranges
 *                              and the two mask draws of every clip that cuts a visible slot
 *   buffers while playing      the vertex ranges are built once, and the index buffer stays while
 *                              an animation plays that keys no color, attachment, draw order or
 *                              sequence. With such keys a slot can come and go, for example when
 *                              its alpha reaches 0, and the rewrites are listed as information
 *   ours, cuts on and off      ours with the default cuts of overdraw against ours with both cuts
 *                              off. The cuts leave triangles out and change none, so the picture
 *                              must be the same. The check fails above a difference of 1
 *   ours, polygons and quads   ours with `tightMesh: 'on'` against ours without cuts. Polygons are
 *                              not exact and not the default, see TOLERANCE. The shares of the
 *                              pixels over 1 and over 8 have limits. The largest difference is
 *                              reported and has none
 *   ours with polygons, official  the same picture against the official runtime, with limits of
 *                              its own: what `tightMesh: 'on'` costs in picture terms
 *   overdraw                   the area of the triangles ours draws, with the default cuts and with
 *                              polygons, against no cuts, and the slots skipped as covered
 *   multisampled target        both cuts must take themselves back in the frame that is drawn to a
 *                              multisampled target, so the picture equals the one without cuts
 *   premultiplied page reading the outlines of a premultiplied page must see a color under alpha 0,
 *                              which a 2D canvas returns as black. Runs once per renderer
 *   render mode                which mode `auto` picked for the rig, and what the two modes draw
 *                              when they are asked for by name
 *   ours batched               the batched mode against the official runtime, judged like `ours`
 *   ours, batched and mesh     the two modes against each other: the largest difference and the
 *                              share of the pixels that differ. They place vertices in different
 *                              ways and need not be equal to the bit. Judged by TOLERANCE.modes
 *   ours batched, ...          the premultiplied atlas, the cuts on and off and the polygons once
 *                              more in the batched mode, each judged like its line of the mesh mode
 *   ours, auto and mesh        the default options against the mode they picked, asked for by name.
 *   ours, auto and batched     No difference is allowed: `auto` picks a mode and adds nothing
 *   buffers ..., batched       the buffer check in the batched mode
 *   multisampled ..., batched  the multisampled target in the batched mode, judged by the picture
 *
 * Instruction builds. Both buffer checks also count how often Pixi built the instructions of the
 * render group again while an animation played, from outside: scripts/render/pixels.js wraps the
 * one method of Pixi that builds them. The stable layout aims at zero, with draw order and
 * attachment keys too. The count is information. --strict-rebuilds makes a build in the batched
 * mode a failure, for rigs and for the scenes whose stage does not change.
 *
 * Scenes. After the rigs come stages with several instances, see scripts/render/scene-plan.mjs:
 * many instances that overlap, two rigs in turns, Pixi objects between instances, parents with
 * alpha and tint, a mask, a filter or a render group, instances that do not draw, blend modes,
 * dark tint, atlas pages and clips in one batch, and a stage that changes between frames. Each
 * scene is built once per side and compared like a rig:
 *
 *   mesh, batched              ours in that mode against the official runtime of the Spine version
 *   batched and mesh           the two modes against each other, measured
 *   batched against mesh       the same, judged, where the official runtime cannot draw the scene
 *   auto                       the default options at the first frame, against the same reference
 *   render mode                how many instances of the batched side and of the default options
 *                              drew in which mode
 *   what the rigs bring        the rows of `perf.report()` about draw ranges, blend modes, pages,
 *                              clips and dark tint, from one instance per rig
 *   draw calls                 per side, counted on the GPU interface for all alike
 *   instruction builds         how often Pixi built instructions after the first frame, per side
 *   proof, two instances ...   two instances swapped in the draw order. It must be rejected
 *
 * Sleeping and waking. A runtime may leave work out for a skeleton that does not change. It must
 * never show an old picture for it. The scenes whose name starts with `sleep` let skeletons rest
 * and wake: one rests for many frames and plays again, some rest while their parent moves or
 * while a neighbour in the same batch plays, some change while they are hidden and are shown
 * later, some rest while their skin, tint, alpha or render mode changes, and some are destroyed
 * while they rest. Every frame of these scenes is compared with the official runtime, which does
 * all of its work in every frame, in both render modes.
 *
 *   proof, a frame held back   one side leaves the update of one frame out, as a view would that
 *                              skips work it had to do. Its stale picture must be rejected
 *
 * Containers in a skeleton. The scenes `links-play` and `links-rest` attach a Pixi `Graphics` to
 * a slot and let another follow a bone, ours with `attach` and `follow`, the official runtime
 * with `addSlotObject`, while an animation with draw order keys plays and at rest.
 *
 *   proof, a container at another slot   the container sits at a wrong place in the draw order
 *
 * A game. After the rigs and scenes, `render/game-check.mjs` draws cases from a bundle that is
 * made as a game makes one: it imports `Application` and `MarrowSpine` by name, with the tree
 * shaken. Pixi registers pipes when their modules load, so a chunk that arrives after the
 * renderer exists can miss one. Each case equals the same case from a bundle with all of Pixi.
 * A lost context. Last, `render/restore-check.mjs` takes the WebGL context of a running game
 * away with the `WEBGL_lose_context` extension and gives it back, in both render modes: with
 * skeletons at rest and playing, with a clip, with several instances of one asset, with attached
 * containers, and with skeletons that are first drawn while the context is away. The frames
 * after the restore equal the frames of a run that kept its context. It runs on WebGL alone:
 * the loss of a WebGPU device is another event, and nothing checks it.
 * The lazy mesh mode. The code of the mesh mode is a chunk that loads on demand. The scenes
 * whose name starts with `lazy` draw the default options alone, each on a page of its own:
 *
 *   lazy mesh mode             the modes the instances drew in, frame by frame. A rig that `auto`
 *                              draws with meshes must draw its first frame in the mesh mode. An
 *                              instance that asks for the mesh mode at run time, or is created
 *                              for it without the load that waits for its code, draws in a batch
 *                              until the code is there. It must draw in every frame, which the
 *                              comparison of every frame shows, and arrive in the mesh mode
 *   mesh chunk                 the requests of the page. A page whose skeletons all draw in a
 *                              batch must not ask for the chunk. A bundle without such a chunk
 *                              is a finding and fails nothing
 * Everywhere else an instance that asks for the mesh mode by name gets an asset that was loaded
 * for that mode, see scripts/render/sides.js.
 * The last scenes look for a limit: 1200 instances in one stage, once of a rig with a clip and
 * once of a rig without. Each render mode of ours gets a page of its own there, so a mode that
 * throws inside Pixi cannot disturb the next one. What such a scene runs into prints as `FOUND`,
 * is listed in the summary as a finding and does not fail the check.
 * TOLERANCE below holds the pass criteria and what they rest on.
 * The second look: a frame that is outside the tolerance of ours against official is drawn again,
 * both sides moved by SECOND_PLACEMENT of scripts/render/judge.js, a fraction of a pixel that is
 * no multiple of the subpixel grid of a GPU. The two runtimes move vertices to the screen in
 * different arithmetic, so a vertex that lands on the border of two grid cells can be snapped
 * apart, which no tolerance of a few steps covers. Such a tie is gone at the second placement.
 * A real difference is not. A frame fails when it is outside the tolerance at both placements.
 * A frame that passes at the second one only is listed with the numbers of both, and the summary
 * counts those frames.
 * Clipping: a frame that ours draws through a clip mask (`stats.maskDraws` above 0) is compared
 * like every other frame. The report also gives the largest differences of those frames on their
 * own. `--strict-clipping` does nothing: it was the switch that failed clipped frames while they
 * were a known gap, and it is still accepted so that older command lines keep working.
 * Physics and sliders: the summary counts the frames of ours against official once more for the
 * rigs that have such constraints, in a line of their own. A solver that is wrong fails there and
 * leaves the other rigs alone.
 * Images of failing cases (ours or first, official or second, and where they differ) and of one
 * passing frame per rig go to `.shots/render/<renderer>/`. `--shots` sets how many cases per rig
 * get images. `--self-test` runs the tooling proof alone and draws nothing of ours. A proof is a
 * picture that is wrong on purpose: it must be rejected, and rejected again at the second
 * placement, so that the second look cannot let a real difference pass. The proofs of a rig move,
 * tint and hide. The proofs of the scenes swap two instances in the draw order and hold a frame
 * back.
 * --only keeps the rigs and scenes whose id holds the text: `--only=scene/` runs the scenes
 * alone, `--only=4.` the rigs alone. --render-mode=mesh or batched draws one mode of ours.
 * --trust-mode runs the batched comparisons on a runtime that reports no mode, and takes the mode
 * that was asked for as the mode that drew. It is for work on this tool: such a run proves
 * nothing about a batched mode. --dist names a folder with the `package.json` and the `dist` of a
 * build of pixi-marrow that was kept: the check then draws that build and leaves the working
 * tree alone.
 * --pixi names the version of pixi.js the pages run on, for example `--pixi=8.16`. The package
 * allows a range of versions and is developed on one of them, and the runtime has branches by
 * the version of Pixi. The version must be installed as a dev dependency of the package under
 * an alias, see `pixiPackage` of scripts/render/setup.mjs. pixi-marrow then runs on that
 * pixi.js. The official runtime allows the same range and can draw differently on an old
 * pixi.js too, so it runs twice. Its pictures on the pixi.js the package is developed with are
 * the reference: every comparison with the official runtime is one with them. Its pictures on
 * the pixi.js of the page are held against the reference too:
 *
 *   official, this pixi.js     the official runtime on the pixi.js of the page against the
 *                              reference. A difference is a finding about the official runtime
 *                              on that pixi.js and fails nothing
 * The head of a renderer names the versions.
 * Without --renderer both run. A renderer the browser does not have is skipped with a line that
 * says so, and fails the check only when it was asked for by name.
 * Runs the installed Google Chrome. CHROME_PATH names another binary and CHROME_ARGS replaces the
 * launch flags. The package is built first when it has no build or the sources are newer.
 */
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMeshChunk, meshChunkCase } from './render/chunks.mjs';
import { checkGame } from './render/game-check.mjs';
import { planRigs } from './render/plan.mjs';
import { createReporter } from './render/report.mjs';
import { describeHead, describeRig, describeScene, strayPixi } from './render/report-modes.mjs';
import { checkRestore } from './render/restore-check.mjs';
import { planScenes } from './render/scene-plan.mjs';
import { bundlePage, serve } from './render/serve.mjs';
import { builtPackage, inTime, launchChrome, parseArgs, pixiPackage } from './render/setup.mjs';

/**
 * The pass criteria, each as tight as the pictures of this repo support. The numbers they rest on
 * are from Chrome on Apple silicon, WebGL2 on ANGLE Metal and WebGPU, which agree to the digit.
 *
 * `max` is the largest channel difference of a frame. `over1` and `over8` are shares of the covered
 * pixels that differ by more than 1 and by more than 8.
 */
const TOLERANCE = {
    // Ours against official. Geometry and texture coordinates are the same numbers, so what is left
    // is rounding: the official runtime cuts a tint to 8 bits and transforms on the CPU, ours
    // transforms in the shader. Measured over the rigs without clipping: most frames differ by 1 at
    // most, and the worst pixel differs by 4. The largest share over 1 is 0.020%: a row of 20 pixels
    // where an edge lies on the pixel centers and the two sides round it to different rows. The
    // limit leaves room for a longer edge. Nothing differs by more than 8.
    // Clipped frames are held to the same limits. The official runtime cuts the triangles of a
    // clipped slot on the CPU, ours tests a stencil mask that holds the clip polygon, and both put
    // the edge on the same pixels. Measured on the three rigs that clip: the coin is the same
    // picture, the tank and spineboy differ by 1 at most.
    match: { max: 4, over1: 0.0005, over8: 0 },
    // The straight and the premultiplied atlas of a rig. The packer and the browser round the
    // multiplication differently, and layers add up. Measured on both runtimes: 4 at most, over
    // large translucent areas, so the share over 1 has no limit.
    pma: { max: 4, over1: 1, over8: 0 },
    // The JSON and the binary export of a rig. Spine 4.1 and 4.2 write JSON with two to four
    // decimals, so the two pictures sit a fraction of a pixel apart: the official 4.2 runtime shows
    // up to 63% of the pixels over 1 between its own two pictures. The measure is therefore the
    // share of pixels a small displacement cannot explain. Measured on the official runtime: 0.035%
    // at most, and 1.08% for the raptor, whose jump moves 0.6 px between the exports.
    formats: { displaced: 0.001, rigs: { 'raptor-pro': 0.015 } },
    // Ours with the default cuts of overdraw against ours without. A covered slot and a region
    // without a visible pixel are left out, and the triangles that stay are the same triangles,
    // so the picture is the same to the bit. Measured: no pixel differs. The limit of 1 is the
    // room the owner of the project gave to rounding.
    cuts: { max: 1 },
    // Ours with polygons against ours with quads, and against the official runtime. Not exact,
    // and not on by default: a GPU moves the corners of a triangle to its subpixel grid and
    // interpolates texture coordinates from there, so other triangles give other last bits.
    // Measured: the same quads split along the other diagonal change up to 12% of the pixels by 1
    // and a few by 2. A polygon adds pixels whose center lies on the edge of a region and falls to
    // the other side of it. Those differ by what the region shows at its edge.
    //
    // Measured over 384 frames against quads and 228 against official, the same on both renderers.
    // Over 1: none in half of the frames, 0.005% at the 90th percentile. The worst frame is
    // dragon-ess flying at step 7 with 0.08%, 27 pixels. Over 8: one pixel in a frame at most,
    // which is 0.004% in mix-and-match dress-up at step 26. The limits leave about three times
    // that. `few1` and `few8` are for small pictures: spineboy portal at step 26 covers 698
    // pixels, and its 3 pixels over 1 are 0.43% of them.
    // The largest difference is reported and has no limit: one edge pixel differs by up to 53.
    polygons: { over1: 0.0025, over8: 0.0001, few1: 8, few8: 3 },
    polygonsOfficial: { over1: 0.0025, over8: 0.0001, few1: 8, few8: 3 },
    // Ours in the batched mode against ours in the mesh mode. The two modes place vertices in
    // different ways, one on the CPU and one in the vertex shader, so they need not be equal to
    // the bit. Each is held to `match` against the official runtime. Measured between them over
    // 482 frames per renderer: the worst pixel differs by 5, 0.006% of the pixels of the worst
    // frame differ by more than 1, none by more than 8. The limits leave room for a longer edge.
    // Null here would say that the kind is measured and not judged.
    modes: { max: 6, over1: 0.0005, over8: 0 },
    // The same two pictures in a scene the official runtime cannot draw, where the mesh mode is
    // the only reference there is. The limit is the one of `match`: both modes pass that against
    // the official runtime wherever it can draw.
    own: { max: 4, over1: 0.0005, over8: 0 },
    // On a page that runs on another pixi.js: the official runtime on that pixi.js against the
    // official runtime on the pixi.js the package is developed with, the reference. The same
    // code draws both, so the limits are those of `match`. A frame outside of them says that
    // the official runtime draws another picture on that pixi.js. It is a finding, not a failure.
    pixi: { max: 4, over1: 0.0005, over8: 0 },
};
/** Failing cases per rig that get their images saved. */
const SHOTS_PER_RIG = 4;
const RIG_TIMEOUT = 180_000;

const root = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs();
const wanted = ['webgl', 'webgpu'].includes(args.renderer) ? [args.renderer] : ['webgl', 'webgpu'];
const outDir = resolve(root, args.out ?? '.shots/render');
const selfTest = args['self-test'] === 'true';
/** What a page draws of ours and how it judges, the same for every rig and scene. */
const pageOptions = {
    tolerance: TOLERANCE,
    shots: Number(args.shots ?? SHOTS_PER_RIG),
    renderMode: ['mesh', 'batched'].includes(args['render-mode']) ? args['render-mode'] : 'both',
    trustMode: args['trust-mode'] === 'true',
    strictRebuilds: args['strict-rebuilds'] === 'true',
};

/**
 * Runs the cases of one rig or of one scene on a page of its own, so that it cannot disturb the
 * next one.
 *
 * @param official The Spine version of the official runtime the page loads, or null for none.
 * @param call The function of `window.renderCheck` to run: `run` for a rig, `scene` for a scene.
 * @param plan What that function gets: the rig or the scene.
 * @param options What a job changes of the options of the page, or nothing.
 */
async function runPage(browser, origin, renderer, { official, call, plan, options: more }) {
    const page = await browser.newPage();
    const errors = [];
    // every address the page asks for: a scene about the lazy mesh mode looks for a chunk among them
    const requested = [];
    // the runtimes load before the renderer is created, so the page is told which ones in its address
    const query = `renderer=${renderer}&official=${official ?? 'none'}&ours=${selfTest ? 'no' : 'yes'}`;

    page.on('request', (request) => requested.push(request.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} for ${response.url()}`);
    });
    page.on('console', (entry) => {
        const text = entry.text();

        // a failed request is reported with its address by the response listener
        if (/Failed to load resource/.test(text)) return;
        if (entry.type() === 'error' || /CONTEXT_LOST|GL_INVALID|INVALID_|WebGPU|wgsl|shader/i.test(text))
            errors.push(text);
    });
    try {
        await page.goto(`${origin}/?${query}`);
        await page.waitForFunction(() => window.renderCheck, null, { timeout: 30_000 });
        const state = await page.evaluate(() => ({ ...window.renderCheck, run: undefined, scene: undefined }));

        if (state.error || state.renderer !== renderer) return { state, errors, requested };
        // the renderer is up from here on
        const options = { ...pageOptions, ...more, extras: plan.extras };
        const report = await inTime(
            page.evaluate(([name, it, opts]) => window.renderCheck[name](it, opts), [call, plan, options]),
            RIG_TIMEOUT,
        );

        return { state, report, errors, requested };
    } catch (error) {
        return { state: { renderer }, crash: error.message.split('\n')[0], errors, requested };
    } finally {
        await page.close().catch(() => {});
    }
}

/**
 * The rigs and the scenes of this run. A rig runs `run` of the page, a scene runs `scene`.
 *
 * @param made A folder for the fixtures a scene writes. `pkg` is the folder of the built
 * pixi-marrow whose core reads the skeletons.
 */
async function planJobs(made, pkg) {
    // a scene picks its rigs by id, so the plan holds every rig and --only filters afterwards
    const planned = await planRigs({
        root,
        size: Number(args.size ?? 512),
        animations: args.animations === 'all' ? Number.POSITIVE_INFINITY : Number(args.animations ?? 3),
        only: null,
        pkg,
    });
    const chosen = (id) => !args.only || id.includes(args.only);
    // the tooling proof needs the official runtime, which Spine 4.1 does not have
    const rigs = planned.filter((rig) => chosen(rig.id) && (!selfTest || rig.official));
    // the tooling proofs of the scenes: two instances swapped, and a frame held back
    const scenes = planScenes({ root, rigs: planned, made }).filter(
        (scene) => chosen(scene.id) && (!selfTest || scene.proof),
    );

    if (rigs.length + scenes.length === 0) throw new Error(`no rig and no scene matches --only=${args.only}`);
    // the cases that need no rig run on the page of the first one
    if (rigs.length > 0) rigs[0].extras = true;

    return [
        ...rigs.map((rig) => ({ official: rig.official, call: 'run', plan: rig, title: describeRig(rig) })),
        ...scenes.flatMap(sceneJobs),
    ];
}

/**
 * The pages of one scene. A scene that looks for a limit gets a page per render mode of ours, so
 * that a mode that throws inside Pixi cannot disturb the next one: the two modes by name and the
 * default options. A scene about the lazy mesh mode draws the default options alone: an instance
 * that asks for the mesh mode by name would load the code the scene watches for.
 */
function sceneJobs(scene) {
    const job = (plan, options) => ({
        official: scene.official,
        call: 'scene',
        plan,
        title: describeScene(plan),
        options,
    });

    if (scene.lazy) return [job(scene, { renderMode: 'auto' })];
    if (!scene.limit || selfTest) return [job(scene)];
    const modes = pageOptions.renderMode === 'both' ? ['mesh', 'batched', 'auto'] : [pageOptions.renderMode];

    return modes.map((mode) =>
        job({ ...scene, id: `${scene.id}, ${mode === 'auto' ? 'default options' : mode}` }, { renderMode: mode }),
    );
}

/** Runs the check and returns the exit code. */
async function main() {
    const pkg = builtPackage(root, args.dist, 'check-render');
    const pixi = pixiPackage(root, args.pixi, 'check-render');
    // on another pixi.js than the package is developed with, the official runtime also runs as the reference
    const versions = { page: pixi.version, reference: pixi.alias === 'pixi.js' ? null : pixiPackage(root).version };
    const bundle = await bundlePage(root, undefined, { pkg, pixi: pixi.dir, reference: versions.reference !== null });
    // where the code of the mesh mode is in the bundle, for the scenes about the lazy mesh mode
    const mesh = findMeshChunk(bundle.dir);
    let failed = 0;
    let ran = 0;
    let missing = false;
    let server;
    let browser;

    try {
        const jobs = await planJobs(bundle.made, pkg);

        server = await serve(root, bundle.dir, { made: bundle.made });
        browser = await launchChrome();
        for (const renderer of wanted) {
            const dir = join(outDir, renderer);
            const reporter = createReporter({
                root,
                dir,
                verbose: args.verbose === 'true',
                modesJudged: TOLERANCE.modes !== null,
            });
            const started = Date.now();
            const seconds = { run: 0, scene: 0 };
            let announced = false;

            rmSync(dir, { recursive: true, force: true });
            for (const job of jobs) {
                const before = Date.now();
                const ran = await runPage(browser, server.origin, renderer, job);
                const { state, report, crash, errors } = ran;

                seconds[job.call] += (Date.now() - before) / 1000;
                if (state.step !== 'load' && (state.error || state.renderer !== renderer)) {
                    const why = state.error ?? `the browser gave ${state.renderer}`;

                    console.log(`check-render: ${renderer} is not available here (${why}), its cases did not run`);
                    // a renderer that was asked for by name must be there
                    if (wanted.length === 1) failed++;
                    break;
                }
                if (!announced) console.log(`check-render: ${describeHead(renderer, state, versions)}`);
                // every runtime must run on the pixi.js the head names for it
                errors.push(...strayPixi(state.pixi, versions));
                announced = true;
                console.log(`  ${job.title}`);
                // what a scene that looks for a limit runs into is a finding. It fails nothing
                const limit = job.plan.limit === true;

                if (crash || state.error) {
                    console.log(`    ${limit ? 'FOUND' : 'FAIL'} the page failed: ${crash ?? state.error}`);
                    if (limit) reporter.findings.push(`${job.plan.id}: the page failed`);
                    else failed++;
                }
                if (report) {
                    if (job.plan.lazy) report.cases.push(meshChunkCase(job.plan, ran.requested, mesh));
                    failed += reporter.rig(job.plan, report);
                    missing ||= report.missing;
                }
                for (const error of errors) console.log(`    error ${error}`);
                if (errors.length && limit)
                    reporter.findings.push(`${job.plan.id}: ${errors.length} errors of the page`);
                else if (errors.length) failed++;
            }
            if (!announced) continue;
            ran++;
            console.log(
                `check-render: ${renderer} summary, ${((Date.now() - started) / 1000).toFixed(0)} s: ` +
                    `rigs ${seconds.run.toFixed(0)} s, scenes ${seconds.scene.toFixed(0)} s`,
            );
            reporter.summary();
        }
    } finally {
        await browser?.close();
        server?.close();
        bundle.remove();
    }
    if (!selfTest)
        failed += await checkGame({
            root,
            pkg,
            pixi,
            renderers: wanted,
            outDir: join(outDir, 'game'),
            only: args.only ?? null,
        });
    // a context is lost and restored with an extension of WebGL
    if (!selfTest && wanted.includes('webgl'))
        failed += await checkRestore({
            root,
            pkg,
            pixi,
            modes: pageOptions.renderMode === 'both' ? ['batched', 'mesh'] : [pageOptions.renderMode],
            outDir: join(outDir, 'restore'),
            only: args.only ?? null,
        });
    if (ran === 0) {
        console.log('check-render: no renderer came up, so nothing was checked');
        failed++;
    }
    if (missing) {
        console.log('check-render: pixi-marrow exports no MarrowSpine, so nothing of ours was drawn');
        failed++;
    }
    if (failed) console.log(`check-render: ${failed} failures`);
    else console.log('check-render: ok');

    return failed ? 1 : 0;
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(`check-render: ${error.message}`);
    process.exitCode = 1;
}
