import stream from 'stream';
import { escape } from 'jsontoxml';
import axios from './axios';
import { Scheduler, Task } from './scheduler';
import { API_URL, TITLE_BLACK_LIST } from './config';

interface PageInfo {
    id: number;
    title: string;
    ns: number;
    missing?: "";
}

interface PageInfoWithRevisions extends PageInfo {
    revisions?: RevisionData[]
}

interface RevisionData {
    revid: number;
    parentid: number;
    timestamp: string;
    user: string;
    userid: number;
    sha1: string;
    size: number;
    contentmodel: string;
    contentformat: string;
    comment: string;
    '*': string;
    anon?: boolean | "";
    minor?: boolean | "";
    userhidden?: boolean | "";
    texthidden?: boolean | "";
    commenthidden?: boolean | "";
    sha1hidden?: boolean | "";
}

interface QueryPageResp {
    continue?: {
        rvcontinue: string;
    }
    query: {
        pages: {
            [is: number]: PageInfoWithRevisions
        }
    }
}

export const QUERY_SITE_INFO = Symbol('QUERY_SITE_INFO');
export const QUERY_PAGE_LIST = Symbol('QUERY_PAGE_LIST');
export const QUERY_PAGE_INFO = Symbol('QUERY_PAGE_INFO');
export const SAVE_TO_FILE = Symbol('SAVE_TO_FILE');

export interface QuerySiteInfoTask extends Task {
    type: typeof QUERY_SITE_INFO;
}
export interface QueryPageListTask extends Task {
    type: typeof QUERY_PAGE_LIST;
    config: {
        ns: number;
        continue?: string;
    };
}
export interface QueryPageInfoTask extends Task {
    type: typeof QUERY_PAGE_INFO;
    config: {
        id: number;
        title?: string;
        revisions?: RevisionData[];
        continue?: string;
    };
}
export interface SaveToFileTask extends Task {
    type: typeof SAVE_TO_FILE;
    config: {
        pageInfo: PageInfo;
        revisions: RevisionData[];
    };
}


const uncloseTags: string[] = [];

function printXmlHead(dump: stream.Writable): void {
    dump.write('<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.10/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.mediawiki.org/xml/export-0.10/ http://www.mediawiki.org/xml/export-0.10.xsd" version="0.10" xml:lang="en">');
    uncloseTags.push('mediawiki');
}

export async function getSiteInfo(scheduler: Scheduler, dump: stream.Writable): Promise<void> {
    const response = await axios.get(API_URL, {
        params: {
            'action': 'query',
            'format': 'json',
            'meta': 'siteinfo',
            'siprop': 'general|namespaces',
            'utf8': 1
        }
    });
    if (response.statusText !== 'OK') {
        throw { code: 'network', message: 'Network error while getting site info', retry: 1 };
    }
    const { sitename, base, generator, wikiid, case: case_ } = response.data.query.general;
    const namespaces = response.data.query.namespaces;
    printXmlHead(dump);
    dump.write('<siteinfo>');
    uncloseTags.push('siteinfo');
    dump.write(`<sitename>${escape(sitename)}</sitename>`);
    dump.write(`<dbname>${escape(wikiid)}</dbname>`);
    dump.write(`<base>${escape(base)}</base>`);
    dump.write(`<generator>${escape(generator)}</generator>`);
    dump.write(`<case>${escape(case_)}</case>`);
    dump.write('<namespaces>');
    uncloseTags.push('namespaces');
    for (const i in namespaces) {
        if (namespaces[i].id >= 0) { scheduler.addTask<QueryPageListTask>({ type: QUERY_PAGE_LIST, config: { ns: namespaces[i].id } }); }
        dump.write(`<namespace key="${escape(namespaces[i].id)}" case="${escape(namespaces[i].case)}">${escape(namespaces[i]['*'])}</namespace>`);
    }
    uncloseTags.pop();
    dump.write('</namespaces>');
    uncloseTags.pop();
    dump.write('</siteinfo>');

}

export async function getPageList(task: QueryPageListTask, scheduler: Scheduler): Promise<void> {
    const { config } = task;
    const { ns } = config;
    const params = {
        'action': 'query',
        'format': 'json',
        'list': 'allpages',
        'apnamespace': ns,
        'aplimit': 'max',
        'utf8': 1,
        'apcontinue': '' as string | undefined
    };
    if (config.continue) {
        params.apcontinue = config.continue;
    } else {
        delete params.apcontinue;
    }
    const response = await axios.get(API_URL, {
        params: params
    });
    if (response.statusText !== 'OK') {
        throw { code: 'network', message: 'Network error while getting page list in namespace ' + ns, retry: 1 };
    }
    const { allpages } = response.data.query;
    for (const i of allpages) {
        if (!TITLE_BLACK_LIST.some(r => new RegExp(r).test(i.title))) {
            scheduler.addTask<QueryPageInfoTask>({ type: QUERY_PAGE_INFO, config: { id: i.pageid, title: i.title } }, true);
        }
    }
    if (response.data.continue) {
        scheduler.addTask<QueryPageListTask>({
            type: QUERY_PAGE_LIST,
            config: {
                ns,
                continue: response.data.continue.apcontinue
            }
        });
    }

}

