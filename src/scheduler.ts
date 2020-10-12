import { MAX_RETRY } from './config';

export interface Task {
    type: symbol;
    retry?: number;
    config?: unknown;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LogFunction = (...args: any[]) => void

export class Scheduler {
    private currentRunningTask = 0;
    private taskQueue: Task[] = [];
    private waiting: (() => void)[] = [];

    constructor(
        private workerCount: number,
        private warn: LogFunction = console.warn,
        private log: LogFunction = console.log,
        private status?: LogFunction
    ) { }

    async run<T extends Task>(
        doTask: (task: T, warn: LogFunction, log: LogFunction) => Promise<void>
    ): Promise<void> {
        const works: Promise<void>[] = [];
        for (let p = 0; p < this.workerCount; p++) {
            const work = this.doAllTask(
                doTask,
                this.warn,
                this.log,
                (...args) => this.status?.(p, ...args)
            ).then(msg => this.status?.(p, `idle: ${msg}`));
            works.push(work);
        }
        await Promise.all(works);
    }

    addTask<T extends Task>(task: T, executeAtOnce = false): void {
        if (executeAtOnce) this.taskQueue.unshift(task);
        else this.taskQueue.push(task);
        this.onNewTask();
    }

    clearTask(): void {
        this.taskQueue = [];
    }

    private async doAllTask<T extends Task>(
        doTask: (task: T, warn: LogFunction, log: LogFunction) => Promise<void>,
        warn: LogFunction,
        log: LogFunction,
        status?: LogFunction,
    ): Promise<string> {
        while (!(this.taskQueue.length === 0 && this.currentRunningTask === 0)) {
            if (this.taskQueue.length === 0) {
                status?.('idle: Waiting for task');
                await new Promise(resolve => {
                    this.waiting.push(resolve);
                });
            } else {
                this.currentRunningTask++;
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const task = this.taskQueue.shift()!;
                status?.('Running task:', task);
                try {
                    await doTask(task as T, warn, log);
                } catch (e) {
                    warn('Unable to finish task:', task);
                    warn(e.message ?? e);
                    if (task.retry == undefined) task.retry = MAX_RETRY;
                    if (task.retry > 0) {
                        warn('Retry');
                        task.retry--;
                        this.addTask(task, true);
                    }
                }
                this.currentRunningTask--;
            }
        }
        while (this.waiting.length) this.onNewTask();
        return 'done';
    }

    private onNewTask() {
        if (this.waiting.length) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const resolve = this.waiting.shift()!;
            resolve();
        }
    }
}