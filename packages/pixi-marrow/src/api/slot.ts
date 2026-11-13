import { unknownName } from '../base/names';
import type { PoseEngine } from '../pose/engine';
import { createAttachmentLookup } from '../pose/shared/lookup';
import { finiteArgument } from './checks';
import type { MarrowNames } from './options';

/** A part of a color, 0 to 1, as one byte of a tint. */
const byte = (part: number): number => Math.round(part * 255);

/**
 * One slot of a display object: the attachment it shows, its color and its dark color, to read
 * and to write. `MarrowSpine.slot` hands it out, one object per slot.
 *
 * A write goes to the pose, as code with the official runtime writes a slot between two updates.
 * The next render shows it. A slot that a 4.3 slider poses shows it after the next update. It
 * stays until an animation that keys the slot writes it again, or until the setup pose of the
 * slots is set, which the `skin` and `skins` setters do.
 *
 * @example
 * const glow = hero.slot('glow');
 * glow.tint = 0xffcc00;
 * glow.alpha = 0.5;
 * hero.slot('weapon').attachment = 'sword-2';
 */
export class Slot<N extends MarrowNames = MarrowNames> {
    readonly name: N['slots'];
    /** The name of the bone the slot is on. */
    readonly bone: N['bones'];
    private readonly engine: PoseEngine;
    private readonly index: number;

    /** @param index The index of the slot in the skeleton. */
    constructor(engine: PoseEngine, index: number, name: N['slots']) {
        const { slots, bones } = engine.state.model;

        this.engine = engine;
        this.index = index;
        this.name = name;
        // the names type lists the bones of this skeleton
        this.bone = bones.names[slots.bones[index] ?? 0] as N['bones'];
    }

    /**
     * The name the skins store the attachment under that the slot shows, or null when it shows
     * none. It is the name `attachment` takes: the key in the active skins, or else in the default
     * skin. That can differ from the name of the attachment itself, which this gives when no skin
     * stores the attachment for the slot.
     */
    get attachment(): string | null {
        const { state } = this.engine;
        const shown = state.attachments[this.index] ?? null;

        if (shown === null) return null;
        const lookup = createAttachmentLookup(state.model);

        for (const skin of [state.skin, lookup.defaultSkin]) {
            for (const entry of lookup.skin(skin)?.attachments ?? []) {
                if (entry.slot === this.index && entry.attachment === shown) return entry.name;
            }
        }

        return shown.name;
    }

    /**
     * Shows the attachment that the active skins store under this name for the slot, or else the
     * default skin, as the official `Skeleton.setAttachment` finds it. Null shows nothing.
     *
     * Throws a `MarrowError` that lists the names the skins have for the slot.
     */
    set attachment(name: string | null) {
        const { engine, index } = this;

        if (name === null) {
            engine.setAttachment(index, null);

            return;
        }
        const { state } = engine;
        const lookup = createAttachmentLookup(state.model);
        const found = lookup.find(state.skin, index, String(name));

        if (found === undefined) {
            const names = [lookup.skin(state.skin), lookup.skin(lookup.defaultSkin)].flatMap((skin) =>
                (skin?.attachments ?? []).filter((entry) => entry.slot === index).map((entry) => entry.name),
            );

            throw unknownName(`attachment for the slot "${this.name}"`, String(name), [...new Set(names)]);
        }
        engine.setAttachment(index, found);
    }

    /** The color of the slot as a Pixi tint: `0xRRGGBB`. */
    get tint(): number {
        const { colors } = this.engine.state;
        const at = this.index * 4;

        return (byte(Number(colors[at])) << 16) | (byte(Number(colors[at + 1])) << 8) | byte(Number(colors[at + 2]));
    }

    set tint(value: number) {
        // the text that names the slot is built for the error only: a write in every frame allocates nothing
        if (!Number.isFinite(value)) finiteArgument(`slot("${this.name}")`, 'tint', value);
        const color = value & 0xffffff;

        this.engine.setColor(
            this.index,
            (color >> 16) / 255,
            ((color >> 8) & 255) / 255,
            (color & 255) / 255,
            this.alpha,
        );
    }

    /** The alpha of the slot, from 0 to 1. A slot at 0 is not drawn. */
    get alpha(): number {
        return Number(this.engine.state.colors[this.index * 4 + 3]);
    }

    set alpha(value: number) {
        const { colors } = this.engine.state;
        const at = this.index * 4;
        if (!Number.isFinite(value)) finiteArgument(`slot("${this.name}")`, 'alpha', value);
        this.engine.setColor(this.index, Number(colors[at]), Number(colors[at + 1]), Number(colors[at + 2]), value);
    }

    /**
     * The dark color of the slot as `0xRRGGBB`, or null for a slot without one. A slot has a dark
     * color when it has tint black in the Spine editor. Setting it on a slot without one throws a
     * `MarrowError`.
     */
    get darkTint(): number | null {
        const { state } = this.engine;

        if (state.model.slots.hasDark[this.index] !== 1) return null;
        const at = this.index * 3;
        const dark = state.darkColors;

        return (byte(Number(dark[at])) << 16) | (byte(Number(dark[at + 1])) << 8) | byte(Number(dark[at + 2]));
    }

    set darkTint(value: number) {
        if (!Number.isFinite(value)) finiteArgument(`slot("${this.name}")`, 'darkTint', value);
        const color = value & 0xffffff;

        this.engine.setDarkColor(this.index, (color >> 16) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
    }
}
