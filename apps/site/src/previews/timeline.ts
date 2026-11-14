import { Container, Graphics, Rectangle, Text, type Ticker } from 'pixi.js';
import { MarrowSpine } from 'pixi-marrow';
import { definePreview } from './runtime';

/*
 * An animation of the bee of the slot game Bzzz as a dope sheet: one row per bone or slot that
 * the animation keys, a dot per key in the color of what it changes, and a line at the time
 * that shows. The time runs, runs slowly or stands. Dragging over the sheet sets it.
 */

/** Where the bee stands, and where the sheet lies, in design units. */
const BEE = new Rectangle(0, 40, 236, 440);
const SHEET = new Rectangle(252, 34, 620, 478);
/** The width of the names at the left of the sheet. */
const LABELS = 150;
const ANIMATIONS = ['win', 'idle', 'landing', 'blur_in'] as const;

type Animation = (typeof ANIMATIONS)[number];

const SPEEDS = { normal: 1, slow: 0.25, paused: 0 } as const;

type Speed = keyof typeof SPEEDS;

/** Numbers per key in the official `frames` array, by kind. The first number of a key is its time. */
const STRIDES: Partial<Record<string, number>> = {
    rotate: 2,
    translateX: 2,
    translateY: 2,
    scaleX: 2,
    scaleY: 2,
    shearX: 2,
    shearY: 2,
    alpha: 2,
    inherit: 2,
    translate: 3,
    scale: 3,
    shear: 3,
    rgba: 5,
    rgb: 4,
    rgba2: 8,
    rgb2: 7,
    attachment: 1,
    deform: 1,
    drawOrder: 1,
    sequence: 3,
};
/** The color of a key by what its timeline changes, and its offset in the row so that kinds stay apart. */
const LOOKS: Record<string, { color: number; shift: number }> = {
    rotate: { color: 0xff8a4c, shift: -3 },
    translate: { color: 0x5fa8ff, shift: 0 },
    scale: { color: 0x6fd08c, shift: 3 },
    color: { color: 0xff6fae, shift: 0 },
    attachment: { color: 0xf2f2f2, shift: 0 },
    event: { color: 0xffd84a, shift: 0 },
    other: { color: 0xb48cff, shift: 0 },
};
/** Kinds that change a slot rather than a bone. */
const SLOT_KINDS = new Set(['rgba', 'rgb', 'alpha', 'rgba2', 'rgb2', 'attachment', 'deform', 'sequence']);

/** One row of the sheet: a bone, a slot or the events, with the keys of its timelines. */
interface Row {
    label: string;
    /** The time of each key, its look, and the name of an event key. */
    keys: { time: number; look: string; event?: string }[];
    text: Text;
}

/** What a kind looks like on the sheet. */
function lookOf(kind: string): string {
    if (kind.startsWith('rotate')) return 'rotate';
    if (kind.startsWith('translate')) return 'translate';
    if (kind.startsWith('scale')) return 'scale';
    if (['rgba', 'rgb', 'alpha', 'rgba2', 'rgb2'].includes(kind)) return 'color';
    if (kind === 'attachment' || kind === 'event') return kind;

    return 'other';
}

/** The model of a skeleton, as an asset holds it. */
type Model = MarrowSpine['asset']['model'];
/** A timeline of an animation of the model. */
type Timeline = Model['animations'][number]['timelines'][number];

/** The row a timeline goes to: its bone, its slot, or the events. */
function labelOf(model: Model, timeline: Timeline): string {
    if (timeline.kind === 'event') return 'events';

    return SLOT_KINDS.has(timeline.kind)
        ? `slot ${model.slots.names[timeline.target] ?? ''}`
        : (model.bones.names[timeline.target] ?? '');
}

