import { Assets, Texture, TextureSource } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarrowAsset, MarrowError } from '../../src/index';
import { fixtureFiles } from './helpers';
import { type ImageLoader, stubFetch, stubImageLoader, useLocalUrls } from './urls';

/*
 * How `MarrowAsset.load` gets from the URLs of its options to its files: one resolver for all
 * of them, the content of a file and not its name, and errors that name the URL.
 */

const BOY = fixtureFiles('4.2/spineboy-pro.skel');
const BOY_JSON = fixtureFiles('4.2/spineboy-pro.json');
const HTML = '<!doctype html>\n<html><head><title>My game</title></head><body></body></html>';
/** One page that is premultiplied and one that is not. */
const TWO_PAGES = [
    'pma.png',
    'size: 8, 8',
    'pma: true',
    'a',
    'bounds: 0, 0, 4, 4',
    '',
    'straight.png',
    'size: 8, 8',
    'b',
    'bounds: 0, 0, 4, 4',
    '',
];
const files = new Map<string, string | Uint8Array>([
    ['art/boy.skel', BOY.skeleton],
    ['art/boy.json', BOY_JSON.skeleton],
    ['art/boy.atlas', BOY.atlas],
    ['art/two.atlas', TWO_PAGES.join('\n')],
]);
let images: ImageLoader;
let fetched: { readonly urls: string[] };
const made: MarrowAsset[] = [];

async function load(options: Parameters<typeof MarrowAsset.load>[0]): Promise<MarrowAsset> {
    const asset = await MarrowAsset.load(options);

    made.push(asset);

    return asset;
}

async function rejection(promise: Promise<unknown>): Promise<MarrowError> {
    const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
    );

    if (!(error instanceof MarrowError)) throw new Error(`expected a MarrowError, got ${String(error)}`);

    return error;
}

