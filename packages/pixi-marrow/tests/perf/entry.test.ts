import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarrowError, MarrowSpine } from '../../src/index';
import type { SkeletonView } from '../../src/render/skeleton-view';
import { coverAsset } from '../api/cover-asset';
import { FRAME } from '../api/helpers';

/*
 * What an instance pays for the probes of `pixi-marrow/perf` when it has none. This file does
 * not import the entry at the top. A test loads it when it wants to compare before and after.
 */

const pkgDir = fileURLToPath(new URL('../../', import.meta.url));
const srcDir = join(pkgDir, 'src');
const IMPORT =
    /(?:\bimport|\bexport)\s[^'";]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;

/**
 * What a source file imports: files of the source and packages. With `upfront` only what a
 * bundle loads with the file counts. An `import()` loads on demand, and an import of types is
 * gone after the build.
 */
function imports(file: string, upfront: boolean): { files: string[]; packages: string[] } {
    // an example in a doc comment can name a package the file does not import
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const files: string[] = [];
    const packages: string[] = [];

    for (const match of code.matchAll(IMPORT)) {
        const specifier = match[1] ?? match[2] ?? match[3] ?? '';
        const onDemand = match[2] !== undefined || /^(?:import|export)\s+type\b/.test(match[0]);

        if (upfront && onDemand) continue;
        if (!specifier.startsWith('.')) packages.push(specifier);
        else {
            const target = resolve(dirname(file), specifier);

            files.push(existsSync(`${target}.ts`) ? `${target}.ts` : join(target, 'index.ts'));
        }
    }

    return { files, packages };
}

/** Every file a source file reaches through its imports, and every package those files name. */
function reach(entry: string, upfront = false): { files: Set<string>; packages: Set<string> } {
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = [join(srcDir, entry)];

    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (files.has(file)) continue;
        files.add(file);
        const found = imports(file, upfront);

        queue.push(...found.files);
        for (const name of found.packages) packages.add(name);
    }

    return { files: new Set([...files].map((file) => relative(srcDir, file))), packages };
}

/** A message of the probes, and a reason of the perf report: text that only their code holds. */
const PROBE_MARKER = 'has a probe that measures its updates';
const REPORT_MARKER = 'a draw range samples up to 8';
/** A message of the clip kernel, which loads with an asset that has a clipping attachment. */
const KERNEL_MARKER = 'A clip polygon without a vertex cannot clip';
/** The label of the meshes of the mesh mode, which loads when a skeleton draws with meshes. */
const MESH_MARKER = 'marrow-range';
/** A field of the search for covered slots, which loads with the outlines. A minifier keeps the names of fields. */
const CUT_MARKER = 'coveredBy';

const sizeCheck = (): string => readFileSync(join(pkgDir, '../../scripts/size-check.mjs'), 'utf8');

/** The source files that hold a text. */
function holdersOf(text: string): string[] {
    return sourceFiles(srcDir)
        .filter((file) => readFileSync(file, 'utf8').includes(text))
        .map((file) => relative(srcDir, file));
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);

        if (statSync(path).isDirectory()) return sourceFiles(path);

        return name.endsWith('.ts') ? [path] : [];
    });
}

