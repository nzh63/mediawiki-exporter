import stream from 'stream';
import fs from 'fs';
import { encodeXML } from 'entities';
import axios from './axios';
import { ProgressFunction, Scheduler, Task } from './scheduler';
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
    contentformat?: string;
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

interface TmpFile {
    path: string;
    writeStream: fs.WriteStream
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
        continue?: string;
        revisions?: RevisionData[];
        tmpFile?: TmpFile;
    };
}
export interface SaveToFileTask extends Task {
    type: typeof SAVE_TO_FILE;
    config: {
        pageInfo: PageInfo;
        tmpFile?: TmpFile;
        revisions: RevisionData[];
    };
}


const uncloseTags: string[] = [];

function printXmlHead(dump: stream.Writable): void {
    dump.write('<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.10/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.mediawiki.org/xml/export-0.10/ http://www.mediawiki.org/xml/export-0.10.xsd" version="0.10" xml:lang="en">');
    uncloseTags.push('mediawiki');
}

export async function getSiteInfo(scheduler: Scheduler, dump: stream.Writable, progress: ProgressFunction): Promise<void> {
    const response = await axios.get(API_URL, {
        params: {
            'action': 'query',
            'format': 'json',
            'meta': 'siteinfo',
            'siprop': 'general|namespaces|statistics',
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
    dump.write(`<sitename>${encodeXML('' + sitename)}</sitename>`);
    dump.write(`<dbname>${encodeXML('' + wikiid)}</dbname>`);
    dump.write(`<base>${encodeXML('' + base)}</base>`);
    dump.write(`<generator>${encodeXML('' + generator)}</generator>`);
    dump.write(`<case>${encodeXML('' + case_)}</case>`);
    dump.write('<namespaces>');
    uncloseTags.push('namespaces');
    for (const i in namespaces) {
        if (namespaces[i].id >= 0) { scheduler.addTask<QueryPageListTask>({ type: QUERY_PAGE_LIST, config: { ns: namespaces[i].id } }); }
        dump.write(`<namespace key="${encodeXML('' + namespaces[i].id)}" case="${encodeXML('' + namespaces[i].case)}">${encodeXML('' + namespaces[i]['*'])}</namespace>`);
    }
    uncloseTags.pop();
    dump.write('</namespaces>');
    uncloseTags.pop();
    dump.write('</siteinfo>');
    progress(0, response.data.query.statistics?.pages ?? 1);
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
    let { tmpFile } = config;
    if (response.data.continue) {
        if (!tmpFile) {
            const path = `./output/tmp/${id}.xml.tmp`;
            const writeStream = fs.createWriteStream(path);
            tmpFile = { path, writeStream };
        }
        for (const i of revisions) {
            await saveRevision(i, tmpFile.writeStream);
        }
        scheduler.addTask<QueryPageInfoTask>({
            type: QUERY_PAGE_INFO,
            config: {
                id,
                title,
                continue: response.data.continue.rvcontinue,
                tmpFile
            }
        }, true);
    } else {
        scheduler.addTask<SaveToFileTask>({
            type: SAVE_TO_FILE,
            config: {
                pageInfo: { id, title, ns },
                tmpFile,
                revisions
            }
        }, true);
    }
}

export const saveToFile = (function () {
    let fileLock = false;
    const fileWaiting: SaveToFileTask[] = [];
    return async function saveToFile(task: SaveToFileTask, scheduler: Scheduler, dump: stream.Writable, progress: ProgressFunction): Promise<void> {
        if (fileLock) {
            fileWaiting.push(task);
            return;
        }
        fileLock = true;
        const { config } = task;
        const { pageInfo: { id: pageId, title, ns }, revisions } = config;
        dump.write('<page>');
        uncloseTags.push('page');
        dump.write(`<title>${encodeXML(title)}</title>`);
        dump.write(`<ns>${encodeXML('' + ns)}</ns>`);
        dump.write(`<id>${encodeXML('' + pageId)}</id>`);
        if (config.tmpFile) {
            await new Promise(resolve => {
                config.tmpFile?.writeStream.once('end', () => config.tmpFile?.writeStream.close());
                config.tmpFile?.writeStream.once('close', () => resolve());
                config.tmpFile?.writeStream.end();
            });
            const read = fs.createReadStream(config.tmpFile.path);
            read.pipe(dump, { end: false });
            await new Promise(resolve => {
                read.once('end', async () => {
                    if (config.tmpFile) await fs.promises.unlink(config.tmpFile?.path);
                    resolve();
                });
            });
        }
        for (const i of revisions) {
            await saveRevision(i, dump);
        }
        uncloseTags.pop();
        dump.write('</page>');
        fileLock = false;
        if (fileWaiting.length) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            scheduler.addTask(fileWaiting.shift()!, true);
        }
        progress();
    };
})();

async function saveRevision(revision: RevisionData, dump: stream.Writable): Promise<void> {
    const { revid, parentid, timestamp, user, userid, comment, sha1, size, contentmodel, contentformat, anon, minor, '*': text } = revision;
    dump.write('<revision>');
    dump.write(`<id>${encodeXML('' + revid)}</id>`);
    if (parentid) { dump.write(`<parentid>${encodeXML('' + parentid)}</parentid>`); }
    dump.write(`<timestamp>${encodeXML(timestamp)}</timestamp>`);
    if (!revision.userhidden) {
        if (anon) {
            dump.write(`<contributor><ip>${encodeXML(user)}</ip></contributor>`);
        } else {
            dump.write(`<contributor><username>${encodeXML(user)}</username><id>${encodeXML('' + userid)}</id></contributor>`);
        }
    } else {
        dump.write('<contributor deleted="deleted" />');
    }
    if (minor) {
        dump.write('<minor />');
    }
    if (!revision.commenthidden) {
        dump.write(`<comment>${encodeXML(comment)}</comment>`);
    } else {
        dump.write('<comment deleted="deleted" />');
    }
    dump.write(`<model>${encodeXML(contentmodel)}</model>`);
    dump.write(`<format>${encodeXML('' + (contentformat ?? 'text/x-wiki'))}</format>`);
    if (!revision.texthidden) {
        dump.write(`<text xml:space="preserve" bytes="${encodeXML('' + size)}">${encodeXML(text)}</text>`);
    } else {
        dump.write(`<text bytes="${encodeXML('' + size)}" deleted="deleted" />`);
    }
    if (!revision.sha1hidden) {
        // see /mediawiki/includes/api/ApiQueryRecentChanges.php:612
        const sha1String = BigInt('0x' + sha1).toString(36);
        dump.write(`<sha1>${encodeXML(sha1String)}</sha1>`);
    } else {
        dump.write('<sha1 />');
    }
    dump.write('</revision>');
}

export function solveUncloseTags(dump: stream.Writable): void {
    while (uncloseTags.length) {
        dump.write(`</${uncloseTags.pop()}>`);
    }
}