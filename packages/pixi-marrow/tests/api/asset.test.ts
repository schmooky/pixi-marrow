import { Assets, Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeSkeleton, importAtlas } from '../../src/core';
import { MarrowAsset, MarrowError, MarrowSpine } from '../../src/index';
import { blankTexture, fixtureFiles, importRig } from './helpers';

const BOY = fixtureFiles('4.2/spineboy-pro.skel');
const BOY_JSON = fixtureFiles('4.2/spineboy-pro.json');
const DRAGON = fixtureFiles('4.3/dragon-ess.skel');
const SACK = fixtureFiles('4.2/sack-pro.skel');

/** Three pages that differ in everything a page can ask of its texture. */
const PAGES = importAtlas(
    [
        'plain.png',
        'size: 8, 8',
        'filter: Nearest, Nearest',
        'pma: true',
        'a',
        'bounds: 0, 0, 4, 4',
        '',
        'mips.png',
        'size: 8, 8',
        'filter: MipMapLinearNearest, Linear',
        'repeat: x',
        'b',
        'bounds: 0, 0, 4, 4',
        '',
        'tiles.png',
        'size: 8, 8',
        'filter: MipMapNearestNearest, Nearest',
        'repeat: xy',
        'c',
        'bounds: 0, 0, 4, 4',
        '',
    ].join('\n'),
);

async function rejection(promise: Promise<unknown>): Promise<MarrowError> {
    const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
    );

    if (!(error instanceof MarrowError)) throw new Error(`expected a MarrowError, got ${String(error)}`);

    return error;
}

describe('MarrowAsset.from', () => {
    it('holds the model, the atlas, the textures in page order, the info and an engine factory', async () => {
        const { model, atlas } = await importRig('4.3/dragon-ess.skel');
        const textures = atlas.pages.map(() => blankTexture());
        const asset = await MarrowAsset.from({ model, atlas, textures });
        const first = asset.createEngine();

        expect(asset.model).toBe(model);
        expect(asset.atlas).toBe(atlas);
        expect(asset.textures).toEqual(textures);
        expect(asset.textures.length).toBeGreaterThan(1);
        expect(asset.info).toEqual(describeSkeleton(model));
        expect(asset.info).toBe(asset.info);
        expect(first.state.model).toBe(model);
        expect(asset.createEngine()).not.toBe(first);
        expect(asset.destroyed).toBe(false);
    });

    it('throws when the textures do not match the pages', async () => {
        const { model, atlas } = await importRig('4.3/dragon-ess.skel');
        const error = await rejection(MarrowAsset.from({ model, atlas, textures: [Texture.WHITE] }));

        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain(`The atlas has ${atlas.pages.length} pages, but 1 textures were passed.`);
        expect(error.fix).toContain('dragon.png, dragon_2.png');
    });

    it.each([
        ['4.2/sack-pro.skel', 'physics'],
        ['4.3/diamond-pro.skel', 'slider'],
    ])('throws for the %s skeleton with %s constraints, unless they are ignored', async (id, kind) => {
        const { model, atlas } = await importRig(id);
        const data = { model, atlas, textures: atlas.pages.map(() => Texture.WHITE) };
        const error = await rejection(MarrowAsset.from(data));

        expect(error.code).toBe('unsupported-feature');
        expect(error.message).toContain(`The skeleton has ${kind} constraints.`);
        expect(await rejection(MarrowAsset.from({ ...data, constraints: 'error' }))).toBeInstanceOf(MarrowError);
        await expect(MarrowAsset.from({ ...data, constraints: 'ignore' })).resolves.toBeInstanceOf(MarrowAsset);
    });

    it('takes a skeleton with IK, transform and path constraints as it is: they are solved', async () => {
        for (const id of ['4.2/spineboy-pro.skel', '4.3/tank-pro.skel']) {
            const { model, atlas } = await importRig(id);
            const kinds = new Set(model.constraints.map((constraint) => constraint.type));

            expect(kinds.size).toBeGreaterThan(1);
            await expect(MarrowAsset.from({ model, atlas, textures: [Texture.WHITE] })).resolves.toBeInstanceOf(
                MarrowAsset,
            );
        }
    });

    it('sets up each texture from its atlas page: alpha mode, filters, mipmaps and wrap', async () => {
        const { model } = await importRig('4.2/coin-pro.skel');
        const textures = PAGES.pages.map(() => blankTexture());

        await MarrowAsset.from({ model, atlas: PAGES, textures });
        const setup = textures.map(({ source }) => ({
            alphaMode: source.alphaMode,
            min: source.style.minFilter,
            mag: source.style.magFilter,
            mipmaps: source.autoGenerateMipmaps,
            u: source.style.addressModeU,
            v: source.style.addressModeV,
        }));

        expect(setup).toEqual([
            {
                alphaMode: 'premultiplied-alpha',
                min: 'nearest',
                mag: 'nearest',
                mipmaps: false,
                u: 'clamp-to-edge',
                v: 'clamp-to-edge',
            },
            {
                alphaMode: 'premultiply-alpha-on-upload',
                min: 'linear',
                mag: 'linear',
                mipmaps: true,
                u: 'repeat',
                v: 'clamp-to-edge',
            },
            {
                alphaMode: 'premultiply-alpha-on-upload',
                min: 'nearest',
                mag: 'nearest',
                mipmaps: true,
                u: 'repeat',
                v: 'repeat',
            },
        ]);
    });

    it('tells Pixi when a texture changes: the sampler always, the texels with the alpha mode', async () => {
        const { model } = await importRig('4.2/coin-pro.skel');
        const textures = PAGES.pages.map(() => blankTexture());
        const uploads = textures.map(({ source }) => {
            const upload = vi.fn();

            source.on('update', upload);

            return upload;
        });
        const samplers = textures.map(({ source }) => {
            const sampler = vi.fn();

            source.style.on('change', sampler);

            return sampler;
        });

        await MarrowAsset.from({ model, atlas: PAGES, textures });

        // a new texture premultiplies on upload, which only the first page does not want
        expect(uploads.map((upload) => upload.mock.calls.length)).toEqual([1, 0, 0]);
        expect(samplers.map((sampler) => sampler.mock.calls.length)).toEqual([1, 1, 1]);
    });
});

