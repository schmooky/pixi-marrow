/*
 * The files of the playground: what a drop, a file picker or a folder picker hands over, and
 * how they make rigs. A rig is a skeleton, the atlas it uses and an image for every page of
 * that atlas. The files can lie in any folders, and a page image may have another format than
 * the atlas names: `hero.png` in the atlas finds `hero.avif` or `hero.webp`.
 */

/** A file with its path inside what was dropped, folders joined by `/`. */
export interface PickedFile {
    file: File;
    path: string;
}

/** A skeleton with its atlas and its page images, ready to load. */
export interface RigFiles {
    /** The name the playground shows: the file name of the skeleton without its extension. */
    name: string;
    skeleton: PickedFile;
    atlas: PickedFile;
    /** The image of every page, by the page name of the atlas. */
    pages: Map<string, PickedFile>;
}

/** A skeleton that cannot load, and why. */
export interface RigProblem {
    name: string;
    reason: string;
}

/** What a set of files makes. */
export interface Sorted {
    rigs: RigFiles[];
    problems: RigProblem[];
    /** Files that are no skeleton, atlas or image, such as a readme. */
    ignored: number;
}

const IMAGE = /\.(png|jpe?g|webp|avif)$/i;
const ATLAS = /\.atlas(\.txt)?$/i;
const SKEL = /\.skel(\.bytes)?$/i;
const JSON_FILE = /\.json$/i;

/** The folder of a path, with a trailing `/`, or empty. */
const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/') + 1);

/** The name of a path without its folder. */
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** A name without the extensions the playground knows, lower case: `Hero.skel.bytes` is `hero`. */
const stemOf = (path: string): string =>
    baseOf(path)
        .replace(/\.(skel\.bytes|atlas\.txt|skel|atlas|json|png|jpe?g|webp|avif)$/i, '')
        .toLowerCase();

