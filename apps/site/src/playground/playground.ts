import { plural } from '../lab/report';
import { fromDrop, type PickedFile, type RigProblem, sortFiles } from './files';
import { explain, FileStore, loadRig } from './load';
import { Scene } from './scene';
import { SelectionControls } from './selection';
import { Toolbar } from './toolbar';

/*
 * The playground page: drop Spine files or folders, and every skeleton among them stands in
 * the scene and plays. It shows that pixi-marrow loads what an editor exports as it is, and
 * what each skeleton costs.
 */

/** The elements of the page. */
export interface PlaygroundPage {
    canvas: HTMLElement;
    empty: HTMLElement;
}

/**
 * Starts the playground on its page.
 *
 * @example
 * void startPlayground({ canvas, empty });
 */
export async function startPlayground(page: PlaygroundPage): Promise<void> {
    const scene = await Scene.create(page.canvas);
    const stores: FileStore[] = [];
    const problems: RigProblem[] = [];
    let busy = false;
    new SelectionControls(scene);
    const toolbar = new Toolbar(scene);

    /** Loads the rigs among some files into the scene. */
    async function take(picked: Promise<PickedFile[]>): Promise<void> {
        if (busy) return;
        busy = true;
        try {
            toolbar.say('Reading the files.');
            const sorted = await sortFiles(await picked);
            const store = new FileStore();
            const mesh = scene.options.renderMode === 'mesh' ? 'mesh' : 'auto';
            let loaded = 0;

            stores.push(store);
            problems.push(...sorted.problems);
            for (const rig of sorted.rigs) {
                toolbar.say(`Loading ${rig.name}, ${loaded + 1} of ${sorted.rigs.length}.`);
                try {
                    scene.add(rig.name, await loadRig(rig, store, mesh));
                    loaded++;
                } catch (error) {
                    problems.push({ name: rig.name, reason: explain(error) });
                }
            }
            if (loaded > 0) scene.arrange();
            page.empty.hidden = scene.entries.length > 0;
            toolbar.showProblems(problems);
            const ignored = sorted.ignored > 0 ? ` Left out ${plural(sorted.ignored, 'other file')}.` : '';

            toolbar.say(
                sorted.rigs.length + sorted.problems.length === 0
                    ? `No skeleton among the files.${ignored}`
                    : `Loaded ${loaded} of ${plural(sorted.rigs.length + sorted.problems.length, 'skeleton')}.${ignored}`,
            );
        } catch (error) {
            toolbar.say(explain(error));
        } finally {
            busy = false;
        }
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
        scene.clear();
        for (const store of stores) store.destroy();
    });
}
