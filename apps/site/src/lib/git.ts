import { execFileSync } from 'node:child_process';

/*
 * Dates from git, read while the site builds. A page shows when its source file last changed,
 * and the sitemap and the structured data say the same.
 */

const dates = new Map<string, string | undefined>();

/**
 * The date of the last commit that changed a file, as an ISO 8601 string. It is undefined where
 * git does not know the file, or where the build runs without git.
 *
 * @param file The path of the file, absolute or relative to `root`.
 * @param root The folder in which git runs. The default is the folder of the build.
 */
export function lastCommitDate(file: string, root: string = process.cwd()): string | undefined {
    const key = `${root}\n${file}`;

    if (dates.has(key)) return dates.get(key);
    let date: string | undefined;

    try {
        const said = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        if (said !== '') date = said;
    } catch {
        date = undefined;
    }
    dates.set(key, date);

    return date;
}

/** The day of an ISO date, as `2026-11-15`. */
export const dayOf = (date: string): string => date.slice(0, 10);

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/** The day of an ISO date in words, as `15 November 2026`. */
export function dayInWords(date: string): string {
    const [year = '', month = '1', day = '1'] = dayOf(date).split('-');

    return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''} ${year}`;
}
