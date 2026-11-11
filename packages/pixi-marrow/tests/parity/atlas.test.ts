import { readFileSync } from 'node:fs';
import { TextureAtlas as Atlas41 } from 'spine-core-4.1';
import { TextureAtlas as Atlas42 } from 'spine-core-4.2';
import { TextureAtlas as Atlas43 } from 'spine-core-4.3';
import { describe, expect, it } from 'vitest';
import type { SpineVersion } from '../../src/base/version';
import { importAtlas } from '../../src/formats/atlas';
import type { AtlasFilter, AtlasModel } from '../../src/model/atlas';
import { differences } from './compare';
import { listFixtures } from './fixtures';

/** The fields of the official atlas classes that the model stores. */
interface OfficialPage {
    name: string;
    width: number;
    height: number;
    minFilter: number;
    magFilter: number;
    uWrap: number;
    vWrap: number;
    pma: boolean;
}

interface OfficialRegion {
    name: string;
    page: OfficialPage;
    x: number;
    y: number;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    originalWidth: number;
    originalHeight: number;
    degrees: number;
    index: number;
    names: string[] | null;
    values: number[][] | null;
}

interface OfficialAtlas {
    pages: OfficialPage[];
    regions: OfficialRegion[];
}

/** WebGL constants the official classes store. */
const FILTERS: Record<number, AtlasFilter> = {
    9728: 'nearest',
    9729: 'linear',
    9984: 'mipMapNearestNearest',
    9985: 'mipMapLinearNearest',
    9986: 'mipMapNearestLinear',
    9987: 'mipMapLinearLinear',
};
const REPEAT = 10497;

function loadOfficial(version: SpineVersion, text: string): OfficialAtlas {
    if (version === '4.1') return new Atlas41(text);
    if (version === '4.2') return new Atlas42(text);

    return new Atlas43(text);
}

/** The model of an atlas as the official class of that version holds it. */
function officialAtlas(version: SpineVersion, text: string): AtlasModel {
    const atlas = loadOfficial(version, text);
    const filter = (value: number): AtlasFilter => FILTERS[value] ?? 'nearest';

    return {
        pages: atlas.pages.map((page) => ({
            name: page.name,
            width: page.width,
            height: page.height,
            minFilter: filter(page.minFilter),
            magFilter: filter(page.magFilter),
            repeatX: page.uWrap === REPEAT,
            repeatY: page.vWrap === REPEAT,
            pma: page.pma,
        })),
        regionNames: atlas.regions.map((region) => region.name),
        regions: Int32Array.from(
            atlas.regions.flatMap((region) => [
                atlas.pages.indexOf(region.page),
                region.x,
                region.y,
                region.width,
                region.height,
                region.offsetX,
                region.offsetY,
                region.originalWidth,
                region.originalHeight,
                region.degrees,
                region.index,
            ]),
        ),
        custom: atlas.regions.flatMap((region, index) =>
            (region.names ?? []).map((name, i) => ({ region: index, name, values: region.values?.[i] ?? [] })),
        ),
    };
}

const atlases = [...new Map(listFixtures().map((fixture) => [fixture.atlasPath, fixture])).values()];

describe.each(atlases)('atlas of $id', (fixture) => {
    it('imports the same atlas the official class holds', () => {
        const text = readFileSync(fixture.atlasPath, 'utf8');

        expect(differences(importAtlas(text), officialAtlas(fixture.version, text))).toEqual([]);
    });
});
