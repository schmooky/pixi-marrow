import { Container, type Ticker } from 'pixi.js';
import { SilkGraphics } from 'pixi-silk';
import { SilkText } from 'pixi-silk/text';
import { Camera } from 'pixi-silk/ui/camera';
import { TransformGizmo } from 'pixi-silk/ui/gizmo';
import { CanvasGrid } from 'pixi-silk/ui/grid';
import { definePreview } from './runtime';

/*
 * Coordinates and transforms, made with pixi-silk. The grid shows the coordinates of the scene:
 * the origin is the top left corner, x grows to the right and y grows down, as in Pixi. A blue
 * parent holds an orange child. The gizmo moves, turns and scales whichever of the two is picked,
 * and the numbers under the canvas show the child in its parent and on the scene. The child keeps
 * its own numbers while the parent moves it, which is how a bone carries the bones below it.
 */

const MONO = 'ui-monospace, SF Mono, Menlo, Consolas, monospace';
const TARGETS = ['parent', 'child'] as const;

type Target = (typeof TARGETS)[number];

/** A square of a color with its name on it, centred on its origin. */
function square(size: number, color: number, name: string): Container {
    const box = new Container();
    const shape = new SilkGraphics();

    shape.roundRect(-size / 2, -size / 2, size, size, 10).fill(color);
    shape.circle(0, 0, 4).fill(0xffffff);
    const label = new SilkText({
        text: name,
        fontSize: 13,
        fontFamily: MONO,
        fontWeight: 600,
        fill: 0x111113,
        anchor: { x: 0.5, y: 0.5 },
    });

    label.position.set(0, size / 2 - 14);
    box.addChild(shape, label);

    return box;
}

const deg = (radians: number): string => ((radians * 180) / Math.PI).toFixed(0);

export default definePreview({
    size: [760, 440],
    async setup(context) {
        const { app, pick, toggle, readout } = context;
        const world = new Container();
        const camera = new Camera({ world, element: app.canvas, ticker: app.ticker, keys: false });
        const grid = new CanvasGrid({ camera, axes: true, ticker: app.ticker });
        const parent = square(140, 0x5fa8ff, 'parent');
        const child = square(64, 0xff8a4c, 'child');
        let turning = true;
        let dragging = false;
        let time = 0;
        const gizmo = new TransformGizmo({
            mode: 'universal',
            transition: 'glide',
            ticker: app.ticker,
            target: parent,
            onStart: () => {
                dragging = true;
            },
            onEnd: () => {
                dragging = false;
            },
        });
        const showParent = readout('Parent', 60);
        const showLocal = readout('Child in parent', 60);
        const showWorld = readout('Child on scene', 60);

        parent.position.set(300, 220);
        child.position.set(110, -40);
        parent.addChild(child);
        world.addChild(parent);
        app.stage.addChild(grid, world, gizmo);
        pick('Gizmo on', TARGETS, (next: Target) => gizmo.attach(next === 'parent' ? parent : child), 'parent');
        toggle('Motion', 'parent turns by itself', true, (on) => {
            turning = on;
        });
        app.ticker.add((ticker: Ticker) => {
            time += ticker.deltaMS / 1000;
            if (turning && !dragging) parent.rotation = Math.sin(time * 0.8) * 0.6;
            const onScene = world.toLocal(child.getGlobalPosition());

            showParent(
                `x ${parent.x.toFixed(0)}, y ${parent.y.toFixed(0)}, rotation ${deg(parent.rotation)}, scale ${parent.scale.x.toFixed(2)}`,
            );
            showLocal(
                `x ${child.x.toFixed(0)}, y ${child.y.toFixed(0)}, rotation ${deg(child.rotation)}: its own numbers`,
            );
            showWorld(`x ${onScene.x.toFixed(0)}, y ${onScene.y.toFixed(0)}: the parent's transform applied to them`);
        });
    },
});