useLocalUrls();
beforeEach(() => {
    images = stubImageLoader();
    fetched = stubFetch(files);
});
afterEach(() => {
    for (const asset of made.splice(0)) asset.destroy();
    images.restore();
    Assets.resolver.reset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the base path and the search params of Pixi Assets', () => {
    const CDN = 'https://cdn.test/game/';

    it('apply once to the skeleton, the atlas, the outlines file, the pages and a given image URL', async () => {
        files.set(`${CDN}art/boy.skel?v=7`, BOY.skeleton);
        files.set(`${CDN}art/boy.atlas?v=7`, BOY.atlas);
        files.set(`${CDN}art/two.atlas?v=7`, TWO_PAGES.join('\n'));
        Assets.resolver.basePath = CDN;
        Assets.resolver.setDefaultSearchParams({ v: 7 });

        const boy = await load({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' });
        const two = await load({
            skeleton: 'art/boy.skel',
            atlas: 'art/two.atlas',
            textures: { 'straight.png': 'shared/straight.webp' },
        });
        const missing = await rejection(
            MarrowAsset.load({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', outlines: 'art/none.json' }),
        );

        expect(boy.textures).toHaveLength(1);
        expect(two.textures).toHaveLength(2);
        expect([...new Set(fetched.urls)].sort()).toEqual([
            `${CDN}art/boy.atlas?v=7`,
            `${CDN}art/boy.skel?v=7`,
            `${CDN}art/none.json?v=7`,
            `${CDN}art/two.atlas?v=7`,
        ]);
        // the pages come from next to the atlas as it was fetched: no base path twice, no query twice
        expect(images.loads.map(({ src }) => src)).toEqual([
            `${CDN}art/spineboy.png?v=7`,
            `${CDN}art/pma.png?v=7`,
            `${CDN}shared/straight.webp?v=7`,
        ]);
        expect(missing.message).toContain(`The outlines file at ${CDN}art/none.json?v=7 did not load: status 404.`);
        for (const url of [...files.keys()]) if (url.startsWith(CDN)) files.delete(url);
    });

    it('leave a blob URL and an absolute URL as they are, apart from the search params', async () => {
        files.set('blob:http://localhost/1b9d', BOY_JSON.skeleton);
        files.set('https://other.test/boy.atlas?v=7', BOY.atlas);
        Assets.resolver.basePath = CDN;
        Assets.resolver.setDefaultSearchParams('v=7');

        const asset = await load({ skeleton: 'blob:http://localhost/1b9d', atlas: 'https://other.test/boy.atlas' });

        expect(asset.info.animations.map((animation) => animation.name)).toContain('walk');
        expect(fetched.urls.sort()).toEqual(['blob:http://localhost/1b9d', 'https://other.test/boy.atlas?v=7']);
        expect(images.loads.map(({ src }) => src)).toEqual(['https://other.test/spineboy.png?v=7']);
        files.delete('blob:http://localhost/1b9d');
        files.delete('https://other.test/boy.atlas?v=7');
    });
});

describe('a skeleton URL without a telling name', () => {
    it.each([
        ['a hash in the name', 'assets/boy-3f2a91c0'],
        ['a query', 'api/skeleton?id=boy&format=json'],
        ['a .skel name', 'art/json-inside.skel'],
        ['a blob', 'blob:http://localhost/77aa'],
    ])('loads JSON from a URL with %s', async (_, url) => {
        files.set(url, BOY_JSON.skeleton);
        const asset = await load({ skeleton: url, atlas: 'art/boy.atlas' });

        expect(asset.model.version).toBe('4.2');
        expect(asset.info.animations.map((animation) => animation.name)).toContain('walk');
        files.delete(url);
    });

    it('loads a binary skeleton from a URL that ends in .json', async () => {
        files.set('art/binary-inside.json', BOY.skeleton);
        const asset = await load({ skeleton: 'art/binary-inside.json', atlas: 'art/boy.atlas' });

        expect(asset.info.animations.map((animation) => animation.name)).toContain('walk');
        files.delete('art/binary-inside.json');
    });
});

describe('an error of a load', () => {
    it('says that the server returned an HTML page, for the skeleton and for the atlas', async () => {
        files.set('art/typo.skel', HTML);
        files.set('art/typo.json', new TextEncoder().encode(`\n${HTML}`));
        files.set('art/typo.atlas', HTML);
        const skel = await rejection(MarrowAsset.load({ skeleton: 'art/typo.skel', atlas: 'art/boy.atlas' }));
        const json = await rejection(MarrowAsset.load({ skeleton: 'art/typo.json', atlas: 'art/boy.atlas' }));
        const atlas = await rejection(MarrowAsset.load({ skeleton: 'art/boy.skel', atlas: 'art/typo.atlas' }));

        expect(skel.code).toBe('invalid-data');
        expect(skel.message).toContain(
            'The server returned an HTML page for the skeleton at art/typo.skel, not the file.',
        );
        expect(skel.message).toContain('The URL is probably wrong.');
        expect(skel.fix).toContain('index page and status 200');
        expect(json.message).toContain('an HTML page for the skeleton at art/typo.json');
        expect(atlas.message).toContain(
            'The server returned an HTML page for the atlas at art/typo.atlas, not the file.',
        );
        expect(images.loads).toEqual([]);
        for (const url of ['art/typo.skel', 'art/typo.json', 'art/typo.atlas']) files.delete(url);
    });

    it('names the URL of a file that is not valid, and keeps the code and the details of the error', async () => {
        files.set('art/old.json', '{"skeleton":{"spine":"3.8.99"},"bones":[]}');
        files.set('art/noise.skel', new Uint8Array(64).fill(7));
        files.set('art/odd.atlas', 'page.png\nsize: 8, 8\nfilter: Smooth, Smooth\n');
        files.set('art/other.outlines.json', '{"version":1,"margin":1,"opaqueMargin":1,"regions":[]}');
        const old = await rejection(MarrowAsset.load({ skeleton: 'art/old.json', atlas: 'art/boy.atlas' }));
        const noise = await rejection(MarrowAsset.load({ skeleton: 'art/noise.skel', atlas: 'art/boy.atlas' }));
        const odd = await rejection(MarrowAsset.load({ skeleton: 'art/boy.skel', atlas: 'art/odd.atlas' }));
        const other = await rejection(
            MarrowAsset.load({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', outlines: 'art/other.outlines.json' }),
        );
        const gone = await rejection(MarrowAsset.load({ skeleton: 'art/none.skel', atlas: 'art/boy.atlas' }));

        expect(old.code).toBe('unsupported-version');
        expect(old.message).toContain(
            'The skeleton at art/old.json is not valid. The skeleton was exported from Spine 3.8.99.',
        );
        expect(old.validNames).toEqual(['4.1', '4.2', '4.3']);
        expect(old.fix).toBe('Export it again from Spine 4.1, 4.2 or 4.3.');
        expect(noise.message).toContain(
            'The skeleton at art/noise.skel is not valid. The binary skeleton has no version string',
        );
        expect(odd.message).toContain(
            'The atlas at art/odd.atlas is not valid. The atlas uses the unknown texture filter "Smooth".',
        );
        expect(other.message).toContain(
            'The outlines file at art/other.outlines.json is not valid. The outlines file does not fit',
        );
        expect(gone.message).toContain('The skeleton at art/none.skel did not load: status 404.');
        for (const url of ['art/old.json', 'art/noise.skel', 'art/odd.atlas', 'art/other.outlines.json'])
            files.delete(url);
    });

    it('does not name a URL for a skeleton that was passed in memory', async () => {
        const error = await rejection(MarrowAsset.load({ skeleton: new Uint8Array(64), atlas: 'art/boy.atlas' }));

        expect(error.message).toContain('[pixi-marrow:invalid-data] The binary skeleton has no version string');
    });
});

describe('a page image that was loaded before in another alpha mode', () => {
    it('warns once with the URL and the fix, and not for a page in the right mode', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        // the game loads both pages itself, without the alpha mode that the premultiplied page needs
        await Assets.loader.load('art/pma.png');
        await Assets.loader.load('art/straight.png');
        const first = await load({ skeleton: 'art/boy.skel', atlas: 'art/two.atlas' });

        await load({ skeleton: 'art/boy.json', atlas: 'art/two.atlas' });

        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]?.[0]).toContain(
            'the page image at art/pma.png was loaded before with the alpha mode',
        );
        expect(warn.mock.calls[0]?.[0]).toContain(
            '"premultiply-alpha-on-upload", but the atlas page "pma.png" needs "premultiplied-alpha"',
        );
        expect(warn.mock.calls[0]?.[0]).toContain("data: { alphaMode: 'premultiplied-alpha' }");
        // the texture is the game's: it is used, and never unloaded
        expect(first.textures[0]).toBe(images.texture('art/pma.png'));
    });

    it('does not warn for pages that pixi-marrow loads first, or for textures that are passed in', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const mine = new Texture({ source: new TextureSource({ width: 8, height: 8 }) });
        const asset = await load({ skeleton: 'art/boy.skel', atlas: 'art/two.atlas', textures: { 'pma.png': mine } });

        expect(warn).not.toHaveBeenCalled();
        expect(asset.textures[0]?.source.alphaMode).toBe('premultiplied-alpha');
        expect(images.loads.map(({ src, data }) => [src, data.alphaMode])).toEqual([
            ['art/straight.png', 'premultiply-alpha-on-upload'],
        ]);
    });
});
