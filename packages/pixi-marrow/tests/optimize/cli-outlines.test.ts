import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importAtlas } from '../../src/formats/atlas';
import { buildAtlasOutlines, readAtlasOutlines, summarizeOutlines } from '../../src/geometry/outlines';
import { type CliHost, runCli } from '../../src/optimize/cli';
import { listAtlasFixtures, loadAtlasFixture } from '../geometry/outline-checks';
import { encodePng } from './png-encoder';

type RecordingHost = CliHost & { out: string[]; errors: string[]; files: Map<string, string>; reads: string[] };

/** A host that records what the tool reads, prints and writes. */
function hostOf(read: (path: string) => string | Uint8Array): RecordingHost {
    const out: string[] = [];
    const errors: string[] = [];
    const files = new Map<string, string>();
    const reads: string[] = [];

    return {
        out,
        errors,
        files,
        reads,
        read: (path) => {
            reads.push(path);

            return read(path);
        },
        write: (path, text) => files.set(path, text),
        print: (line) => out.push(line),
        printError: (line) => errors.push(line),
    };
}

/** A host on the real files, as the `pixi-marrow` binary gives one. */
const diskHost = (): RecordingHost =>
    hostOf((path) => (path.endsWith('.json') ? readFileSync(path, 'utf8') : new Uint8Array(readFileSync(path))));

/** An atlas of one page with one region, and its page: 8x8 pixels with an opaque block of 4x4 in the middle. */
const ATLAS_TEXT = 'page.png\nsize: 8, 8\nfilter: Linear, Linear\nblock\nbounds: 0, 0, 8, 8\n';
const samples = Uint8Array.from({ length: 8 * 8 * 4 }, (_, i) => {
    const x = (i >> 2) % 8;
    const y = i >> 5;

    return x >= 2 && x < 6 && y >= 2 && y < 6 ? 255 : 0;
});
const PAGE = encodePng({ width: 8, height: 8, colorType: 6, samples, filters: [4] });

/** A host with the small atlas under any folder. */
const smallHost = (page: string | Uint8Array = PAGE): RecordingHost =>
    hostOf((path) => (path.endsWith('.atlas') || path.endsWith('.txt') ? new TextEncoder().encode(ATLAS_TEXT) : page));

function fixture(id: string) {
    const found = listAtlasFixtures().find((candidate) => candidate.id === id);

    if (found === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);

    return found;
}