/** The keys of a timeline: their times, and the names of event keys. */
function keysOf(model: Model, timeline: Timeline): Row['keys'] {
    const look = lookOf(timeline.kind);

    if (timeline.kind === 'event') {
        return (timeline.events ?? []).map((key) => ({
            time: key.time,
            look,
            event: model.events[key.event]?.name ?? 'event',
        }));
    }
    const stride = STRIDES[timeline.kind];
    const keys: Row['keys'] = [];

    if (stride === undefined) return keys;
    for (let i = 0; i < timeline.frames.length; i += stride) keys.push({ time: timeline.frames[i] ?? 0, look });

    return keys;
}

/** Where a row stands: the events on top, then the slots, then the bones. */
const rank = (label: string): number => (label === 'events' ? 0 : label.startsWith('slot ') ? 1 : 2);

/** The rows of an animation of a skeleton, with the time of every key. */
function rowsOf(hero: MarrowSpine, name: Animation): Omit<Row, 'text'>[] {
    const { model } = hero.asset;
    const animation = model.animations.find((item) => item.name === name);
    const rows = new Map<string, Omit<Row, 'text'>>();

    for (const timeline of animation?.timelines ?? []) {
        const label = labelOf(model, timeline);
        const row = rows.get(label) ?? { label, keys: [] };

        row.keys.push(...keysOf(model, timeline));
        rows.set(label, row);
    }

    return [...rows.values()].sort((a, b) => rank(a.label) - rank(b.label));
}

/** Draws one key: a square for an image, a diamond for an event, a dot for the rest. */
function drawKey(dots: Graphics, look: string, x: number, y: number): void {
    const { color, shift } = LOOKS[look] ?? { color: 0xffffff, shift: 0 };

    if (look === 'attachment') dots.rect(x - 2.5, y - 2.5, 5, 5);
    else if (look === 'event') dots.poly([x, y - 4.5, x + 4.5, y, x, y + 4.5, x - 4.5, y]);
    else dots.circle(x, y + shift, 2.8);
    dots.fill(color);
}

/** The first event key that the time passed on its way from `before` to `now`, where it may have wrapped. */
function passedEvent(row: Row, before: number, now: number): Row['keys'][number] | undefined {
    return row.keys.find((key) =>
        before <= now ? before < key.time && key.time <= now : key.time > before || key.time <= now,
    );
}

