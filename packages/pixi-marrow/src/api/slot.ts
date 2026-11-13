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
 * A write goes to the pose of the slot, as code with the official runtime writes a slot between
 * two updates. The next update of the display object draws it, which its ticker makes every
 * frame unless `autoUpdate` is off. It stays until an animation that keys the slot writes it
 * again, or until the setup pose of the slots is set, which the `skin` and `skins` setters do.
 * The values read are those of the same pose. In 4.3 a slider can change what is drawn from them.
 *
 * A write of the value that is there changes nothing, so a game can write in every frame and the
 * skeleton still rests.
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
        const { engine, index } = this;
        const shown = engine.slotPose.attachments[index] ?? null;

        if (shown === null) return null;
        const { state } = engine;
        const lookup = createAttachmentLookup(state.model);

        return lookup.nameOf(state.skin, index, shown) ?? lookup.nameOf(lookup.defaultSkin, index, shown) ?? shown.name;
    }

    /**
     * Shows the attachment that the active skins store under this name for the slot, or else the
     * default skin, as the official `Skeleton.setAttachment` finds it. Null or an empty name shows
     * nothing, as there.
     *
     * Throws a `MarrowError` that lists the names the skins have for the slot.
     */
    set attachment(name: string | null) {
        const { engine, index } = this;

        if (name === null || name === undefined || name === '') {
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
        return tintOf(this.engine.slotPose.colors, this.index * 4);
    }

    /** Sets the color of the slot and keeps its alpha. */
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
        return Number(this.engine.slotPose.colors[this.index * 4 + 3]);
    }

    /** Sets the alpha of the slot and keeps its color. Clamped to 0 and 1. */
    set alpha(value: number) {
        const { colors } = this.engine.slotPose;
        const at = this.index * 4;

        if (!Number.isFinite(value)) finiteArgument(`slot("${this.name}")`, 'alpha', value);
        this.engine.setColor(this.index, Number(colors[at]), Number(colors[at + 1]), Number(colors[at + 2]), value);
    }

    /**
     * The dark color of the slot as `0xRRGGBB`, or null for a slot without one. A slot has a dark
     * color when it has tint black in the Spine editor.
     */
    get darkTint(): number | null {
        const { engine, index } = this;

        if (engine.state.model.slots.hasDark[index] !== 1) return null;

        return tintOf(engine.slotPose.darkColors, index * 3);
    }

    /**
     * Sets the dark color. Null changes nothing on a slot without a dark color, so a value that was
     * read can be written back. A number for such a slot, or null for a slot with one, throws a
     * `MarrowError`: the editor decides whether a slot has a dark color.
     */
    set darkTint(value: number | null) {
        const { engine, index } = this;

        if (value === null && engine.state.model.slots.hasDark[index] !== 1) return;
        if (value === null || !Number.isFinite(value)) finiteArgument(`slot("${this.name}")`, 'darkTint', value);
        const color = (value ?? 0) & 0xffffff;

        engine.setDarkColor(index, (color >> 16) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
    }
}

/** The color at `at` of a color array as a Pixi tint. */
function tintOf(colors: Float64Array, at: number): number {
    return (byte(Number(colors[at])) << 16) | (byte(Number(colors[at + 1])) << 8) | byte(Number(colors[at + 2]));
}
