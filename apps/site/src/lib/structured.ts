import { docPage } from './content';
import { lastCommitDate } from './git';
import { sourceOf } from './routes';
import { ORIGIN, OWNER, SHARE_IMAGE } from './seo';
import { PAGES, SITE } from './site';

/*
 * The structured data of a page, as schema.org objects for a JSON-LD block. The home page says
 * what the project is. A docs page says what it is about, when it last changed and where it
 * stands in the site. The data names the GitHub handle of the owner and no person.
 */

type Json = Record<string, unknown>;

const WEBSITE_ID = `${ORIGIN}/#website`;
const owner: Json = { '@type': 'Organization', name: OWNER.name, url: OWNER.url };
const about: Json[] = [
    { '@type': 'SoftwareApplication', name: 'Spine', url: 'https://esotericsoftware.com/' },
    { '@type': 'SoftwareApplication', name: 'PixiJS', url: 'https://pixijs.com/' },
];

/** One step of a breadcrumb trail: a name, and the route it leads to. */
interface Crumb {
    name: string;
    route: string;
}

/** The trail to a route: the home page, the part of the docs where there is one, and the page. */
function crumbsOf(route: string, title: string): Crumb[] {
    const trail: Crumb[] = [{ name: 'Home', route: '/' }];
    const section = PAGES.find((page) => page.href === route)?.section;
    const first = section === undefined ? undefined : PAGES.find((page) => page.section === section);

    if (section !== undefined && first !== undefined) trail.push({ name: section, route: first.href });
    trail.push({ name: title, route });

    return trail;
}

function breadcrumbs(trail: Crumb[]): Json {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.name,
            item: `${ORIGIN}${crumb.route}`,
        })),
    };
}

/** The date a route last changed in git, when git knows its source file. */
export function modifiedOf(route: string): string | undefined {
    const file = sourceOf(route);

    return file === undefined ? undefined : lastCommitDate(file);
}

/** What a page hands over for its structured data. */
export interface PageFacts {
    route: string;
    /** The title of the page as its heading shows it. */
    title: string;
    /** The title for search results. */
    headline: string;
    description: string;
    /** True for a page of the docs. */
    article: boolean;
}

/** The JSON-LD objects of a page. A page that search engines do not index has none. */
export function structuredData(page: PageFacts): Json[] {
    const url = `${ORIGIN}${page.route}`;

    if (page.route === '/') {
        return [
            {
                '@context': 'https://schema.org',
                '@type': 'WebSite',
                '@id': WEBSITE_ID,
                name: SITE.name,
                alternateName: 'pixi-marrow, a Spine runtime for PixiJS v8',
                url,
                description: page.description,
                inLanguage: 'en',
                publisher: owner,
            },
            {
                '@context': 'https://schema.org',
                '@type': 'SoftwareSourceCode',
                name: SITE.name,
                description: page.description,
                url,
                codeRepository: SITE.repository,
                programmingLanguage: 'TypeScript',
                runtimePlatform: 'PixiJS v8',
                version: SITE.version,
                license: `${SITE.repository}/blob/main/LICENSE`,
                author: owner,
                isPartOf: { '@id': WEBSITE_ID },
            },
        ];
    }
    const trail = breadcrumbs(crumbsOf(page.route, page.title));

    if (!page.article) return [trail];
    const modified = modifiedOf(page.route);

    return [
        {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: page.headline,
            name: page.title,
            description: page.description,
            url,
            mainEntityOfPage: url,
            inLanguage: 'en',
            ...(modified === undefined ? {} : { dateModified: modified }),
            image: `${ORIGIN}${SHARE_IMAGE.path}`,
            isPartOf: { '@type': 'WebSite', '@id': WEBSITE_ID, name: SITE.name, url: `${ORIGIN}/` },
            about,
            author: owner,
            publisher: owner,
            ...(docPage(page.route)?.section === undefined ? {} : { articleSection: docPage(page.route)?.section }),
        },
        trail,
    ];
}
