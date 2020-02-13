import fs from 'fs';
import axios from 'axios';
import jsontoxml from 'jsontoxml';
import { addTask } from './task';
import { API_URL, DBNAME, TITLE_BLACK_LIST, HTTP_TIMEOUT } from './config';

export interface PageListConfig {
    ns: number;
    continue?: string;
}
export interface PageInfoConfig {
    id: number;
    title?: string;
    continue?: string;
}
export interface RevisionInfoConfig {
    page_info: PageInfo;
    revision: RevisionInfo;
}
export interface SaveToFileConfig {
    page_info: PageInfo;

}
interface PageInfo {
    id: number;
    title: string;
    ns: number;
}
interface RevisionInfo {
    revid: number;
    parentid: number;
    timestamp: string;
    user: string;
    sha1: string;
    contentmodel: string;
    comment: string;
    text: string;
    anon?: boolean;
    minor?: boolean;
}
interface ReadingPage {
    [index: number]: Promise<RevisionInfo>[];
}

export const QUERY_SITE_INFO = Symbol('QUERY_SITE_INFO');
export const QUERY_PAGE_LIST = Symbol('QUERY_PAGE_LIST');
export const QUERY_PAGE_INFO = Symbol('QUERY_PAGE_INFO');
export const QUERY_REVISION_INFO = Symbol('QUERY_REVISION_INFO');
export const SAVE_TO_FILE = Symbol('SAVE_TO_FILE');

const unclose_tags: string[] = [];
const reading_page: ReadingPage = {};

const source = axios.CancelToken.source();
axios.defaults.cancelToken = source.token;
axios.defaults.timeout = HTTP_TIMEOUT;

function printXmlHead(dump: fs.WriteStream): void {
    dump.write('<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.10/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.mediawiki.org/xml/export-0.10/ http://www.mediawiki.org/xml/export-0.10.xsd" version="0.10" xml:lang="en">');
    unclose_tags.push('mediawiki');
}

async function getSiteInfo(dump: fs.WriteStream): Promise<void> {
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
    const { sitename, base, generator, case: case_ } = response.data.query.general;
    const namespaces = response.data.query.namespaces;
    printXmlHead(dump);
    dump.write('<siteinfo>');
    unclose_tags.push('siteinfo');
    dump.write(`<sitename>${jsontoxml.escape(sitename)}</sitename>`);
    dump.write(`<dbname>${jsontoxml.escape(DBNAME)}</dbname>`);
    dump.write(`<base>${jsontoxml.escape(base)}</base>`);
    dump.write(`<generator>${jsontoxml.escape(generator)}</generator>`);
    dump.write(`<case>${jsontoxml.escape(case_)}</case>`);
    dump.write('<namespaces>');
    unclose_tags.push('namespaces');
    for (const i in namespaces) {
        if (namespaces[i].id >= 0) { addTask({ type: QUERY_PAGE_LIST, config: { ns: namespaces[i].id } }); }
        dump.write(`<namespace key="${jsontoxml.escape(namespaces[i].id)}" case="${jsontoxml.escape(namespaces[i].case)}">${jsontoxml.escape(namespaces[i]['*'])}</namespace>`);
    }
    unclose_tags.pop();
    dump.write('</namespaces>');
    unclose_tags.pop();
    dump.write('</siteinfo>');

}

async function getPageList(config: PageListConfig): Promise<void> {
    const { ns } = config;
    const params = {
        'action': 'query',
        'format': 'json',
        'list': 'allpages',
        'apnamespace': ns,
        'aplimit': 'max',
        'utf8': 1,
        'apcontinue': ''
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
            addTask({ type: QUERY_PAGE_INFO, config: { id: i.pageid, title: i.title } });
        }
    }
    if (response.data.continue) {
        addTask({
            type: QUERY_PAGE_LIST,
            config: {
                ns,
                continue: response.data.continue.apcontinue
            }
        }, true);
    }

}

async function getPageInfo(config: PageInfoConfig): Promise<void> {
    const { id } = config;
    const params = {
        'action': 'query',
        'format': 'json',
        'prop': 'pageprops|revisions',
        'pageids': id,
        'rvprop': 'ids|timestamp|flags|comment|user|sha1|contentmodel',
        'rvlimit': 'max',
        'pclimit': 'max',
        'rvcontinue': '',
        'utf8': 1
    };
    if (config.continue) {
        params.rvcontinue = config.continue;
    } else {
        delete params.rvcontinue;
    }
    const response = await axios.get(API_URL, {
        params: params
    });
    if (response.statusText !== 'OK') {
        throw { code: 'network', message: 'Network error while getting page info ' + id, retry: 1 };
    }
    const { revisions, title, ns, missing } = response.data.query.pages[id];
    if (typeof missing !== 'undefined' || /^Special:Badtitle/.test(title)) { return; }
    if (!(response.data.continue)) {
        addTask({
            type: SAVE_TO_FILE,
            config: { id: id, page_info: { id, title, ns } }
        }, true);
    }
    for (const revision of revisions) {
        addTask({
            type: QUERY_REVISION_INFO,
            config: { page_info: { id, ns, title }, revision }
        }, true);
    }
    if (response.data.continue) {
        addTask({
            type: QUERY_PAGE_INFO,
            config: {
                id,
                continue: response.data.continue.rvcontinue
            }
        }, true);
    }
}

