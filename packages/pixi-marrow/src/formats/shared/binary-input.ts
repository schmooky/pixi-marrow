import { MarrowError } from '../../base/errors';

/**
 * Reads the primitive values of a binary skeleton, with the encoding of the official `BinaryInput`.
 *
 * Unlike the official reader it honours a view into a larger buffer: reading starts at the
 * view's own offset.
 */
export class BinaryInput {
    /** The string table of the file. `readStringRef` reads from it. */
    readonly strings: string[] = [];
    private readonly view: DataView;
    private index = 0;

    constructor(bytes: Uint8Array) {
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    readByte(): number {
        return this.view.getInt8(this.index++);
    }

    readUnsignedByte(): number {
        return this.view.getUint8(this.index++);
    }

    readShort(): number {
        const value = this.view.getInt16(this.index);

        this.index += 2;

        return value;
    }

    readInt32(): number {
        const value = this.view.getInt32(this.index);

        this.index += 4;

        return value;
    }

    /**
     * Reads a variable-length integer of 1 to 5 bytes.
     *
     * @param optimizePositive true when the value was written unsigned. False when it was written
     * with the sign in the lowest bit, so small negative numbers stay short.
     */
    readInt(optimizePositive: boolean): number {
        let byte = this.readByte();
        let result = byte & 0x7f;

        for (let shift = 7; (byte & 0x80) !== 0 && shift <= 28; shift += 7) {
            byte = this.readByte();
            result |= (byte & 0x7f) << shift;
        }

        return optimizePositive ? result : (result >>> 1) ^ -(result & 1);
    }

    /** Reads an index into the string table. 0 means no string. An index past the table throws. */
    readStringRef(): string | null {
        const index = this.readInt(true);

        if (index === 0) return null;
        const value = this.strings[index - 1];

        if (value === undefined) {
            throw new MarrowError(
                'invalid-data',
                `The binary skeleton refers to string ${index}, but its string table has ${this.strings.length}.`,
                { fix: 'Export the skeleton again from Spine.' },
            );
        }

        return value;
    }

    /** Reads a UTF-8 string with its length in front. Null when the file stores no string. */
    readString(): string | null {
        let byteCount = this.readInt(true);

        if (byteCount === 0) return null;
        if (byteCount === 1) return '';
        byteCount--;
        let chars = '';

        for (let i = 0; i < byteCount; ) {
            const byte = this.readUnsignedByte();

            switch (byte >> 4) {
                case 12:
                case 13:
                    chars += String.fromCharCode(((byte & 0x1f) << 6) | (this.readByte() & 0x3f));
                    i += 2;
                    break;
                case 14:
                    chars += String.fromCharCode(
                        ((byte & 0x0f) << 12) | ((this.readByte() & 0x3f) << 6) | (this.readByte() & 0x3f),
                    );
                    i += 3;
                    break;
                default:
                    chars += String.fromCharCode(byte);
                    i++;
            }
        }

        return chars;
    }

    readFloat(): number {
        const value = this.view.getFloat32(this.index);

        this.index += 4;

        return value;
    }

    readBoolean(): boolean {
        return this.readByte() !== 0;
    }
}
