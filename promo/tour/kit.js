// Shared by the tour and its scenes: the frame, the palette, easing, text styles and the helpers
// that every scene draws with. K is filled by tour.js at boot.
import { MarrowSpine } from 'pixi-marrow';
import { horizontal } from 'pixi-silk';
import { SdfAtlas, SilkText } from 'pixi-silk/text';

export const W = 1920;
export const H = 1080;
export const FPS = 60;
/** One step of the simulation, in seconds. */
export const STEP = 1 / FPS;

// The colours of the docs site (apps/site/src/styles/global.css), as numbers.
export const C = {
    BG: 0x09090b,
    CARD: 0x121214,
    CODE: 0x0e0e11,
    LINE: 0x27272b,
    TEXT: 0xfafafa,
    MUTED: 0xa5a5ae,
    DIM: 0x6a6a74,
    MARROW: 0xf57047,
    MARROW_TEXT: 0xfc9c73,
    GOLD: 0xffc857,
    GREEN: 0x4ade80,
    OTHER: 0x5b5b66,
};

const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", Menlo, monospace';
/** The width of one JetBrains Mono character, as a part of the font size. */
export const MONO_ADVANCE = 0.6;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0 before `at`, 1 after `at + d`, linear between. */
export const prog = (t, at, d) => clamp((t - at) / d);
export const outCubic = (x) => 1 - (1 - x) ** 3;
export const outQuint = (x) => 1 - (1 - x) ** 5;
export const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
export const outBack = (x, s = 1.4) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;
/** A number in [0, 1) that depends on `n` only, so that every run draws the same scene. */
export const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;

    return s - Math.floor(s);
};
/** What tour.js fills at boot: the layers, the assets, the bench numbers and the text styles. */
export const K = { style: {} };

export function makeStyles() {
    const big = new SdfAtlas({ size: 96, radius: 28 });
    const sans = { fontFamily: SANS, atlas: big };
    const mono = { fontFamily: MONO, tabularNumbers: true };

    Object.assign(K.style, {
        kick: { ...mono, fontSize: 26, fontWeight: 700, fill: C.MARROW_TEXT, letterSpacing: 4 },
        head: { ...sans, fontSize: 92, fontWeight: 800, fill: C.TEXT, letterSpacing: -3 },
        sub: { ...sans, fontSize: 40, fontWeight: 500, fill: C.MUTED, letterSpacing: -0.5 },
        title: {
            ...sans,
            anchor: 0.5,
            fontSize: 220,
            fontWeight: 900,
            letterSpacing: -9,
            fill: horizontal([C.GOLD, C.MARROW_TEXT, C.MARROW]),
        },
        brand: {
            ...sans,
            anchor: { x: 1, y: 0 },
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: -1.2,
            fill: horizontal([C.GOLD, C.MARROW_TEXT, C.MARROW]),
        },
        tagline: { ...sans, anchor: 0.5, fontSize: 58, fontWeight: 600, fill: C.TEXT, letterSpacing: -1 },
        label: { ...mono, fontSize: 26, fontWeight: 700, fill: C.MUTED, letterSpacing: 3 },
        huge: { ...mono, atlas: big, fontSize: 250, fontWeight: 800, fill: C.MARROW, letterSpacing: -8 },
        stat: { ...mono, atlas: big, fontSize: 84, fontWeight: 700, fill: C.TEXT, letterSpacing: -2 },
        unit: { ...sans, fontSize: 40, fontWeight: 600, fill: C.MUTED },
        count: { ...sans, fontSize: 260, fontWeight: 800, fill: C.GREEN, letterSpacing: -8 },
        code: { ...mono, fontSize: 28, fontWeight: 500, fill: C.TEXT },
        body: { ...sans, atlas: undefined, fontSize: 32, fontWeight: 500, fill: C.TEXT, lineHeight: 44 },
        value: { ...mono, fontSize: 30, fontWeight: 700, fill: C.TEXT },
        note: { ...mono, fontSize: 23, fontWeight: 500, fill: C.DIM },
    });
}

/** Immediate-mode text: put() each frame, and what was not put this frame is hidden. */
export class Texts {
    constructor(parent) {
        this.parent = parent;
        this.map = new Map();
    }
    begin() {
        for (const text of this.map.values()) text.visible = false;
    }
    put(key, value, style, x, y, o = {}) {
        let text = this.map.get(key);
        const string = String(value);
        const alpha = o.alpha ?? 1;

        if (!text) {
            text = new SilkText({ text: string, ...style, ...(o.fill === undefined ? {} : { fill: o.fill }) });
            this.parent.addChild(text);
            this.map.set(key, text);
        }
        if (text.text !== string) text.text = string;
        text.visible = alpha > 0.002;
        text.position.set(x, y);
        text.alpha = alpha;
        text.scale.set(o.scale ?? 1);

        return text;
    }
}

export const LEFT = 100;

/** The kicker, the headline and the line under it, at the top left. `a` is the alpha of all three. */
export function heading(key, kick, title, sub, t, a = 1) {
    const { tx } = K.hud;
    const rise = (delay) => outCubic(prog(t, delay, 0.7));
    const [k, h, s] = [rise(0.05), rise(0.15), rise(0.3)];

    tx.put(`${key}-kick`, kick, K.style.kick, LEFT + 2, 64 + (1 - k) * 14, { alpha: k * a });
    tx.put(`${key}-head`, title, K.style.head, LEFT - 4, 104 + (1 - h) * 24, { alpha: h * a });
    if (sub) tx.put(`${key}-sub`, sub, K.style.sub, LEFT, 226 + (1 - s) * 18, { alpha: s * a });
}

/** A card: a rectangle with small corners, an edge and a soft shadow. */
export function card(g, x, y, w, h, o = {}) {
    const a = o.alpha ?? 1;

    if (a <= 0.002) return;
    g.roundRect(x, y + 14, w, h, o.radius ?? 14).fill({ color: 0x000000, alpha: 0.45 * a, blur: 28 });
    g.roundRect(x, y, w, h, o.radius ?? 14)
        .fill({ color: o.color ?? C.CARD, alpha: a })
        .stroke({ width: 2, color: o.edge ?? C.LINE, alpha: a, alignment: 'inside' });
}

/** A skeleton that the tour steps itself: no ticker ever updates it. */
export function spawn(name, parent, x = 0, y = 0, scale = 1) {
    const hero = new MarrowSpine(K.assets[name], { autoUpdate: false });

    hero.position.set(x, y);
    hero.scale.set(scale);
    parent.addChild(hero);

    return hero;
}

/** Covers the skeleton layer with the background colour: the dip between two scenes. */
export function cover(t, dur, a = 0.38, b = 0.34) {
    const c = Math.max(1 - prog(t, 0, a), prog(t, dur - b, b));

    if (c > 0.002) K.hud.g.rect(0, 0, W, H).fill({ color: C.BG, alpha: c });
}
