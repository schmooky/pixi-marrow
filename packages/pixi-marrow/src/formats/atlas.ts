import { MarrowError } from '../base/errors';
import {
    ATLAS_FILTERS,
    type AtlasCustomField,
    type AtlasFilter,
    type AtlasModel,
    type AtlasPage,
} from '../model/atlas';

/** A `name: a, b, c, d` line: the name and up to four values. */
interface Entry {
    name: string;
    values: string[];
}

/** The most values a line can have. Text after the fourth comma stays in the fourth value. */
const MAX_VALUES = 4;

function readEntry(line: string | undefined): Entry | null {
    const text = line?.trim() ?? '';
    const colon = text.indexOf(':');

    if (colon === -1) return null;
    const values: string[] = [];
    let start = colon + 1;

    while (values.length < MAX_VALUES - 1) {
        const comma = text.indexOf(',', start);

        if (comma === -1) break;
        values.push(text.slice(start, comma).trim());
        start = comma + 1;
    }
    const rest = text.slice(start);
    const comma = rest.indexOf(',');

    // a fifth value and anything after it is dropped
    values.push((values.length === MAX_VALUES - 1 && comma !== -1 ? rest.slice(0, comma) : rest).trim());

    return { name: text.slice(0, colon).trim(), values };
}

const int = (text: string | undefined): number => Number.parseInt(text ?? '', 10);

function filter(text: string | undefined): AtlasFilter {
    const name = text === 'MipMap' ? 'mipMapLinearLinear' : `${text?.charAt(0).toLowerCase()}${text?.slice(1)}`;
    const found = ATLAS_FILTERS.find((candidate) => candidate === name);

    if (found === undefined) {
        throw new MarrowError('invalid-data', `The atlas uses the unknown texture filter "${text}".`, {
            fix: 'Export the atlas again from Spine or the texture packer.',
            validNames: ATLAS_FILTERS,
        });
    }

    return found;
}

function readPage(name: string, lines: string[], at: number): { page: AtlasPage; next: number } {
    const page: AtlasPage = {
        name,
        width: 0,
        height: 0,
        minFilter: 'nearest',
        magFilter: 'nearest',
        repeatX: false,
        repeatY: false,
        pma: false,
    };
    let next = at;

    for (let entry = readEntry(lines[next]); entry !== null; entry = readEntry(lines[++next])) {
        const [first, second] = entry.values;

        if (entry.name === 'size') {
            page.width = int(first);
            page.height = int(second);
        } else if (entry.name === 'filter') {
            page.minFilter = filter(first);
            page.magFilter = filter(second);
        } else if (entry.name === 'repeat') {
            page.repeatX = first?.includes('x') ?? false;
            page.repeatY = first?.includes('y') ?? false;
        } else if (entry.name === 'pma') {
            page.pma = first === 'true';
        }
    }

    return { page, next };
}

/** Field offsets inside one region of `AtlasModel.regions`. */
const X = 1;
const WIDTH = 3;
const OFFSET_X = 5;
const ORIGINAL_WIDTH = 7;
const DEGREES = 9;
const INDEX = 10;

function applyRegionField(region: number[], entry: Entry): boolean {
    const numbers = entry.values.map(int);
    const [a = Number.NaN, b = Number.NaN, c = Number.NaN, d = Number.NaN] = numbers;

    switch (entry.name) {
        case 'xy':
            region.splice(X, 2, a, b);
            break;
        case 'size':
            region.splice(WIDTH, 2, a, b);
            break;
        case 'bounds':
            region.splice(X, 4, a, b, c, d);
            break;
        case 'offset':
            region.splice(OFFSET_X, 2, a, b);
            break;
        case 'orig':
            region.splice(ORIGINAL_WIDTH, 2, a, b);
            break;
        case 'offsets':
            region.splice(OFFSET_X, 4, a, b, c, d);
            break;
        case 'rotate':
            if (entry.values[0] === 'true') region[DEGREES] = 90;
            else if (entry.values[0] !== 'false') region[DEGREES] = a;
            break;
        case 'index':
            region[INDEX] = a;
            break;
        default:
            return false;
    }

    return true;
}

/**
 * Reads the text of a `.atlas` file, the way the official `TextureAtlas` reads it.
 * Throws a {@link MarrowError} when the text holds no page or names an unknown texture filter.
 *
 * @example
 * const atlas = importAtlas(await (await fetch('hero.atlas')).text());
 * console.log(atlas.pages.map((page) => page.name), atlas.regionNames.length);
 */
export function importAtlas(text: string): AtlasModel {
    const lines = text.split(/\r\n|\r|\n/);
    const pages: AtlasPage[] = [];
    const regionNames: string[] = [];
    const regions: number[] = [];
    const custom: AtlasCustomField[] = [];
    let at = 0;

    // blank lines, then header fields that are ignored, up to the first line that is not a field
    while (at < lines.length && lines[at]?.trim() === '') at++;
    while (readEntry(lines[at]) !== null) at++;

    let inPage = false;

    while (at < lines.length) {
        const line = lines[at] ?? '';

        if (line.trim() === '') {
            inPage = false;
            at++;
        } else if (!inPage) {
            const { page, next } = readPage(line.trim(), lines, at + 1);

            pages.push(page);
            inPage = true;
            at = next;
        } else {
            const region = [pages.length - 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

            at++;
            for (let entry = readEntry(lines[at]); entry !== null; entry = readEntry(lines[++at])) {
                if (!applyRegionField(region, entry)) {
                    custom.push({ region: regionNames.length, name: entry.name, values: entry.values.map(int) });
                }
            }
            // a region without an original size is not trimmed
            if (region[ORIGINAL_WIDTH] === 0 && region[ORIGINAL_WIDTH + 1] === 0) {
                region.splice(ORIGINAL_WIDTH, 2, region[WIDTH] ?? 0, region[WIDTH + 1] ?? 0);
            }
            regionNames.push(line);
            regions.push(...region);
        }
    }
    if (pages.length === 0) {
        throw new MarrowError('invalid-data', 'The atlas text holds no page.', {
            fix: 'Pass the text of the .atlas file that was exported with the skeleton.',
        });
    }

    return { pages, regionNames, regions: Int32Array.from(regions), custom };
}