describe('the entry pixi-marrow/perf', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('is not reached by the root entry or by the core, in source', () => {
        const root = reach('index.ts');
        const core = reach('core.ts');
        const inPerf = (file: string): boolean => file === 'perf.ts' || file.startsWith('perf/');

        expect(root.files.has('api/spine.ts')).toBe(true);
        expect([...root.files].filter(inPerf)).toEqual([]);
        expect([...core.files].filter(inPerf)).toEqual([]);
    });

    it('reaches no Pixi and not the display object: a probe holds its object by shape', () => {
        const perf = reach('perf.ts');

        expect(perf.files.has('perf/probe.ts')).toBe(true);
        expect([...perf.packages]).toEqual([]);
        expect(perf.files.has('api/spine.ts')).toBe(false);
        expect(perf.files.has('render/skeleton-view.ts')).toBe(false);
    });

    it('is a subpath export that the build, the API check and the publish check read from the manifest', () => {
        const manifest: { exports: Record<string, unknown> } = JSON.parse(
            readFileSync(join(pkgDir, 'package.json'), 'utf8'),
        );

        expect(manifest.exports['./perf']).toEqual({ types: './dist/perf.d.ts', default: './dist/perf.js' });
        expect(existsSync(join(srcDir, 'perf.ts'))).toBe(true);
    });

    it('is kept out of the root import by the size check, with a marker only the probe code has', () => {
        expect(holdersOf(PROBE_MARKER)).toEqual(['perf/probe.ts']);
        // the entry of the root import, up to the comment of the next entry
        const root = /\n {4}everything: \[[\s\S]*?\n {4}\/\//.exec(sizeCheck())?.[0] ?? '';

        for (const marker of [PROBE_MARKER, REPORT_MARKER, KERNEL_MARKER, MESH_MARKER, CUT_MARKER]) {
            expect(root).toContain(`'${marker}'`);
        }
        expect(sizeCheck()).toContain("'perf (createProbe)': ['createProbe', ['pixi.js', 'marrow-skeleton'], '/perf']");
    });

    it('exports createProbe and nothing else at run time', async () => {
        expect(Object.keys(await import('../../src/perf'))).toEqual(['createProbe']);
    });
});

