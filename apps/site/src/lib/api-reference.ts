import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SITE_ROOT } from './routes';

/*
 * The API reference, read from the built declarations of the package while the site builds.
 *
 * The entry points come from the `exports` of `packages/pixi-marrow/package.json`. For each one
 * this module reads the `.d.ts` file of the entry, follows every exported name to the file that
 * declares it, and keeps the declaration with its JSDoc. A class and an interface give one
 * member per property and method, and a class also gives the public members of the classes of
 * the package that it extends. Nobody keeps these pages by hand. A new export or a new entry
 * point shows with the next build.
 *
 * The site build type-checks its snippets against the built package first, so `dist` is always
 * there when this runs. The reader works on text, with no type checker, as
 * `scripts/check-api.mjs` does. It expects the declarations as the build writes them: one
 * statement per declaration, and members that end with a semicolon.
 */

/** The folder of the package. */
const PACKAGE = join(SITE_ROOT, '../../packages/pixi-marrow');

/** What a JSDoc comment says. */
export interface ApiDoc {
    /** The text before the first tag, as Markdown. */
    text: string;
    /** The first sentence of the text, for a table of exports. */
    summary: string;
    /** The code of each `@example` tag. */
    examples: string[];
    /** Each `@param` tag: the name of the parameter and what the tag says about it. */
    params: { name: string; text: string }[];
}

/** A property or a method of a class or an interface. */
interface ApiMember {
    name: string;
    /** The name as the page shows it, such as `play()` or `MarrowSpine.load()`. */
    title: string;
    /** The id of the member on its page, such as `marrowspine-play`. */
    anchor: string;
    /** The declaration of the member, without comments. */
    signature: string;
    doc: ApiDoc;
    /** The class or interface that declares the member, when it is not the symbol itself. */
    from?: string;
}

/** The kinds of declaration that an entry point exports. */
type ApiKind = 'class' | 'function' | 'interface' | 'type' | 'const' | 'enum';

/** One export of an entry point. */
interface ApiSymbol {
    name: string;
    kind: ApiKind;
    /** True when the entry exports the name as a type only. */
    typeOnly: boolean;
    /** The id of the symbol on its page: its name in lower case. */
    anchor: string;
    /** The declaration without comments. For a class or an interface it is the head only. */
    signature: string;
    doc: ApiDoc;
    members: ApiMember[];
}

/** One entry point of the package, with what it exports. */
export interface ApiEntry {
    /** What an import names, such as `pixi-marrow/core`. */
    name: string;
    /** The last part of the route of its page, such as `core`. */
    slug: string;
    /** The route of its page, such as `/api/core/`. */
    href: string;
    /** The comment at the top of the entry file. */
    doc: ApiDoc;
    symbols: ApiSymbol[];
}

const KINDS = 'class|function|const|let|var|interface|type|enum';
const MODIFIERS = '(?:declare\\s+)?(?:abstract\\s+)?';
const BLOCKS = new Set(['class', 'interface', 'enum']);
const EMPTY_DOC: ApiDoc = { text: '', summary: '', examples: [], params: [] };

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const files = new Map<string, string>();

function read(file: string): string {
    let text = files.get(file);

    if (text === undefined) {
        text = readFileSync(file, 'utf8');
        files.set(file, text);
    }

    return text;
}

/** The lines of a JSDoc comment without its frame of stars. */
function commentLines(comment: string): string[] {
    return comment
        .replace(/^\/\*\*/, '')
        .replace(/\*\/$/, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\* ?/, '').replace(/\s+$/, ''));
}

