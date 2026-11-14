import type { Application, FederatedPointerEvent } from 'pixi.js';
import type { Camera } from 'pixi-silk/ui/camera';

/**
 * Lets a drag on the empty canvas pan the camera, with one finger on a phone too. A press there
 * lets go of the selection first. The stage hears the release wherever it happens: a release
 * over a skeleton bubbles up to it, and one elsewhere is a release outside.
 *
 * @example
 * panOnDrag(app, camera, () => scene.select(null));
 */
export function panOnDrag(app: Application, camera: Camera, deselect: () => void): void {
    let pan: { id: number; x: number; y: number } | null = null;
    const stop = (event: FederatedPointerEvent): void => {
        if (pan?.id === event.pointerId) pan = null;
    };

    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
        if (event.target !== app.stage || event.button !== 0) return;
        deselect();
        pan = { id: event.pointerId, x: event.global.x, y: event.global.y };
        app.canvas.style.cursor = 'grabbing';
    });
    app.stage.on('globalpointermove', (event: FederatedPointerEvent) => {
        if (pan === null || event.pointerId !== pan.id) return;
        camera.panBy(event.global.x - pan.x, event.global.y - pan.y);
        pan.x = event.global.x;
        pan.y = event.global.y;
    });
    for (const name of ['pointerup', 'pointerupoutside', 'pointercancel'] as const) {
        app.stage.on(name, (event: FederatedPointerEvent) => {
            stop(event);
            app.canvas.style.cursor = '';
        });
    }
    window.addEventListener('blur', () => {
        pan = null;
    });
}