describe('MarrowAsset.load', () => {
    const files = new Map<string, string | Uint8Array>([
        ['art/boy.skel', BOY.skeleton],
        ['art/boy.json', BOY_JSON.skeleton],
        ['art/boy.json?v=2', BOY_JSON.skeleton],
        ['art/boy.atlas', BOY.atlas],
        ['art/boy.atlas?v=2', BOY.atlas],
        ['dragon.skel', DRAGON.skeleton],
        ['dragon.atlas', DRAGON.atlas],
        ['sack.skel', SACK.skeleton],
        ['sack.atlas', SACK.atlas],
    ]);
    /** How each fetched body was read, for example `art/boy.json text`. */
    let reads: string[];
    const assets: MarrowAsset[] = [];
    const fetched = vi.fn(async (url: string): Promise<Response> => {
        const body = files.get(url);

        if (body === undefined) return new Response('', { status: 404 });
        const response = new Response(typeof body === 'string' ? body : body.slice());
        const text = response.text.bind(response);
        const arrayBuffer = response.arrayBuffer.bind(response);

        response.text = () => {
            reads.push(`${url} text`);

            return text();
        };
        response.arrayBuffer = () => {
            reads.push(`${url} bytes`);

            return arrayBuffer();
        };

        return response;
    });
    /** Pixi `Assets`, typed as loosely as the stubs below answer. */
    const pixiAssets: { load(asset: unknown): Promise<unknown>; unload(url: unknown): Promise<void> } = Assets;
    const loadImage = vi.spyOn(pixiAssets, 'load');
    const unloadImage = vi.spyOn(pixiAssets, 'unload');

    async function load(options: Parameters<typeof MarrowAsset.load>[0]): Promise<MarrowAsset> {
        const asset = await MarrowAsset.load(options);

        if (!assets.includes(asset)) assets.push(asset);

        return asset;
    }

    /** What Pixi `Assets` was asked to load. */
    const requests = (): unknown[] => loadImage.mock.calls.map(([asset]) => asset);

    beforeEach(() => {
        reads = [];
        vi.stubGlobal('fetch', fetched);
        fetched.mockClear();
        loadImage.mockReset().mockImplementation(async () => blankTexture());
        unloadImage.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => {
        for (const asset of assets.splice(0)) asset.destroy();
        vi.unstubAllGlobals();
    });

    it('fetches a .skel URL as bytes and loads the page image from next to the atlas', async () => {
        const asset = await load({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', constraints: 'ignore' });
        const { model } = await importRig('4.2/spineboy-pro.skel');

        expect(reads.sort()).toEqual(['art/boy.atlas text', 'art/boy.skel bytes']);
        expect(asset.info).toEqual(describeSkeleton(model));
        expect(asset.atlas.pages.map((page) => page.name)).toEqual(['spineboy.png']);
        expect(requests()).toEqual([{ src: 'art/spineboy.png', data: { alphaMode: 'premultiply-alpha-on-upload' } }]);
        expect(asset.textures).toHaveLength(1);
        expect(asset.textures[0]?.source.style.minFilter).toBe('linear');
    });

    it('fetches a .json URL as text, and keeps the query of the atlas URL for the image', async () => {
        const asset = await load({ skeleton: 'art/boy.json?v=2', atlas: 'art/boy.atlas?v=2', constraints: 'ignore' });

        expect(reads.sort()).toEqual(['art/boy.atlas?v=2 text', 'art/boy.json?v=2 text']);
        expect(asset.info.animations.map((animation) => animation.name)).toContain('walk');
        expect(requests()).toMatchObject([{ src: 'art/spineboy.png?v=2' }]);
    });

    it('takes bytes, an ArrayBuffer or parsed JSON and fetches the atlas alone', async () => {
        const bytes = BOY.skeleton instanceof Uint8Array ? BOY.skeleton : new Uint8Array();
        const json: object = JSON.parse(typeof BOY_JSON.skeleton === 'string' ? BOY_JSON.skeleton : '{}');
        const { model } = await importRig('4.2/spineboy-pro.skel');

        for (const skeleton of [bytes, bytes.slice().buffer, json]) {
            const asset = await load({ skeleton, atlas: 'art/boy.atlas', constraints: 'ignore' });

            expect(asset.info.counts).toEqual(describeSkeleton(model).counts);
        }
        expect(fetched.mock.calls.map(([url]) => url)).toEqual(['art/boy.atlas', 'art/boy.atlas', 'art/boy.atlas']);
        // without a skeleton URL nothing says that two loads are the same
        expect(new Set(assets).size).toBe(3);
    });

    it('uses the textures and image URLs it is given, by page name', async () => {
        const mine = blankTexture();
        const asset = await load({
            skeleton: 'dragon.skel',
            atlas: 'dragon.atlas',
            textures: { 'dragon.png': mine, 'dragon_3.png': 'cdn/three.webp' },
        });

        expect(asset.textures[0]).toBe(mine);
        expect(requests().map((request) => Reflect.get(Object(request), 'src'))).toEqual([
            'dragon_2.png',
            'cdn/three.webp',
            'dragon_4.png',
            'dragon_5.png',
            'dragon_6.png',
        ]);
        expect(asset.textures).toHaveLength(6);
        expect(mine.source.alphaMode).toBe('premultiply-alpha-on-upload');
    });

    it('throws for a texture named after no page of the atlas', async () => {
        const error = await rejection(
            MarrowAsset.load({
                skeleton: 'dragon.skel',
                atlas: 'dragon.atlas',
                textures: { 'dragon-2.png': blankTexture() },
            }),
        );

        expect(error.code).toBe('unknown-name');
        expect(error.message).toContain('The atlas has no page "dragon-2.png". The closest name is "dragon_2.png".');
        expect(error.closest).toBe('dragon_2.png');
        expect(error.validNames).toHaveLength(6);
        expect(loadImage).not.toHaveBeenCalled();
    });

    it('shares one asset between loads of the same URLs and options', async () => {
        const options = { skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', constraints: 'ignore' } as const;
        const [first, second] = await Promise.all([load(options), load({ ...options })]);
        const third = await load(options);

        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(fetched).toHaveBeenCalledTimes(2);
        expect(loadImage).toHaveBeenCalledOnce();
    });

    it('does not share between different URLs or options', async () => {
        const mine = blankTexture();
        const base = { skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', constraints: 'ignore' } as const;
        const loaded = [
            await load(base),
            await load({ ...base, skeleton: 'art/boy.json' }),
            await load({ ...base, atlas: 'art/boy.atlas?v=2' }),
            await load({ ...base, textures: { 'spineboy.png': mine } }),
            await load({ ...base, textures: { 'spineboy.png': blankTexture() } }),
            await load({ ...base, textures: { 'spineboy.png': 'cdn/boy.png' } }),
        ];

        expect(new Set(loaded).size).toBe(6);
        expect(await load({ ...base, textures: { 'spineboy.png': mine } })).toBe(loaded[3]);
    });

    it('unloads the images it loaded when it is destroyed, and not the textures it was given', async () => {
        const mine = blankTexture();
        const destroyed = vi.spyOn(mine, 'destroy');
        const options = { skeleton: 'dragon.skel', atlas: 'dragon.atlas', textures: { 'dragon.png': mine } };
        const asset = await load(options);

        asset.destroy();
        asset.destroy();

        expect(asset.destroyed).toBe(true);
        expect(unloadImage.mock.calls).toEqual([
            ['dragon_2.png'],
            ['dragon_3.png'],
            ['dragon_4.png'],
            ['dragon_5.png'],
            ['dragon_6.png'],
        ]);
        expect(destroyed).not.toHaveBeenCalled();
        // the next load starts over
        expect(await load(options)).not.toBe(asset);
    });

    it('keeps an image loaded while another asset holds it', async () => {
        const fromBytes = await load({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', constraints: 'ignore' });
        const fromJson = await load({ skeleton: 'art/boy.json', atlas: 'art/boy.atlas', constraints: 'ignore' });

        fromBytes.destroy();
        expect(unloadImage).not.toHaveBeenCalled();
        fromJson.destroy();

        expect(unloadImage).toHaveBeenCalledExactlyOnceWith('art/spineboy.png');
    });

    it('throws when a file is missing or the request fails, and can be tried again', async () => {
        const options = { skeleton: 'art/boy.skel', atlas: 'art/missing.atlas', constraints: 'ignore' } as const;
        const missing = await rejection(MarrowAsset.load(options));

        fetched.mockRejectedValueOnce(new TypeError('network down'));
        const failed = await rejection(
            MarrowAsset.load({ ...options, skeleton: 'art/boy.json', atlas: 'art/boy.atlas' }),
        );

        expect(missing.code).toBe('invalid-data');
        expect(missing.message).toContain('The atlas at art/missing.atlas did not load: status 404.');
        expect(failed.message).toContain('The skeleton at art/boy.json did not load: network down');
        expect(loadImage).not.toHaveBeenCalled();

        files.set('art/missing.atlas', BOY.atlas);
        await expect(load(options)).resolves.toBeInstanceOf(MarrowAsset);
        files.delete('art/missing.atlas');
    });

    it('throws when an image does not load, and gives back the ones that did', async () => {
        loadImage.mockImplementation(async (asset) => {
            if (Reflect.get(Object(asset), 'src') === 'dragon_3.png') throw new Error('decode failed');

            return blankTexture();
        });
        const error = await rejection(MarrowAsset.load({ skeleton: 'dragon.skel', atlas: 'dragon.atlas' }));

        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain('The page image "dragon_3.png" did not load: decode failed');
        expect(unloadImage.mock.calls.map(([url]) => url).sort()).toEqual([
            'dragon.png',
            'dragon_2.png',
            'dragon_4.png',
            'dragon_5.png',
            'dragon_6.png',
        ]);
    });

    it('throws when Pixi loads a page as something that is not a texture', async () => {
        loadImage.mockImplementation(async () => ({ data: 'not a texture' }));
        const error = await rejection(
            MarrowAsset.load({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas', constraints: 'ignore' }),
        );

        expect(error.code).toBe('invalid-data');
        expect(error.message).toContain('Pixi loaded "spineboy.png" from art/spineboy.png, but not as a texture.');
        expect(unloadImage).toHaveBeenCalledExactlyOnceWith('art/spineboy.png');
    });

    it('throws for a skeleton with physics constraints before it loads an image', async () => {
        const error = await rejection(MarrowAsset.load({ skeleton: 'sack.skel', atlas: 'sack.atlas' }));

        expect(error.code).toBe('unsupported-feature');
        expect(error.message).toContain('The skeleton has physics constraints.');
        expect(loadImage).not.toHaveBeenCalled();
        // spineboy has IK and transform constraints, which are solved
        await expect(load({ skeleton: 'art/boy.skel', atlas: 'art/boy.atlas' })).resolves.toBeInstanceOf(MarrowAsset);
    });

    describe('MarrowSpine.load', () => {
        it('loads the asset and creates a display object for it', async () => {
            const options = { skeleton: 'dragon.skel', atlas: 'dragon.atlas', autoUpdate: false } as const;
            const first = await MarrowSpine.load(options);
            const second = await MarrowSpine.load(options);

            assets.push(first.asset);
            expect(first).toBeInstanceOf(MarrowSpine);
            expect(first.autoUpdate).toBe(false);
            expect(second).not.toBe(first);
            expect(second.asset).toBe(first.asset);
            expect(first.asset).toBe(await MarrowAsset.load({ skeleton: 'dragon.skel', atlas: 'dragon.atlas' }));
            expect(first.play('flying', { loop: true }).animation).toBe('flying');
            first.destroy();
            second.destroy();
        });

        it('refuses an asset that was destroyed', async () => {
            const asset = await load({ skeleton: 'dragon.skel', atlas: 'dragon.atlas' });

            asset.destroy();

            expect(() => new MarrowSpine(asset, { autoUpdate: false })).toThrow('The asset was destroyed.');
        });
    });
});