/** What a JSDoc comment says: its text, its examples and its parameters. */
function parseDoc(comment: string): ApiDoc {
    if (comment === '') return EMPTY_DOC;
    const parts: { tag: string; lines: string[] }[] = [{ tag: '', lines: [] }];

    for (const line of commentLines(comment)) {
        const tag = /^@(\w+)\s?(.*)$/.exec(line);

        if (tag === null) parts[parts.length - 1]?.lines.push(line);
        else parts.push({ tag: tag[1] ?? '', lines: [tag[2] ?? ''] });
    }
    const body = (lines: string[]): string => lines.join('\n').trim();
    const text = body(parts[0]?.lines ?? []);
    const first = text.split(/\n\s*\n/)[0]?.replace(/\s*\n\s*/g, ' ') ?? '';
    const doc: ApiDoc = {
        text,
        summary: /^(.*?[.!?])(\s|$)/.exec(first)?.[1] ?? first,
        examples: [],
        params: [],
    };

    for (const part of parts.slice(1)) {
        const said = body(part.lines);

        if (part.tag === 'example') doc.examples.push(said.replace(/^```\w*\n/, '').replace(/\n```$/, ''));
        else if (part.tag === 'param') {
            const param = /^(\S+)\s*-?\s*([\s\S]*)$/.exec(said);

            doc.params.push({ name: param?.[1] ?? '', text: (param?.[2] ?? '').replace(/\s*\n\s*/g, ' ') });
        } else doc.text += `\n\n${part.tag[0]?.toUpperCase() ?? ''}${part.tag.slice(1)}: ${said}`;
    }

    return doc;
}

/** The index after the end of the statement that starts at `start`. It skips comments. */
function statementEnd(text: string, start: number, kind: string): number {
    let depth = 0;

    for (let i = start; i < text.length; i++) {
        if (text.startsWith('/*', i)) {
            i = text.indexOf('*/', i) + 1;
            continue;
        }
        const ch = text[i];

        if (ch === '{' || ch === '(') depth++;
        else if (ch === '}' || ch === ')') {
            depth--;
            if (depth === 0 && ch === '}' && BLOCKS.has(kind)) return i + 1;
        } else if (ch === ';' && depth === 0) return i + 1;
    }

    return text.length;
}

/** A name of a list such as `type A, B as C`: the local name, the exported name, and whether it is a type only. */
function listNames(list: string): { local: string; exported: string; typeOnly: boolean }[] {
    return list
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .map((part) => {
            const typeOnly = /^type\s+/.test(part);
            const [local = '', exported = local] = part.replace(/^type\s+/, '').split(/\s+as\s+/);

            return { local, exported, typeOnly };
        });
}

const moduleFile = (from: string, specifier: string): string | undefined =>
    specifier.startsWith('.') ? join(dirname(from), specifier.replace(/\.js$/, '.d.ts')) : undefined;

/** The names that a declaration file imports from other files of the package: the name there and its file. */
function importsOf(file: string): Map<string, { name: string; file: string }> {
    const found = new Map<string, { name: string; file: string }>();
    const code = stripComments(read(file));

    for (const match of code.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        const target = moduleFile(file, match[2] ?? '');

        if (target === undefined) continue;
        for (const { local, exported } of listNames(match[1] ?? '')) found.set(exported, { name: local, file: target });
    }

    return found;
}

/** A declaration of a name, as its file holds it. */
interface Declaration {
    kind: ApiKind;
    /** The statement with its comments. */
    text: string;
    /** The JSDoc comment before the statement, or an empty string. */
    comment: string;
    file: string;
}

/** Every declaration of a name in a file. A name that the file only passes on is followed to its own file. */
function declarationsOf(name: string, file: string, depth = 0): Declaration[] {
    if (!existsSync(file) || depth > 8) return [];
    const text = read(file);
    const pattern = new RegExp(`^(?:export\\s+)?${MODIFIERS}(${KINDS})\\s+${name}\\b`, 'gm');
    const found: Declaration[] = [];

    for (const match of text.matchAll(pattern)) {
        const said = match[1] ?? 'const';
        const kind: ApiKind = said === 'let' || said === 'var' ? 'const' : (said as ApiKind);
        const before = text.slice(0, match.index).trimEnd();

        found.push({
            kind,
            text: text.slice(match.index, statementEnd(text, match.index, kind)),
            comment: before.endsWith('*/') ? before.slice(before.lastIndexOf('/**')) : '',
            file,
        });
    }
    if (found.length > 0) return found;
    const code = stripComments(text);

    for (const match of code.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        const passed = listNames(match[1] ?? '').find((item) => item.exported === name);
        const target = moduleFile(file, match[2] ?? '');

        if (passed !== undefined && target !== undefined) return declarationsOf(passed.local, target, depth + 1);
    }
    const origin = importsOf(file).get(name);

    return origin === undefined ? [] : declarationsOf(origin.name, origin.file, depth + 1);
}