/** The files of a file list, as a drop without folder entries hands them over. */
function fromFileList(list: FileList): PickedFile[] {
    return Array.from(list, (file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Reads every entry of a folder. A browser hands them over in parts, so it asks until none come. */
async function readFolder(folder: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = folder.createReader();
    const all: FileSystemEntry[] = [];

    for (;;) {
        const part = await new Promise<FileSystemEntry[]>((done, fail) => reader.readEntries(done, fail));

        if (part.length === 0) return all;
        all.push(...part);
    }
}

/** The files below an entry of a drop, with their paths. */
async function walk(entry: FileSystemEntry, out: PickedFile[]): Promise<void> {
    if (entry.isFile) {
        const file = await new Promise<File>((done, fail) => (entry as FileSystemFileEntry).file(done, fail));

        out.push({ file, path: entry.fullPath.replace(/^\//, '') });
    } else if (entry.isDirectory) {
        for (const child of await readFolder(entry as FileSystemDirectoryEntry)) await walk(child, out);
    }
}

/**
 * The files of a drop, folders included. A browser without entries hands over the files at the
 * top only.
 *
 * @example
 * window.addEventListener('drop', async (event) => console.log(await fromDrop(event.dataTransfer)));
 */
export async function fromDrop(transfer: DataTransfer): Promise<PickedFile[]> {
    const entries = Array.from(transfer.items, (item) => item.webkitGetAsEntry?.() ?? null);

    if (entries.some((entry) => entry === null)) return fromFileList(transfer.files);
    const out: PickedFile[] = [];

    for (const entry of entries) if (entry !== null) await walk(entry, out);

    return out;
}

/** The page names of an atlas: its first line, and every first line after an empty one. */
function pageNames(atlasText: string): string[] {
    const lines = atlasText.split(/\r?\n/).map((line) => line.trim());

    return lines.filter((line, i) => line !== '' && !line.includes(':') && (i === 0 || lines[i - 1] === ''));
}

/** True for a JSON file that a Spine editor exported: it names the version of Spine. */
async function isSkeletonJson(file: File): Promise<boolean> {
    const head = await file.slice(0, 4096).text();

    return /"skeleton"\s*:\s*\{/.test(head) && /"spine"\s*:\s*"\d/.test(head);
}

/** The one of some files that lies nearest to a folder: in it, then in the folder above, and so on. */
function nearest(files: readonly PickedFile[], folder: string): PickedFile | undefined {
    let best: PickedFile | undefined;
    let bestShared = -1;

    for (const picked of files) {
        const other = folderOf(picked.path);
        let shared = 0;

        while (shared < other.length && shared < folder.length && other[shared] === folder[shared]) shared++;
        if (shared > bestShared) {
            best = picked;
            bestShared = shared;
        }
    }

    return best;
}

/**
 * The names an atlas of a skeleton can have: its own, then shorter ones without the last part
 * after a hyphen. The official examples name `spineboy-pro.skel` and `spineboy.atlas` so.
 */
function atlasNames(skeleton: PickedFile): string[] {
    const names = [stemOf(skeleton.path)];

    for (let name = names[0] ?? ''; name.includes('-'); ) {
        name = name.slice(0, name.lastIndexOf('-'));
        names.push(name);
    }

    return names;
}

/**
 * The atlas of a skeleton: one with its name or a shorter one, nearest first. Else the only
 * atlas in its folder, else the only atlas of all.
 */
function atlasFor(skeleton: PickedFile, atlases: readonly PickedFile[]): PickedFile | undefined {
    for (const name of atlasNames(skeleton)) {
        const named = atlases.filter((atlas) => stemOf(atlas.path) === name);

        if (named.length > 0) return nearest(named, folderOf(skeleton.path));
    }
    const beside = atlases.filter((atlas) => folderOf(atlas.path) === folderOf(skeleton.path));

    if (beside.length === 1) return beside[0];

    return atlases.length === 1 ? atlases[0] : undefined;
}

/**
 * The image of an atlas page: the file at the path the atlas names, else a file with its name,
 * else a file with its name in another image format. Nearest to the atlas first.
 */
function imageFor(page: string, atlas: PickedFile, images: readonly PickedFile[]): PickedFile | undefined {
    const folder = folderOf(atlas.path);
    const exact = images.find((image) => image.path === folder + page);

    if (exact !== undefined) return exact;
    const named = images.filter((image) => baseOf(image.path).toLowerCase() === baseOf(page).toLowerCase());

    if (named.length > 0) return nearest(named, folder);
    const stem = stemOf(page);

    return nearest(
        images.filter((image) => stemOf(image.path) === stem),
        folder,
    );
}

/** The files a set is sorted from, by kind. */
interface Kinds {
    atlases: readonly PickedFile[];
    images: readonly PickedFile[];
    /** The page names of each atlas, read once. */
    pagesOf: Map<PickedFile, string[]>;
}

/** The rig of one skeleton, or the problem that keeps it from loading. */
async function matchRig(skeleton: PickedFile, name: string, kinds: Kinds): Promise<RigFiles | RigProblem> {
    const atlas = atlasFor(skeleton, kinds.atlases);

    if (atlas === undefined) {
        const reason =
            kinds.atlases.length === 0
                ? 'No .atlas file was dropped.'
                : 'No atlas has its name or lies alone in its folder.';

        return { name, reason };
    }
    let pages = kinds.pagesOf.get(atlas);

    if (pages === undefined) {
        pages = pageNames(await atlas.file.text());
        kinds.pagesOf.set(atlas, pages);
    }
    const found = new Map<string, PickedFile>();
    const missing: string[] = [];

    for (const page of pages) {
        const image = imageFor(page, atlas, kinds.images);

        if (image === undefined) missing.push(page);
        else found.set(page, image);
    }

    return missing.length > 0
        ? { name, reason: `No image for the page ${missing.join(', ')}.` }
        : { name, skeleton, atlas, pages: found };
}

/** The skeletons among some files: binary files, and JSON files that a Spine editor exported. */
async function skeletonsOf(files: readonly PickedFile[]): Promise<PickedFile[]> {
    const jsons = files.filter((picked) => JSON_FILE.test(picked.path));
    const exported = await Promise.all(jsons.map((json) => isSkeletonJson(json.file)));

    return [...files.filter((picked) => SKEL.test(picked.path)), ...jsons.filter((_, i) => exported[i])];
}

/**
 * Sorts a set of files into rigs. Every skeleton gets an atlas and every page of that atlas an
 * image, or the skeleton becomes a problem that says what is missing.
 *
 * @example
 * const { rigs, problems } = await sortFiles(await fromDrop(event.dataTransfer));
 */
export async function sortFiles(files: readonly PickedFile[]): Promise<Sorted> {
    const visible = files.filter((picked) => !baseOf(picked.path).startsWith('.'));
    const kinds: Kinds = {
        atlases: visible.filter((picked) => ATLAS.test(picked.path)),
        images: visible.filter((picked) => IMAGE.test(picked.path)),
        pagesOf: new Map(),
    };
    const skeletons = await skeletonsOf(visible);
    const names = new Map<string, number>();
    const rigs: RigFiles[] = [];
    const problems: RigProblem[] = [];

    for (const skeleton of skeletons) names.set(stemOf(skeleton.path), (names.get(stemOf(skeleton.path)) ?? 0) + 1);
    for (const skeleton of skeletons) {
        // two skeletons of one name show their folders
        const shared = (names.get(stemOf(skeleton.path)) ?? 0) > 1;
        const name = shared ? skeleton.path : baseOf(skeleton.path).replace(/\.(skel\.bytes|skel|json)$/i, '');
        const matched = await matchRig(skeleton, name, kinds);

        if ('skeleton' in matched) rigs.push(matched);
        else problems.push(matched);
    }
    const ignored = visible.length - kinds.images.length - kinds.atlases.length - skeletons.length;

    return { rigs, problems, ignored };
}