export async function getPageInfo(task: QueryPageInfoTask, scheduler: Scheduler): Promise<void> {
    const { config } = task;
    const { id } = config;
    const params = {
        'action': 'query',
        'format': 'json',
        'prop': 'pageprops|revisions',
        'pageids': id,
        'rvprop': 'ids|timestamp|flags|comment|user|userid|sha1|size|content|contentmodel',
        'rvlimit': 'max',
        'rvcontinue': '' as string | undefined,
        'utf8': 1
    };
    if (config.continue) {
        params.rvcontinue = config.continue;
    } else {
        delete params.rvcontinue;
    }

    const response = await axios.get<QueryPageResp>(API_URL, {
        params: params
    });
    if (response.statusText !== 'OK') {
        throw { code: 'network', message: 'Network error while getting page info ' + id, retry: 1 };
    }
    const { title, ns, missing } = response.data.query.pages[id];
    if (typeof missing !== 'undefined' || /^Special:Badtitle/.test(title)) { return; }

    const revisions = config.revisions ?? [];
    revisions.push(...response.data.query.pages[id].revisions?.map(i => ({
        ...i,
        anon: typeof i.anon !== 'undefined',
        minor: typeof i.minor !== 'undefined',
        userhidden: typeof i.userhidden !== 'undefined',
        texthidden: typeof i.texthidden !== 'undefined',
        commenthidden: typeof i.commenthidden !== 'undefined',
        sha1hidden: typeof i.sha1hidden !== 'undefined',
    })) ?? []);
    if (response.data.continue) {
        scheduler.addTask<QueryPageInfoTask>({
            type: QUERY_PAGE_INFO,
            config: {
                id,
                title,
                revisions,
                continue: response.data.continue.rvcontinue
            }
        }, true);
    } else {
        scheduler.addTask<SaveToFileTask>({
            type: SAVE_TO_FILE,
            config: {
                pageInfo: { id, title, ns },
                revisions
            }
        }, true);
    }
}

export async function saveToFile(task: SaveToFileTask, dump: stream.Writable): Promise<void> {
    const { config } = task;
    const { pageInfo: { id: pageId, title, ns }, revisions } = config;
    dump.write('<page>');
    uncloseTags.push('page');
    dump.write(`<title>${escape(title)}</title>`);
    dump.write(`<ns>${escape('' + ns)}</ns>`);
    dump.write(`<id>${escape('' + pageId)}</id>`);
    for (const i of revisions) {
        if (!i) continue;
        const { revid, parentid, timestamp, user, userid, comment, sha1, size, contentmodel, contentformat, anon, minor, '*': text } = i;
        dump.write('<revision>');
        uncloseTags.push('revision');
        dump.write(`<id>${escape('' + revid)}</id>`);
        if (parentid) { dump.write(`<parentid>${escape('' + parentid)}</parentid>`); }
        dump.write(`<timestamp>${escape(timestamp)}</timestamp>`);
        if (!i.userhidden) {
            if (anon) {
                dump.write(`<contributor><ip>${escape(user)}</ip></contributor>`);
            } else {
                dump.write(`<contributor><username>${escape(user)}</username><id>${escape('' + userid)}</id></contributor>`);
            }
        } else {
            dump.write('<contributor deleted="deleted" />');
        }
        if (minor) {
            dump.write('<minor />');
        }
        if (!i.commenthidden) {
            dump.write(`<comment>${escape(comment)}</comment>`);
        } else {
            dump.write('<comment deleted="deleted" />');
        }
        dump.write(`<model>${escape(contentmodel)}</model>`);
        dump.write(`<format>${escape('' + contentformat)}</format>`);
        if (!i.texthidden) {
            dump.write(`<text xml:space="preserve" bytes="${escape('' + size)}">${escape(text)}</text>`);
        } else {
            dump.write(`<text bytes="${escape('' + size)}" deleted="deleted" />`);
        }
        if (!i.sha1hidden) {
            // see /mediawiki/includes/api/ApiQueryRecentChanges.php:612
            const sha1String = BigInt('0x' + sha1).toString(36);
            dump.write(`<sha1>${escape(sha1String)}</sha1>`);
        } else {
            dump.write('<sha1 />');
        }
        uncloseTags.pop();
        dump.write('</revision>');
    }
    uncloseTags.pop();
    dump.write('</page>');
}

export function solveUncloseTags(dump: stream.Writable): void {
    while (uncloseTags.length) {
        dump.write(`</${uncloseTags.pop()}>`);
    }
}