/** A statement without comments, empty lines, `export` and `declare`. */
function clean(statement: string): string {
    return stripComments(statement)
        .split('\n')
        .filter((line) => line.trim() !== '')
        .join('\n')
        .replace(/^export\s+/, '')
        .replace(/^declare\s+/, '');
}

/** Lines without the indent that all of them share. */
function dedent(text: string): string {
    const lines = text.split('\n');
    const indent = Math.min(
        ...lines
            .slice(1)
            .filter((line) => line.trim() !== '')
            .map((line) => line.search(/\S/)),
    );

    return lines
        .map((line, index) => (index === 0 || !Number.isFinite(indent) ? line.trim() : line.slice(indent)))
        .join('\n')
        .trim();
}

/** A member as the body of a class or an interface holds it. */
interface RawMember {
    text: string;
    comment: string;
}

/** The members in the body of a class or an interface, each with the JSDoc comment before it. */
function rawMembers(body: string): RawMember[] {
    const found: RawMember[] = [];
    let depth = 0;
    let comment = '';
    let start = 0;

    for (let i = 0; i < body.length; i++) {
        const ch = body[i];

        if (body.startsWith('/*', i)) {
            const end = body.indexOf('*/', i) + 2;

            // a comment between two members belongs to the member after it
            if (depth === 0 && body.slice(start, i).trim() === '') {
                comment = body.startsWith('/**', i) ? body.slice(i, end) : '';
                start = end;
            }
            i = end - 1;
        } else if (ch === '{' || ch === '(' || ch === '[') depth++;
        else if (ch === '}' || ch === ')' || ch === ']') depth--;
        else if (ch === ';' && depth === 0) {
            found.push({ text: dedent(stripComments(body.slice(start, i + 1))), comment });
            comment = '';
            start = i + 1;
        }
    }

    return found.filter((member) => member.text !== ';');
}

const MEMBER_MODIFIERS = /^(?:(?:public|static|readonly|abstract|override|declare|get|set)\s+)*/;
const BLOCK_HEAD = /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class|interface)\s+([\w$]+)/;

/** The key of a member among the members of its owner: a static member and one of an instance can share a name. */
const memberKey = (owner: string, member: ApiMember): string =>
    `${member.title.startsWith(`${owner}.`) ? 'static ' : ''}${member.name}`;

