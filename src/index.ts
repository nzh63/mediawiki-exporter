import fs from 'fs';
import zlib from 'zlib';
import { format } from 'util';
import { Console } from './console';
import { Scheduler } from './scheduler';
import { MAX_WORKERS } from './config';
import { AcceptTask, dispatcher } from './dispatcher';
import { QuerySiteInfoTask, QUERY_SITE_INFO, solveUncloseTags } from './tasks';
import { cancelRequest } from './axios';

const gzip = zlib.createGzip();
const dump = fs.createWriteStream('./output/dump.xml.gz');
const errLog = fs.createWriteStream('./output/err.log');
gzip.pipe(dump);

const console = new Console(MAX_WORKERS);
const scheduler = new Scheduler(
    MAX_WORKERS,
    (data, ...args) => { console.warn(data, ...args); if (errLog.writable) errLog.write(format(data, ...args) + '\n'); },
    console.log.bind(console),
    console.status.bind(console),
    console.progress.bind(console)
);

scheduler.addTask<QuerySiteInfoTask>({ type: QUERY_SITE_INFO });
scheduler.run<AcceptTask>((task, warn, log, progress) => dispatcher(task, scheduler, gzip, progress)).finally(onExit);

process.on('SIGINT', onExit);

function onExit() {
    console.destroy();
    cancelRequest();
    scheduler.clearTask();
    solveUncloseTags(gzip);
    gzip.once('end', () => gzip.close());
    gzip.once('close', () => errLog.end());
    errLog.once('end', () => errLog.close());
    gzip.end();
}