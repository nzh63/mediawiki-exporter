import fs from 'fs';
import { createCompressor } from 'lzma-native';
import { format } from 'util';
import { Console } from './console';
import { Scheduler } from './scheduler';
import { MAX_WORKERS } from './config';
import { AcceptTask, dispatcher } from './dispatcher';
import { QuerySiteInfoTask, QUERY_SITE_INFO, solveUncloseTags } from './tasks';
import { cancelRequest } from './axios';

const lzma = createCompressor({ threads: 0 });
const dump = fs.createWriteStream('./output/dump.xml.xz');
const errLog = fs.createWriteStream('./output/err.log');
lzma.pipe(dump);

const console = new Console(MAX_WORKERS);
const scheduler = new Scheduler(
    MAX_WORKERS,
    (data, ...args) => { console.warn(data, ...args); if (errLog.writable) errLog.write(format(data, ...args) + '\n'); },
    console.log.bind(console),
    console.status.bind(console),
    console.progress.bind(console)
);

scheduler.addTask<QuerySiteInfoTask>({ type: QUERY_SITE_INFO });
scheduler.run<AcceptTask>((task, warn, log, progress) => dispatcher(task, scheduler, lzma, progress)).finally(onExit);

process.on('SIGINT', onExit);

function onExit() {
    console.destroy();
    cancelRequest();
    scheduler.clearTask();
    solveUncloseTags(lzma);
    lzma.once('end', () => dump.end());
    dump.once('end', () => errLog.close());
    dump.once('close', () => errLog.end());
    errLog.once('end', () => errLog.close());
    lzma.end();
}