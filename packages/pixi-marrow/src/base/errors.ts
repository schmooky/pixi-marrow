/** Why a {@link MarrowError} was thrown. Stable across releases, so code can branch on it. */
export type MarrowErrorCode = 'invalid-data' | 'unsupported-version' | 'unsupported-feature';

/** What a {@link MarrowError} carries besides its message. */
export interface MarrowErrorDetails {
    /** What to change so the call works. */
    fix: string;
    /** The values that would have been accepted, when the error is about a name or a version. */
    validNames?: readonly string[];
    /** The accepted value closest to the one that was passed. */
    closest?: string;
}

/**
 * The one error type this library throws. The message states the cause and the fix.
 *
 * @example
 * try {
 *     sniffSkeleton(bytes);
 * } catch (error) {
 *     if (error instanceof MarrowError && error.code === 'unsupported-version') console.warn(error.fix);
 * }
 */
export class MarrowError extends Error {
    override readonly name: string = 'MarrowError';
    /** Why the error was thrown. */
    readonly code: MarrowErrorCode;
    /** What to change so the call works. */
    readonly fix: string;
    /** The values that would have been accepted. Empty when the error is not about a name. */
    readonly validNames: readonly string[];
    /** The accepted value closest to the one that was passed. */
    readonly closest: string | undefined;

    constructor(code: MarrowErrorCode, message: string, details: MarrowErrorDetails) {
        super(`[pixi-marrow:${code}] ${message} ${details.fix}`);
        this.code = code;
        this.fix = details.fix;
        this.validNames = details.validNames ?? [];
        this.closest = details.closest;
    }
}
