import fs from 'fs';
import MyConsole from './MyConsole';
import { initTask, doAllTask, close } from './task';
import { API_URL, MAX_HTTP_CONNECTION, ERROR_LOG_PATH, DUMP_XML_PATH } from './config';

const err_log = fs.createWriteStream(ERROR_LOG_PATH);
const dump = fs.createWriteStream(DUMP_XML_PATH);
const my_console = new MyConsole(MAX_HTTP_CONNECTION);

initTask();
my_console.log(`API_URL=${API_URL}`, 'info');
my_console.log(`DUMP_XML_PATH=${DUMP_XML_PATH}`, 'info');
my_console.log(`ERROR_LOG_PATH=${ERROR_LOG_PATH}`, 'info');
const works: Promise<void>[] = [];
for (let p = 0; p < MAX_HTTP_CONNECTION; p++) {
    const work = doAllTask(
        dump,
        msg => { my_console.log(msg, 'warn'); if (err_log.writable) err_log.write(msg + '\n'); },
        msg => my_console.status(p, msg))
        .then(msg => my_console.status(p, `idle: ${msg}`));
    works.push(work);
}

const onExit = () => {
    my_console.destruct();
    close(dump);
    err_log.end();
    err_log.once('finish', dump.close);
};

Promise.all(works).finally(onExit);

process.on('SIGINT', onExit);