describe('the code behind perf.report and perf.memory', () => {
    /** The modules that only the report and the memory count use. */
    const LAZY = [
        'api/memory.ts',
        'api/perf-read.ts',
        'api/report-base.ts',
        'api/report-cuts.ts',
        'api/report.ts',
        'render/inspect.ts',
    ];

    it('is not in what the root entry loads up front', () => {
        const upfront = reach('index.ts', true);

        expect(upfront.files.has('api/spine-perf.ts')).toBe(true);
        expect(upfront.files.has('render/skeleton-view.ts')).toBe(true);
        expect(LAZY.filter((file) => upfront.files.has(file))).toEqual([]);
    });

    it('is reached by the root entry through one dynamic import, which brings all of it', () => {
        const all = reach('index.ts');
        const chunk = reach('api/perf-read.ts', true);
        const perfTools = readFileSync(join(srcDir, 'api/spine-perf.ts'), 'utf8');

        expect(LAZY.filter((file) => !all.files.has(file))).toEqual([]);
        expect(LAZY.filter((file) => !chunk.files.has(file))).toEqual([]);
        expect(perfTools.match(/await import\('\.\/perf-read'\)/g)).toHaveLength(2);
        expect(perfTools).not.toMatch(/^import \{/m);
    });

    it('is imported at run time by no module outside of it', () => {
        const lazy = new Set(LAZY.map((file) => join(srcDir, file)));
        const importers = sourceFiles(srcDir)
            .filter((file) => !lazy.has(file))
            .filter((file) => imports(file, true).files.some((target) => lazy.has(target)))
            .map((file) => relative(srcDir, file));

        expect(importers).toEqual([]);
    });

    it('is kept out of the root import by the size check, with a reason only the report has', () => {
        expect(holdersOf(REPORT_MARKER)).toEqual(['api/report.ts']);
        expect(sizeCheck()).toContain(REPORT_MARKER);
    });

    it('answers with promises, so that the code can load when it is first asked for', async () => {
        const spine = new MarrowSpine(await coverAsset([{ name: 'a', shows: 'small' }]), { autoUpdate: false });
        const report = spine.perf.report();
        const memory = spine.perf.memory();

        expect(report).toBeInstanceOf(Promise);
        expect(memory).toBeInstanceOf(Promise);
        expect((await report).map((row) => row.feature)).toContain('drawCalls');
        expect((await memory).instance).toBeGreaterThan(spine.engine.bytes);
        spine.destroy();
    });
});

describe('the code of the mesh mode, the code for clips and the code that cuts overdraw', () => {
    /** The modules of the mesh mode: its draw ranges, its shaders, its paint, the skinning on the GPU and the stencil mask of a clip. */
    const MESH = [
        'render/clip-mask.ts',
        'render/measured-geometry.ts',
        'render/mesh-paint.ts',
        'render/mesh-pipe.ts',
        'render/range-mesh.ts',
        'render/ranges.ts',
        'render/shader.ts',
        'render/skin-layout.ts',
        'render/skin-paint.ts',
        'render/skin-pose.ts',
        'render/skin-shader.ts',
        'render/vertex-colors.ts',
    ];
    /** The modules a clip needs in both render modes: the kernel, the shape of a polygon, the cut triangles of a batch. */
    const CLIPS = [
        'geometry/clip-triangles-cut.ts',
        'geometry/clip-triangles-parts.ts',
        'geometry/clip-triangles-store.ts',
        'geometry/clip-triangles-verdict.ts',
        'geometry/clip-triangles.ts',
        'geometry/triangulator.ts',
        'render/batch-clip.ts',
        'render/clip-shape.ts',
    ];
    /** The modules of the cuts of overdraw: polygons and opaque rectangles of a layout, and the search for covered slots. */
    const CUTS = [
        'geometry/occlusion.ts',
        'geometry/outline-vertices.ts',
        'render/cover-search.ts',
        'render/cut-work.ts',
    ];

    it('are not in what the root entry loads up front, and the batched mode is', () => {
        const upfront = reach('index.ts', true);

        expect([...MESH, ...CLIPS, ...CUTS].filter((file) => upfront.files.has(file))).toEqual([]);
        for (const file of [
            'render/batcher.ts',
            'render/batch-element.ts',
            'render/mesh-code.ts',
            'render/clip-code.ts',
            'render/cut-code.ts',
            'render/cover.ts',
        ]) {
            expect(upfront.files.has(file), file).toBe(true);
        }
    });

    it('are each reached through one dynamic import, which brings all of its modules', () => {
        const all = reach('index.ts');
        const loaders = {
            'render/mesh-code.ts': './mesh-paint',
            'render/clip-code.ts': './batch-clip',
            'render/cut-code.ts': './cut-work',
        };

        expect([...MESH, ...CLIPS, ...CUTS].filter((file) => !all.files.has(file))).toEqual([]);
        expect(MESH.filter((file) => !reach('render/mesh-paint.ts', true).files.has(file))).toEqual([]);
        expect(CLIPS.filter((file) => !reach('render/batch-clip.ts', true).files.has(file))).toEqual([]);
        expect(CUTS.filter((file) => !reach('render/cut-work.ts', true).files.has(file))).toEqual([]);
        for (const [file, target] of Object.entries(loaders)) {
            const code = readFileSync(join(srcDir, file), 'utf8');

            expect(code.split(`import('${target}')`), file).toHaveLength(2);
        }
        // the mesh mode does not bring the code for clips with it: a mask asks for the shape where it is loaded
        expect(CLIPS.filter((file) => reach('render/mesh-paint.ts', true).files.has(file))).toEqual([]);
    });

    it('are imported at run time by no module outside of them', () => {
        const lazy = new Set([...MESH, ...CLIPS, ...CUTS].map((file) => join(srcDir, file)));
        const importers = sourceFiles(srcDir)
            .filter((file) => !lazy.has(file))
            .filter((file) => imports(file, true).files.some((target) => lazy.has(target)))
            .map((file) => relative(srcDir, file));

        expect(importers).toEqual([]);
    });

    it('are kept out of the root import by the size check, each with a text only its code holds', () => {
        expect(holdersOf(MESH_MARKER)).toEqual(['render/ranges.ts']);
        expect(holdersOf(KERNEL_MARKER)).toEqual(['geometry/clip-triangles-parts.ts']);
        expect(holdersOf(CUT_MARKER)).toEqual(['render/cover-search.ts']);
        // the size check also lists the three chunks by name, with their sizes
        expect(sizeCheck()).toContain(`'the mesh mode': '${MESH_MARKER}'`);
        expect(sizeCheck()).toContain(`'the code for clips': '${KERNEL_MARKER}'`);
        expect(sizeCheck()).toContain(`'the cuts of overdraw': '${CUT_MARKER}'`);
    });
});

describe('an update without a probe', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * A display object, and a function that updates it once. The function lists what the update
     * called, in order, and how often the update read the clock.
     */
    async function traced(): Promise<{ spine: MarrowSpine; run: () => { calls: string[]; clock: number } }> {
        const spine = new MarrowSpine(await coverAsset([{ name: 'a', shows: 'small' }]), { autoUpdate: false });
        const view: SkeletonView = Reflect.get(spine, 'skeletonView');
        const now = vi.spyOn(performance, 'now');
        const spies = {
            'engine.update': vi.spyOn(spine.engine, 'update'),
            'engine.takeEvents': vi.spyOn(spine.engine, 'takeEvents'),
            'view.update': vi.spyOn(view, 'update'),
            'spine.emit': vi.spyOn(spine, 'emit'),
        };
        const run = (): { calls: string[]; clock: number } => {
            for (const spy of Object.values(spies)) spy.mockClear();
            now.mockClear();
            spine.update(FRAME);
            const clock = now.mock.calls.length;
            const calls = Object.entries(spies)
                .flatMap(([name, spy]) => spy.mock.invocationCallOrder.map((order) => ({ name, order })))
                .sort((a, b) => a.order - b.order)
                .map(({ name }) => name);

            return { calls, clock };
        };

        return { spine, run };
    }

    it('takes the same path before and after pixi-marrow/perf is loaded, and never reads the clock', async () => {
        const update = MarrowSpine.prototype.update;
        const text = String(update);
        const before = await traced();
        const first = before.run();
        const perf = await import('../../src/perf');
        const after = await traced();
        const second = after.run();

        expect(MarrowSpine.prototype.update).toBe(update);
        expect(String(MarrowSpine.prototype.update)).toBe(text);
        expect(first).toEqual({ calls: ['engine.update', 'engine.takeEvents', 'view.update'], clock: 0 });
        expect(second).toEqual(first);
        expect(before.run()).toEqual(first);
        expect(Object.hasOwn(after.spine, 'update')).toBe(false);
        expect(after.spine.updateProbe).toBeNull();
        // the same instance with a probe: the same calls in the same order, and the clock between them
        const probe = perf.createProbe(after.spine);

        expect(after.run()).toEqual({ calls: first.calls, clock: 5 });
        expect(probe.read().updates).toBe(1);
        probe.stop();
        expect(after.run()).toEqual(first);
        before.spine.destroy();
        after.spine.destroy();
    });

    it('does not read the clock while another instance has a probe', async () => {
        const { createProbe } = await import('../../src/perf');
        const asset = await coverAsset([{ name: 'a', shows: 'small' }]);
        const watched = new MarrowSpine(asset, { autoUpdate: false });
        const plain = new MarrowSpine(asset, { autoUpdate: false });
        const probe = createProbe(watched);
        const now = vi.spyOn(performance, 'now');

        now.mockClear();
        plain.update(FRAME);
        expect(now).not.toHaveBeenCalled();
        watched.update(FRAME);
        expect(now).toHaveBeenCalledTimes(5);
        expect(probe.read().updates).toBe(1);
        watched.destroy();
        plain.destroy();
    });

    it('checks one field for the probe: the update method reads it and no other perf state', () => {
        const text = String(MarrowSpine.prototype.update);

        // the check, and the argument of the measured path
        expect(text.match(/this\.probe\b/g)).toHaveLength(2);
        expect(text).toContain('this.probe !== null');
        expect(text).not.toContain('performance');
        expect(text).not.toMatch(/perf|tools|updateProbe/);
    });

    it('refuses a probe that cannot record, and keeps the one it has', async () => {
        const spine = new MarrowSpine(await coverAsset([{ name: 'a', shows: 'small' }]), { autoUpdate: false });
        const mine = { record: vi.fn() };

        spine.updateProbe = mine;
        for (const wrong of [undefined, {}, 'probe', { record: 5 }]) {
            expect(() => Reflect.set(spine, 'updateProbe', wrong)).toThrow(MarrowError);
        }
        expect(() => Reflect.set(spine, 'updateProbe', 7)).toThrow(
            'updateProbe was set to 7, which cannot record. Set an object with a record(pose, geometry, events) method, or null.',
        );
        expect(spine.updateProbe).toBe(mine);
        spine.update(FRAME);
        expect(mine.record).toHaveBeenCalledOnce();
        spine.updateProbe = null;
        spine.update(FRAME);
        expect(mine.record).toHaveBeenCalledOnce();
        spine.destroy();
    });
});
