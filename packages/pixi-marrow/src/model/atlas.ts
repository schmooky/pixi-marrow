/** How a texture is sampled when it is drawn smaller or larger than its pixels. */
export type AtlasFilter =
    | 'nearest'
    | 'linear'
    | 'mipMapNearestNearest'
    | 'mipMapLinearNearest'
    | 'mipMapNearestLinear'
    | 'mipMapLinearLinear';

/** Every filter name an atlas can use. `MipMap` in a file means `mipMapLinearLinear`. */
export const ATLAS_FILTERS: readonly AtlasFilter[] = [
    'nearest',
    'linear',
    'mipMapNearestNearest',
    'mipMapLinearNearest',
    'mipMapNearestLinear',
    'mipMapLinearLinear',
];

/** One image of an atlas. */
export interface AtlasPage {
    /** The image file name. */
    name: string;
    width: number;
    height: number;
    minFilter: AtlasFilter;
    magFilter: AtlasFilter;
    repeatX: boolean;
    repeatY: boolean;
    /** True when the image stores colors already multiplied by alpha. */
    pma: boolean;
}

/** Integers per region in {@link AtlasModel.regions}. */
export const ATLAS_REGION_STRIDE = 11;

/** A key of a region that the atlas format does not define, such as the splits of a nine patch. */
export interface AtlasCustomField {
    /** The index of the region the field belongs to. */
    region: number;
    name: string;
    values: number[];
}

/**
 * A texture atlas as its `.atlas` file describes it.
 *
 * Texture coordinates are not stored. They follow from a region's position and its page size.
 */
export interface AtlasModel {
    pages: AtlasPage[];
    /** The name of each region, in file order. Names can repeat: regions of a sequence differ by `index`. */
    regionNames: string[];
    /**
     * Per region, in this order: page index, x, y, width, height, offsetX, offsetY, originalWidth,
     * originalHeight, degrees, index. Positions and sizes are in pixels of the page. `degrees` is
     * the rotation of the region inside the page.
     */
    regions: Int32Array;
    custom: AtlasCustomField[];
}