export default definePreview({
    size: [880, 520],
    async setup(context) {
        const { app, pick, readout } = context;
        const showTime = readout('Time', 40);
        const showEvent = readout('Event', 40);

        readout('Colors', 60)('orange turn, blue move, green scale, pink color, white image');
        // this preview updates the bee itself, to set its time
        const hero = await MarrowSpine.load({
            skeleton: '/rigs/animation_bee.skel',
            atlas: '/rigs/symbols.atlas',
            autoUpdate: false,
        });
        const sheet = new Container();
        const dots = new Graphics();
        const head = new Graphics();
        const area = new Graphics();
        let name: Animation = 'win';
        let duration = 1;
        let time = 0;
        let speed: Speed = 'normal';
        let dragging = false;
        let rows: Row[] = [];
        let eventShown = 0;

        hero.play('idle', { loop: true });
        hero.update(0);
        const box = hero.getLocalBounds();
        const scale = Math.min(BEE.width / box.width, BEE.height / box.height) * 0.9;

        hero.scale.set(scale);
        hero.position.set(
            BEE.x + BEE.width / 2 - (box.x + box.width / 2) * scale,
            BEE.y + BEE.height / 2 - (box.y + box.height / 2) * scale,
        );
        app.stage.addChild(hero, sheet);
        sheet.addChild(area, dots, head);
        /** The x of a time on the sheet. */
        const xOf = (seconds: number): number => SHEET.x + LABELS + (seconds / duration) * (SHEET.width - LABELS);
        /** Shows the pose at a time, from the start of the animation. */
        const poseAt = (seconds: number): void => {
            time = seconds;
            hero.play(name, { loop: true, mix: 0 });
            hero.update(seconds);
        };
        /** Draws the rows and the keys of the animation that shows. */
        const drawSheet = (): void => {
            for (const row of rows) row.text.destroy();
            dots.clear();
            area.clear();
            const animation = hero.asset.model.animations.find((item) => item.name === name);

            duration = Math.max(animation?.duration ?? 1, 0.001);
            const found = rowsOf(hero, name);
            const height = Math.min(22, SHEET.height / Math.max(1, found.length));

            area.rect(SHEET.x + LABELS, SHEET.y - 14, SHEET.width - LABELS, SHEET.height + 14).fill({
                color: 0xffffff,
                alpha: 0.03,
            });
            for (let tenth = 0; tenth <= duration * 10 + 1e-6; tenth++) {
                const x = xOf(tenth / 10);

                area.moveTo(x, SHEET.y - (tenth % 5 === 0 ? 10 : 5)).lineTo(x, SHEET.y + found.length * height);
            }
            area.stroke({ color: 0xffffff, alpha: 0.08, width: 1 });
            rows = found.map((row, index) => {
                const y = SHEET.y + index * height + height / 2;
                const text = new Text({
                    text: row.label.length > 20 ? `${row.label.slice(0, 19)}.` : row.label,
                    style: { fontFamily: 'ui-monospace, monospace', fontSize: 12, fill: 0xb8b8c2 },
                    resolution: 3,
                });

                text.anchor.set(0, 0.5);
                text.position.set(SHEET.x, y);
                sheet.addChild(text);
                for (const key of row.keys) drawKey(dots, key.look, xOf(key.time), y);

                return { ...row, text };
            });
        };
        /** Moves the line of the time, lights the rows with a key near it, and names an event it passed. */
        const drawHead = (before: number): void => {
            const x = xOf(time);

            head.clear();
            head.moveTo(x, SHEET.y - 14)
                .lineTo(x, SHEET.y + SHEET.height)
                .stroke({ color: 0xffffff, width: 1.5, alpha: 0.85 });
            for (const row of rows) {
                row.text.alpha = row.keys.some((key) => Math.abs(key.time - time) < 0.04) ? 1 : 0.55;
                const passed = row.label === 'events' ? passedEvent(row, before, time) : undefined;

                if (passed !== undefined) {
                    showEvent(`${passed.event ?? 'event'} at ${passed.time.toFixed(2)} s`);
                    eventShown = performance.now();
                }
            }
            if (eventShown !== 0 && performance.now() - eventShown > 1500) {
                showEvent('none passed in the last moment');
                eventShown = 0;
            }
            showTime(`${time.toFixed(2)} of ${duration.toFixed(2)} s, ${rows.length} rows`);
        };
        /** Sets the time from a point over the sheet. */
        const scrub = (x: number): void => {
            const share = (x - SHEET.x - LABELS) / (SHEET.width - LABELS);

            poseAt(Math.min(1, Math.max(0, share)) * duration);
            drawHead(time);
        };
        /** Shows another animation from its start. */
        const choose = (next: Animation): void => {
            name = next;
            poseAt(0);
            drawSheet();
            drawHead(0);
        };

        area.eventMode = 'static';
        area.cursor = 'ew-resize';
        area.hitArea = new Rectangle(SHEET.x + LABELS, SHEET.y - 14, SHEET.width - LABELS, SHEET.height + 14);
        area.on('pointerdown', (event) => {
            dragging = true;
            scrub(event.getLocalPosition(sheet).x);
        });
        area.on('globalpointermove', (event) => {
            if (dragging) scrub(event.getLocalPosition(sheet).x);
        });
        area.on('pointerup', () => {
            dragging = false;
        });
        area.on('pointerupoutside', () => {
            dragging = false;
        });
        app.ticker.add((ticker: Ticker) => {
            if (dragging || SPEEDS[speed] === 0) return;
            const step = (ticker.deltaMS / 1000) * SPEEDS[speed];
            const before = time;

            time = (time + step) % duration;
            hero.update(step);
            drawHead(before);
        });
        pick('Animation', ANIMATIONS, choose, 'win');
        pick(
            'Speed',
            Object.keys(SPEEDS) as Speed[],
            (next) => {
                speed = next;
            },
            'normal',
        );
        choose('win');
    },
});