/** One member of a body as the reference shows it, or undefined for a member that is not public. */
function memberOf(raw: RawMember, owner: string, declared: string): ApiMember | undefined {
    if (/^(private|protected|#)/.test(raw.text)) return undefined;
    const rest = raw.text.replace(MEMBER_MODIFIERS, '');
    const name = /^(constructor|[\w$]+|\[[^\]]+\])/.exec(rest)?.[1];

    if (name === undefined) return undefined;
    const isStatic = /^(?:\w+\s+)*static\s/.test(raw.text);
    const isAccessor = /^(?:\w+\s+)*(?:get|set)\s+[\w$]+\s*\(/.test(raw.text);
    const isMethod = !isAccessor && /^[(<]/.test(rest.slice(name.length).replace(/^\?/, ''));

    return {
        name,
        title: `${isStatic ? `${owner}.` : ''}${name}${isMethod ? '()' : ''}`,
        anchor: '',
        signature: raw.text,
        doc: parseDoc(raw.comment),
        ...(declared === owner ? {} : { from: declared }),
    };
}

/** The code of a declaration split at its first brace that is not in a comment: the head and the body. */
function splitBlock(code: string): { head: string; body: string } {
    let at = 0;

    while (at < code.length && code[at] !== '{') at = code.startsWith('/*', at) ? code.indexOf('*/', at) + 2 : at + 1;

    return { head: stripComments(code.slice(0, at)).trim(), body: code.slice(at + 1, code.lastIndexOf('}')) };
}

/** Text without what stands in angle brackets: the type parameters of a head, with their own `extends`. */
function withoutTypeParameters(text: string): string {
    let depth = 0;
    let out = '';

    for (const ch of text) {
        if (ch === '<') depth++;
        else if (ch === '>') depth--;
        else if (depth === 0) out += ch;
    }

    return out;
}

/** The classes and interfaces of the package that a head extends, as declarations. */
function parentsOf(head: string, file: string, seen: Set<string>): Declaration[] {
    const list = /\bextends\s+([^{]+?)(?:\s+implements\b|$)/.exec(withoutTypeParameters(head))?.[1] ?? '';

    return list
        .split(',')
        .map((base) => /^\s*([\w$]+)/.exec(base)?.[1])
        .filter((name): name is string => name !== undefined && !seen.has(name))
        .flatMap((name) => declarationsOf(name, file))
        .filter((parent) => parent.kind === 'class' || parent.kind === 'interface');
}

/** The public members of a class or an interface declaration, with those of what it extends in the package. */
function membersOf(declaration: Declaration, owner: string, seen: Set<string> = new Set()): ApiMember[] {
    const { head, body } = splitBlock(declaration.text);
    const declared = BLOCK_HEAD.exec(head)?.[1] ?? owner;
    const members = new Map<string, ApiMember>();

    for (const raw of rawMembers(body)) {
        const member = memberOf(raw, owner, declared);

        if (member === undefined) continue;
        const known = members.get(memberKey(owner, member));

        // a getter and a setter of one name are one member
        if (known === undefined) members.set(memberKey(owner, member), member);
        else {
            known.signature += `\n${raw.text}`;
            if (known.doc === EMPTY_DOC) known.doc = member.doc;
        }
    }
    seen.add(declared);
    for (const parent of parentsOf(head, declaration.file, seen)) {
        for (const member of membersOf(parent, owner, seen)) {
            if (!members.has(memberKey(owner, member))) members.set(memberKey(owner, member), member);
        }
    }

    return [...members.values()];
}

/** The head of a class or an interface: its declaration up to the brace. */
function headOf(statement: string): string {
    const code = clean(statement);

    return code.slice(0, code.indexOf('{')).trim();
}

/** One export of an entry file, as a symbol of the reference. */
function symbolOf(name: string, typeOnly: boolean, declarations: Declaration[]): ApiSymbol | undefined {
    const first = declarations[0];

    if (first === undefined) return undefined;
    const block = first.kind === 'class' || first.kind === 'interface';
    const anchor = name.toLowerCase();
    const used = new Set<string>();
    const members = block ? declarations.flatMap((declaration) => membersOf(declaration, name)) : [];

    for (const member of members) {
        const base = `${anchor}-${member.name.toLowerCase().replace(/[^\w$]+/g, '')}`;
        let id = base;

        if (used.has(id)) id = `${base}-static`;
        for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        member.anchor = id;
    }

    return {
        name,
        kind: first.kind,
        typeOnly,
        anchor,
        signature: block ? headOf(first.text) : declarations.map((declaration) => clean(declaration.text)).join('\n'),
        doc: parseDoc(declarations.find((declaration) => declaration.comment !== '')?.comment ?? ''),
        members,
    };
}

/** What an entry file exports, as symbols in the order of their names. */
function symbolsOf(file: string): ApiSymbol[] {
    const code = stripComments(read(file));
    const imported = importsOf(file);
    const found = new Map<string, ApiSymbol>();
    const add = (exported: string, typeOnly: boolean, declarations: Declaration[]): void => {
        const symbol = symbolOf(exported, typeOnly, declarations);

        if (symbol !== undefined) found.set(exported, symbol);
    };

    for (const match of code.matchAll(/export\s*(type\s*)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
        const target = match[3] === undefined ? undefined : moduleFile(file, match[3]);

        for (const { local, exported, typeOnly } of listNames(match[2] ?? '')) {
            const origin = target === undefined ? imported.get(local) : { name: local, file: target };

            add(
                exported,
                typeOnly || match[1] !== undefined,
                origin === undefined ? declarationsOf(local, file) : declarationsOf(origin.name, origin.file),
            );
        }
    }
    for (const match of code.matchAll(new RegExp(`^export\\s+${MODIFIERS}(?:${KINDS})\\s+([\\w$]+)`, 'gm'))) {
        add(match[1] ?? '', false, declarationsOf(match[1] ?? '', file));
    }

    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let entries: ApiEntry[] | undefined;

/** The entry points of the package with their exports, in the order of `exports` in its `package.json`. */
export function apiEntries(): ApiEntry[] {
    if (entries !== undefined) return entries;
    const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as {
        exports: Record<string, string | { types?: string }>;
    };

    entries = [];
    for (const [key, target] of Object.entries(manifest.exports)) {
        if (typeof target === 'string' || target.types === undefined) continue;
        const file = join(PACKAGE, target.types);
        const slug = key === '.' ? 'pixi-marrow' : key.slice(2);

        if (!existsSync(file)) {
            throw new Error(`The API reference needs ${file}. Run "pnpm build" in the root of the repo first.`);
        }
        const top = /^\s*(\/\*\*[\s\S]*?\*\/)/.exec(read(file))?.[1] ?? '';

        entries.push({
            name: key === '.' ? 'pixi-marrow' : `pixi-marrow/${slug}`,
            slug,
            href: `/api/${slug}/`,
            doc: parseDoc(top),
            symbols: symbolsOf(file),
        });
    }

    return entries;
}

let places: Map<string, string> | undefined;

/**
 * The address of a name of the API, such as `Track` or `MarrowSpine.play`, or undefined for a
 * name that no entry point exports. A name of several entry points leads to the first of them.
 */
export function apiLink(name: string): string | undefined {
    if (places === undefined) {
        places = new Map();
        for (const entry of apiEntries()) {
            for (const symbol of entry.symbols) {
                if (!places.has(symbol.name)) places.set(symbol.name, `${entry.href}#${symbol.anchor}`);
                for (const member of symbol.members) {
                    const key = `${symbol.name}.${member.name}`;

                    if (!places.has(key)) places.set(key, `${entry.href}#${member.anchor}`);
                }
            }
        }
    }

    return places.get(name.replace(/\(\)$/, '').replace('#', '.'));
}

/** An entry point as Markdown: every export with its declaration, its text and its examples. */
export function apiMarkdown(entry: ApiEntry, origin: string): string {
    const unlink = (text: string): string => text.replace(/\{@link\s+([^}|\s]+)[^}]*\}/g, '`$1`');
    const docOf = (doc: ApiDoc): string[] => [
        ...(doc.text === '' ? [] : [unlink(doc.text), '']),
        ...doc.params.map((param) => `- \`${param.name}\`: ${unlink(param.text)}`),
        ...(doc.params.length > 0 ? [''] : []),
        ...doc.examples.flatMap((example) => ['Example:', '', '```ts', example, '```', '']),
    ];
    const lines = [
        `# API: ${entry.name}`,
        '',
        `> ${unlink(entry.doc.text).replace(/\s*\n\s*/g, ' ')}`,
        '',
        `Source: ${origin}${entry.href}`,
        '',
    ];

    for (const symbol of entry.symbols) {
        lines.push(`## ${symbol.name}`, '', '```ts', symbol.signature, '```', '', ...docOf(symbol.doc));
        for (const member of symbol.members) {
            lines.push(
                `### ${symbol.name}: ${member.title}`,
                '',
                '```ts',
                member.signature,
                '```',
                '',
                ...docOf(member.doc),
            );
        }
    }

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
