import fs from 'fs';
import axios from 'axios';
import {
    PageListConfig,
    PageInfoConfig,
    RevisionInfoConfig,
    SaveToFileConfig,
    QUERY_SITE_INFO,
    QUERY_PAGE_LIST,
    QUERY_PAGE_INFO,
    QUERY_REVISION_INFO,
    SAVE_TO_FILE,
    getSiteInfo,
    getPageList,
    getPageInfo,
    getRevisionInfo,
    saveToFile,
    solveUncloseTags,
    cancelRequest
} from './dump';
import { MAX_RETRY_TIMES } from './config';

interface Task {
    type: symbol;
    config?: PageListConfig | PageInfoConfig | RevisionInfoConfig;
}

let current_running_task = 0;
let task_queue: Task[] = [];

function initTask() {
    task_queue = [{ type: QUERY_SITE_INFO }];
}

async function doAllTask(
    dump: fs.WriteStream,
    warn: (msg: string) => any = console.warn,
    log: (msg: string) => any = console.log,
): Promise<string> {
    while (!(task_queue.length === 0 && current_running_task === 0)) {
        if (task_queue.length === 0) {
            await _checkLater();
        } else {
            const task = task_queue.pop()!;
            log('Doing task:' + JSON.stringify(task));
            try {
                await tryDoTask(task, dump);
            } catch (e) {
                warn('Unable to finish task: ' + JSON.stringify(task));
                warn(e);
            }
        }
    }
    return 'done';
    function _checkLater() {
        log('idle: Waiting for task');
        return checkLater(
            () => true,
            () => Promise.resolve(),
            []
        );
    }
}

async function tryDoTask(task: Task, dump: fs.WriteStream, retry = MAX_RETRY_TIMES): Promise<void> {
    current_running_task++;
    try {
        return await doTask(task, dump);
    } catch (e) {
        if (!axios.isCancel(e) && (e.retry || e.isAxiosError) && retry > 0) {
            return tryDoTask(task, dump, retry - 1);
        } else {
            throw e;
        }
    } finally {
        current_running_task--;
    }
}

function doTask(task: Task, dump: fs.WriteStream): Promise<void> {
    const { type, config } = task;
    if (type === QUERY_PAGE_LIST) {
        return getPageList(config as PageListConfig);
    } else if (type === QUERY_PAGE_INFO) {
        return getPageInfo(config as PageInfoConfig);
    } else if (type === QUERY_REVISION_INFO) {
        return getRevisionInfo(config as RevisionInfoConfig);
    } else if (type === SAVE_TO_FILE) {
        return saveToFile(config as SaveToFileConfig, dump);
    } else if (type === QUERY_SITE_INFO) {
        return getSiteInfo(dump);
    } else {
        return Promise.reject(new Error());
    }
}

async function checkLater<T>(condition: Function, fun: (...args: any) => Promise<T>, args: any[], delay = 1000): Promise<T> {
    do {
        await new Promise(resolve => setTimeout(resolve, delay));
    } while (!condition());
    return fun(...args);
}

function close(dump: fs.WriteStream) {
    cancelRequest();
    task_queue = [];
    solveUncloseTags(dump);
    dump.end();
    dump.once('finish', dump.close);
}

function addTask(task: Task, exce_next: boolean = false): void {
    if (exce_next) task_queue.push(task);
    else task_queue.unshift(task);
}

export {
    initTask,
    doAllTask,
    addTask,
    close
};
