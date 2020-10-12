import stream from 'stream';
import { QuerySiteInfoTask, QueryPageListTask, QueryPageInfoTask, SaveToFileTask, QUERY_SITE_INFO, getSiteInfo, QUERY_PAGE_LIST, getPageList, QUERY_PAGE_INFO, getPageInfo, SAVE_TO_FILE, saveToFile } from './tasks';
import { Scheduler } from "./scheduler";

export type AcceptTask = QuerySiteInfoTask | QueryPageListTask | QueryPageInfoTask | SaveToFileTask;

export function dispatcher(task: AcceptTask, scheduler: Scheduler, dump: stream.Writable): Promise<void> {
    if (task.type === QUERY_SITE_INFO) {
        return getSiteInfo(scheduler, dump);
    } else if (task.type === QUERY_PAGE_LIST) {
        return getPageList(task, scheduler);
    } else if (task.type === QUERY_PAGE_INFO) {
        return getPageInfo(task, scheduler);
    } else if (task.type === SAVE_TO_FILE) {
        return saveToFile(task, dump);
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const check: never = task;
        return Promise.reject(new Error());
    }
}