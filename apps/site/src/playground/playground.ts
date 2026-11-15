import type { MarrowAsset } from 'pixi-marrow';
import { plural } from '../lab/report';
import { fromDrop, fromFileList, type PickedFile, type RigProblem, type Sorted, sortFiles } from './files';
import { explain, FileStore, loadRig } from './load';
import { Scene } from './scene';
import { SelectionControls } from './selection';
import { Toolbar } from './toolbar';

/*
 * The playground page: drop Spine files or folders, or choose them with the buttons at the
 * bottom, and every skeleton among them stands in the scene and plays. It shows that
 * pixi-marrow loads what an editor exports as it is, and what each skeleton costs.
 *
 * The files of one drop or pick hold their textures and URLs in a store. The store is freed
 * once the last skeleton of its files was deleted. The app is freed when the page is left.
 */

/** Space between the buttons of the page and what the canvas draws above them, in CSS pixels. */
const PICK_GAP = 8;

/** The elements of the page. */
export interface PlaygroundPage {
    canvas: HTMLElement;
    empty: HTMLElement;
    /** The bar with the buttons that choose files and a folder. */
    pick: HTMLElement;
    files: HTMLInputElement;
    folder: HTMLInputElement;
}

/** What became of a load, as the line under the readout says it. */
function summary(sorted: Sorted, loaded: number): string {
    const ignored = sorted.ignored > 0 ? ` Left out ${plural(sorted.ignored, 'other file')}.` : '';
    const skeletons = sorted.rigs.length + sorted.problems.length;

    return skeletons === 0
        ? `No skeleton among the files.${ignored}`
        : `Loaded ${loaded} of ${plural(skeletons, 'skeleton')}.${ignored}`;
}

/** Shows that the browser took the WebGL context away, with a button that loads the page again. */
function showLost(page: PlaygroundPage): void {
    const note = document.createElement('div');
    const text = document.createElement('p');
    const reload = document.createElement('button');

    note.className = 'pg-lost';
    text.textContent =
        'The browser took the WebGL context of the playground away, so it stopped. Load the page again and choose the files once more.';
    reload.type = 'button';
    reload.className = 'pg-button';
    reload.textContent = 'Load the page again';
    reload.addEventListener('click', () => window.location.reload());
    note.append(text, reload);
    page.empty.hidden = true;
    page.canvas.append(note);
    reload.focus();
}

/**
 * Starts the playground on its page.
 *
 * @example
 * void startPlayground({ canvas, empty, pick, files, folder });
 */
export async function startPlayground(page: PlaygroundPage): Promise<void> {
    const scene = await Scene.create(page.canvas, () => showLost(page));
    const stores = new Set<FileStore>();
    /** The store of the files of each asset in the scene, and the stores whose files still load. */
    const storeOf = new Map<MarrowAsset, FileStore>();
    const loading = new Set<FileStore>();
    const problems: RigProblem[] = [];
    // a browser without folder pickers gets no button for one
    if (!('webkitdirectory' in HTMLInputElement.prototype)) {
        page.pick.querySelector('[data-pg-choose="folder"]')?.remove();
    }
    const buttons = [...page.pick.querySelectorAll('button')];
    let busy = false;
    /** True once the page was left: a load that is under way adds nothing then. */
    let left = false;
    new SelectionControls(scene);
    const toolbar = new Toolbar(scene);

    /** Frees a store once none of its assets stands in the scene and its files no longer load. */
    const release = (store: FileStore): void => {
        if (loading.has(store) || [...storeOf.values()].includes(store)) return;
        store.destroy();
        stores.delete(store);
    };

    scene.onUnused = (asset) => {
        const store = storeOf.get(asset);

        storeOf.delete(asset);
        asset.destroy();
        if (store !== undefined) release(store);
    };

    /** Loads the rigs of some sorted files into the scene, with the files in a store. Gives how many loaded. */
    async function loadAll(sorted: Sorted, store: FileStore): Promise<number> {
        const mesh = scene.options.renderMode === 'mesh' ? 'mesh' : 'auto';
        let loaded = 0;

        for (const rig of sorted.rigs) {
            toolbar.say(`Loading ${rig.name}, ${loaded + 1} of ${sorted.rigs.length}.`);
            try {
                const asset = await loadRig(rig, store, mesh);

                if (left) {
                    asset.destroy();

                    return loaded;
                }
                storeOf.set(asset, store);
                scene.add(rig.name, asset);
                loaded++;
            } catch (error) {
                problems.push({ name: rig.name, reason: explain(error) });
            }
        }

        return loaded;
    }

    /** Loads the rigs among some files into the scene. */
    async function take(picked: Promise<PickedFile[]>): Promise<void> {
        if (busy) return;
        const store = new FileStore();
        const hold = (on: boolean): void => {
            busy = on;
            for (const button of buttons) button.disabled = on;
            if (on) loading.add(store);
            else loading.delete(store);
        };

        stores.add(store);
        hold(true);
        try {
            toolbar.say('Reading the files.');
            const sorted = await sortFiles(await picked);

            problems.push(...sorted.problems);
            const loaded = await loadAll(sorted, store);

            if (left) return;
            if (loaded > 0) scene.arrange();
            page.empty.hidden = scene.entries.length > 0;
            toolbar.showProblems(problems);
            toolbar.say(summary(sorted, loaded));
        } catch (error) {
            if (!left) toolbar.say(explain(error));
        } finally {
            hold(false);
            // the files of a pick that loaded no skeleton are freed at once
            release(store);
        }
    }

    /** Keeps what the canvas draws at the bottom clear of the buttons of the page. */
    const inset = (): void => {
        scene.bottomInset = Math.ceil(window.innerHeight - page.pick.getBoundingClientRect().top) + PICK_GAP;
    };

    inset();
    window.addEventListener('resize', inset);
    for (const input of [page.files, page.folder]) {
        input.addEventListener('change', () => {
            const list = input.files;

            if (list === null || list.length === 0) return;
            const picked = fromFileList(list);

            // the same files can be chosen again
            input.value = '';
            void take(Promise.resolve(picked));
        });
    }
    for (const button of buttons) {
        const input = button.dataset.pgChoose === 'folder' ? page.folder : page.files;

        button.addEventListener('click', () => input.click());
    }
    window.addEventListener('dragover', (event) => {
        event.preventDefault();
        document.body.classList.add('pg-dragging');
    });
    window.addEventListener('dragleave', (event) => {
        if (event.relatedTarget === null) document.body.classList.remove('pg-dragging');
    });
    window.addEventListener('drop', (event) => {
        event.preventDefault();
        document.body.classList.remove('pg-dragging');
        if (event.dataTransfer !== null) void take(fromDrop(event.dataTransfer));
    });
    window.addEventListener('pagehide', () => {
        left = true;
        scene.destroy();
        for (const store of stores) store.destroy();
        stores.clear();
    });
    // the app is gone once the page was left, so a page that comes back from the cache of pages loads again
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) window.location.reload();
    });
}