describe('runCli outlines', () => {
    it('writes the outlines of an atlas next to it and prints what they save', async () => {
        const spineboy = fixture('4.2/spineboy.atlas');
        const { atlas, pages } = await loadAtlasFixture(spineboy);
        const expected = buildAtlasOutlines(atlas, pages);
        const host = diskHost();
        const out = spineboy.path.replace(/\.atlas$/, '.outlines.json');

        expect(await runCli(['outlines', spineboy.path], host)).toBe(0);
        expect([...host.files.keys()]).toEqual([out]);
        expect(readAtlasOutlines(JSON.parse(host.files.get(out) ?? ''), atlas)).toEqual(expected);
        expect(JSON.parse(host.out.join('\n'))).toEqual({ file: out, ...summarizeOutlines(atlas, expected) });
        expect(host.errors).toEqual([]);
    });

    it('reads every page of an atlas with several pages', async () => {
        const dragon = fixture('4.2/dragon.atlas');
        const host = diskHost();

        expect(await runCli(['outlines', dragon.path, '--out', 'dragon.json'], host)).toBe(0);
        expect(host.reads.filter((path) => path.endsWith('.png'))).toHaveLength(5);
        expect(JSON.parse(host.out.join('\n'))).toMatchObject({ file: 'dragon.json', regions: 40, skippedPages: 0 });
    });

    it('writes one region per line, in a file that ends with a line break', async () => {
        const host = smallHost();

        expect(await runCli(['outlines', 'art/hero.atlas'], host)).toBe(0);
        expect(host.files.get('art/hero.outlines.json')).toBe(
            [
                '{"version":1,"margin":1,"opaqueMargin":1,"regions":[',
                '{"name":"block","rect":{"x":0,"y":0,"width":8,"height":8},"polygon":[1,1,7,1,7,7,1,7],"triangles":[0,1,2,0,2,3],"coverage":0.5625,"opaque":null}',
                ']}',
                '',
            ].join('\n'),
        );
        expect(JSON.parse(host.out.join('\n'))).toEqual({
            file: 'art/hero.outlines.json',
            regions: 1,
            outlined: 1,
            empty: 0,
            opaque: 0,
            skippedPages: 0,
            quadArea: 64,
            outlineArea: 36,
            savedArea: 28,
            savedShare: 0.4375,
        });
    });

    it('looks for the page images in the folder of the atlas', async () => {
        const cases = [
            ['art/hero.atlas', 'art/page.png', 'art/hero.outlines.json'],
            ['hero.atlas', 'page.png', 'hero.outlines.json'],
            ['C:\\art\\hero.atlas', 'C:\\art\\page.png', 'C:\\art\\hero.outlines.json'],
            ['/abs/dir.atlas/hero.atlas.txt', '/abs/dir.atlas/page.png', '/abs/dir.atlas/hero.atlas.txt.outlines.json'],
        ];

        for (const [atlasPath = '', pagePath, outPath] of cases) {
            const host = smallHost();

            expect(await runCli(['outlines', atlasPath], host)).toBe(0);
            expect(host.reads).toEqual([atlasPath, pagePath]);
            expect([...host.files.keys()]).toEqual([outPath]);
        }
    });

    it('writes where --out says, and takes an atlas the host read as text', async () => {
        const host = hostOf((path) => (path.endsWith('.atlas') ? ATLAS_TEXT : PAGE));

        expect(await runCli(['outlines', 'hero.atlas', '--out', 'build/outlines.json'], host)).toBe(0);
        expect([...host.files.keys()]).toEqual(['build/outlines.json']);
        expect(
            readAtlasOutlines(JSON.parse(host.files.get('build/outlines.json') ?? ''), importAtlas(ATLAS_TEXT)).regions,
        ).toHaveLength(1);
    });

    it('prints the error and returns 1 for a page image it cannot read', async () => {
        const notPng = smallHost(new TextEncoder().encode('not an image'));
        const text = smallHost('not an image');
        const wrongSize = smallHost(
            encodePng({ width: 4, height: 4, colorType: 6, samples: new Uint8Array(64), filters: [0] }),
        );

        expect(await runCli(['outlines', 'hero.atlas'], notPng)).toBe(1);
        expect(notPng.errors.join('\n')).toContain(
            '[pixi-marrow:invalid-data] The image "page.png" is not a valid PNG file',
        );
        expect(await runCli(['outlines', 'hero.atlas'], text)).toBe(1);
        expect(text.errors.join('\n')).toContain('The page image "page.png" was read as text.');
        expect(await runCli(['outlines', 'hero.atlas'], wrongSize)).toBe(1);
        expect(wrongSize.errors.join('\n')).toContain('has 4x4 pixels and the atlas states 8x8');
        for (const host of [notPng, text, wrongSize]) expect(host.files.size).toBe(0);
    });

    it('lets the error of a missing file through', async () => {
        const host = hostOf((path) => {
            if (path.endsWith('.png')) throw new Error(`ENOENT: ${path}`);

            return ATLAS_TEXT;
        });

        await expect(runCli(['outlines', 'art/hero.atlas'], host)).rejects.toThrow('ENOENT: art/page.png');
    });

    it('prints the usage and returns 2 without an atlas', async () => {
        for (const args of [['outlines'], ['outlines', '--out', 'x.json']]) {
            const host = smallHost();

            expect(await runCli(args, host)).toBe(2);
            expect(host.errors.join('\n')).toContain('pixi-marrow outlines <atlas> [--out <file>] [--pages <dir>]');
            expect(host.errors.join('\n')).toContain('--pages names the folder');
            expect(host.reads).toEqual([]);
        }
    });

    describe('for an atlas whose pages are not PNG files', () => {
        /** The small atlas as AssetPack writes it: the page is a WebP file, in a folder of its own. */
        const WEBP_ATLAS = ATLAS_TEXT.replace('page.png', 'page.webp');
        /** The first bytes of a WebP file and of an AVIF file. */
        const WEBP = new TextEncoder().encode('RIFF\u0010\u0000\u0000\u0000WEBPVP8 ');
        const AVIF = new TextEncoder().encode('\u0000\u0000\u0000\u001cftypavif\u0000\u0000\u0000\u0000');
        const webpHost = (atlasText = WEBP_ATLAS): RecordingHost =>
            hostOf((path) => {
                if (path.endsWith('.atlas')) return atlasText;
                if (path.endsWith('.webp')) return WEBP;
                if (path === 'raw/page.png' || path === 'C:\\raw\\src/page.png') return PAGE;
                throw new Error(`ENOENT: no such file, open '${path}'`);
            });

        it('reads the PNG source of each page from the folder of --pages, by its base name', async () => {
            for (const [folder, read] of [
                ['raw', 'raw/page.png'],
                ['raw/', 'raw/page.png'],
                ['C:\\raw\\src\\', 'C:\\raw\\src/page.png'],
            ]) {
                const host = webpHost();

                expect(await runCli(['outlines', 'dist/hero.webp.atlas', '--pages', folder ?? ''], host)).toBe(0);
                expect(host.reads).toEqual(['dist/hero.webp.atlas', read]);
                expect(host.errors).toEqual([]);
                // the same outlines as for the atlas with the PNG page
                const png = smallHost();

                await runCli(['outlines', 'dist/hero.atlas'], png);
                expect(host.files.get('dist/hero.webp.outlines.json')).toBe(png.files.get('dist/hero.outlines.json'));
            }
        });

        it('takes the base name of a page in a folder, and of a PNG page too', async () => {
            const nested = webpHost(ATLAS_TEXT.replace('page.png', 'pages/page.avif'));
            const png = webpHost(ATLAS_TEXT);

            expect(await runCli(['outlines', 'hero.atlas', '--pages', 'raw'], nested)).toBe(0);
            expect(nested.reads).toEqual(['hero.atlas', 'raw/page.png']);
            expect(await runCli(['outlines', 'hero.atlas', '--pages', 'raw'], png)).toBe(0);
            expect(png.reads).toEqual(['hero.atlas', 'raw/page.png']);
        });

        it('says that it reads PNG only and tells of --pages, without it', async () => {
            const host = webpHost();

            expect(await runCli(['outlines', 'dist/hero.webp.atlas'], host)).toBe(1);
            // the page is named as WebP: it is not even read
            expect(host.reads).toEqual(['dist/hero.webp.atlas']);
            expect(host.errors.join('\n')).toContain(
                'The page image "page.webp" is WebP, not PNG. pixi-marrow outlines reads PNG only.',
            );
            expect(host.errors.join('\n')).toContain('pixi-marrow outlines dist/hero.webp.atlas --pages <dir>');
            expect(host.errors.join('\n')).toContain('reads "page.webp" from <dir>/page.png');
            expect(host.files.size).toBe(0);
        });

        it('knows a WebP or AVIF file by its bytes when it is named .png', async () => {
            for (const [bytes, format] of [
                [WEBP, 'WebP'],
                [AVIF, 'AVIF'],
            ] as const) {
                const host = smallHost(bytes);

                expect(await runCli(['outlines', 'hero.atlas'], host)).toBe(1);
                expect(host.errors.join('\n')).toContain(`The page image "page.png" is ${format}, not PNG.`);
                expect(host.errors.join('\n')).toContain('--pages <dir>');
            }
        });

        it('says which PNG source is missing in the folder of --pages, and that a size does not fit', async () => {
            const missing = webpHost();
            const small = hostOf((path) =>
                path.endsWith('.atlas')
                    ? WEBP_ATLAS
                    : encodePng({ width: 4, height: 4, colorType: 6, samples: new Uint8Array(64), filters: [0] }),
            );

            expect(await runCli(['outlines', 'dist/hero.webp.atlas', '--pages', 'elsewhere'], missing)).toBe(1);
            expect(missing.errors.join('\n')).toContain(
                'The PNG source of the page "page.webp" was not read from elsewhere/page.png: ENOENT',
            );
            expect(missing.errors.join('\n')).toContain('into elsewhere, as page.png');
            // the half-size variant of an atlas needs PNG sources of half the size
            expect(await runCli(['outlines', 'dist/hero.webp.atlas', '--pages', 'raw'], small)).toBe(1);
            expect(small.errors.join('\n')).toContain('has 4x4 pixels and the atlas states 8x8');
        });
    });
});