async function getRevisionInfo(config: RevisionInfoConfig): Promise<void> {
    const page_id = config.page_info.id;
    const req = _getRevisionInfo(config);
    reading_page[page_id].push(req);
    try {
        await req;
    } catch (e) {
        reading_page[page_id].splice(reading_page[page_id].indexOf(req), 1);
        throw e;
    }
}

async function _getRevisionInfo(config: RevisionInfoConfig): Promise<RevisionInfo> {
    const { page_info, revision } = config;
    const { id: page_id } = page_info;
    const { revid, parentid, timestamp, user, sha1, contentmodel, comment } = revision;
    reading_page[page_id] = reading_page[page_id] || [];
    const response = await axios.get(API_URL, {
        params: {
            'action': 'parse',
            'format': 'json',
            'oldid': revid,
            'prop': 'wikitext',
            'utf8': 1
        }
    });
    if (response.statusText !== 'OK') {
        throw { code: 'network', message: 'Network error while getting revision info ' + revision, retry: 1 };
    }
    const { wikitext } = response.data.parse;
    const data: RevisionInfo = {
        revid,
        parentid,
        timestamp,
        user,
        comment,
        sha1,
        contentmodel,
        anon: typeof revision.anon !== 'undefined',
        minor: typeof revision.minor !== 'undefined',
        text: wikitext['*']
    };
    return data;
}

async function saveToFile(config: SaveToFileConfig, dump: fs.WriteStream): Promise<void> {
    const { id: page_id, title, ns } = config.page_info;
    const format: { [index: string]: string | void } = {
        wikitext: 'text/x-wiki',
        javascript: 'text/javascript',
        json: 'application/json',
        css: 'text/css',
        default: 'text/plain'
    };
    let data = undefined;
    while (typeof data === "undefined") {
        try {
            data = await Promise.all(reading_page[page_id]);
        } catch (error) {
            // donothing
        }
    }
    delete reading_page[page_id];
    dump.write('<page>');
    unclose_tags.push('page');
    dump.write(`<title>${jsontoxml.escape(title)}</title>`);
    dump.write(`<ns>${jsontoxml.escape('' + ns)}</ns>`);
    dump.write(`<id>${jsontoxml.escape('' + page_id)}</id>`);
    for (const i of data) {
        let { revid, parentid, timestamp, user, comment, sha1, contentmodel, anon, minor, text } = i;
        dump.write('<revision>');
        unclose_tags.push('revision');
        dump.write(`<id>${jsontoxml.escape('' + revid)}</id>`);
        if (parentid) { dump.write(`<parentid>${jsontoxml.escape('' + parentid)}</parentid>`); }
        dump.write(`<timestamp>${jsontoxml.escape(timestamp)}</timestamp>`);
        if (anon) {
            dump.write(`<contributor><ip>${jsontoxml.escape(user)}</ip></contributor>`);
        } else {
            dump.write(`<contributor><username>${jsontoxml.escape(user)}</username><id /></contributor>`);
        }
        if (minor) {
            dump.write('<minor />');
        }
        dump.write(`<comment>${jsontoxml.escape(comment)}</comment>`);
        dump.write(`<model>${jsontoxml.escape(contentmodel)}</model>`);
        dump.write(`<format>${jsontoxml.escape('' + (format[contentmodel] || format.default))}</format>`);
        const byte_len = Buffer.byteLength(text, 'utf-8');
        dump.write(`<text xml:space="preserve" bytes="${jsontoxml.escape('' + byte_len)}">${jsontoxml.escape(text)}</text>`);
        // see /mediawiki/includes/api/ApiQueryRecentChanges.php:612
        sha1 = BigInt('0x' + sha1).toString(36);
        dump.write(`<sha1>${jsontoxml.escape(sha1)}</sha1>`);
        unclose_tags.pop();
        dump.write('</revision>');
    }
    unclose_tags.pop();
    dump.write('</page>');
}

function solveUncloseTags(dump: fs.WriteStream): void {
    while (unclose_tags.length) {
        dump.write(`</${unclose_tags.pop()}>`);
    }
}

function cancelRequest(): void {
    source.cancel();
}

export {
    getSiteInfo,
    getPageList,
    getPageInfo,
    getRevisionInfo,
    saveToFile,
    solveUncloseTags,
    cancelRequest
};
