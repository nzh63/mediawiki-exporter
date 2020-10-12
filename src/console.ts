/* eslint-disable @typescript-eslint/no-explicit-any */
import { format, formatWithOptions } from 'util';

export class Console {
  private static readonly icon = ['⠇', '⠋', '⠙', '⠸', '⢰', '⣠', '⣄', '⡆'] as const;
  private statusBuffer: string[];
  private logBuffer = '';
  private iconId = 0;
  private timeoutID?: NodeJS.Timeout;
  private isFlashing = false;
  private blockedFlashCallbacks: (() => void)[] = [];

  constructor(processCount: number) {
    this.statusBuffer = Array(processCount).fill('idle');
    if (process.stdout.isTTY) {
      this.timeoutID = setInterval(() => {
        this.flash();
        this.iconId = (this.iconId + 1) % Console.icon.length;
      }, 100);
      process.stdout.write('\n'.repeat(processCount));
    }
  }
  private _log(msg: string, level = 'log') {
    const styles = {
      default: ['\x1B[90m', '\x1B[39m'],
      error: ['\x1B[31m', '\x1B[39m'],
      warn: ['\x1B[33m', '\x1B[39m'],
      info: ['\x1B[34m', '\x1B[39m']
    } as { default: [string, string], [index: string]: [string, string] | undefined };
    if (process.stdout.isTTY && process.stdout.hasColors()) {
      const color = styles[level] ?? styles.default;
      level = color[0] + level + color[1];
    }
    if (process.stdout.isTTY) {
      this.logBuffer += level + ' ' + msg + '\n';
      this.flash();
    } else {
      process.stdout.write(level + ' ' + msg);
    }
  }

  log(data: string, ...args: any[]): void {
    this._log(args.length ? format(data, ...args) : data, 'log');
  }
  info(data: string, ...args: any[]): void {
    this._log(args.length ? format(data, ...args) : data, 'info');
  }
  warn(data: string, ...args: any[]): void {
    this._log(args.length ? format(data, ...args) : data, 'warn');
  }
  error(data: string, ...args: any[]): void {
    this._log(args.length ? format(data, ...args) : data, 'error');
  }

  flash(callback?: () => void): void {
    if (this.isFlashing) {
      if (callback) this.blockedFlashCallbacks.push(callback);
      return;
    } else if (process.stdout.isTTY) {
      this.isFlashing = true;
      let output = this.logBuffer;
      this.logBuffer = '';
      for (const i in this.statusBuffer) {
        output += `\n[${Number(i) + 1}/${this.statusBuffer.length}] ${Console.icon[this.iconId]} ${this.statusBuffer[i]}`;
      }
      process.stdout.cursorTo(0, () => {
        process.stdout.moveCursor(0, - this.statusBuffer.length, () => {
          process.stdout.clearScreenDown(() => {
            process.stdout.write(output, () => {
              this.isFlashing = false;
              if (callback) callback();
              if (this.blockedFlashCallbacks.length) {
                const callbacks = this.blockedFlashCallbacks;
                this.blockedFlashCallbacks = [];
                this.flash(() => {
                  callbacks.forEach(c => c());
                });
              }
            });
          });
        });
      });
    }
  }
  status(process_number: number, data: string, ...args: any[]): void {
    let msg = args.length ? formatWithOptions({ breakLength: Infinity }, data, ...args) : data;
    msg = msg.replace(/[\n\r]/g, '');
    const maxLength = process.stdout.columns - 15;
    if (process.stdout.isTTY) {
      if (msg.length > maxLength) {
        msg = Buffer.from(msg, 'utf-8').toString('utf-8', 0, maxLength) + '...';
      }
      this.statusBuffer[process_number] = msg;
    } else {
      console.log(process_number, msg);
    }
  }
  getWindowHeight(): number {
    return process.stdout.isTTY ? process.stdout.getWindowSize()[1] : this.statusBuffer.length;
  }
  destroy(callback?: () => void): void {
    if (this.timeoutID) {
      clearInterval(this.timeoutID);
      delete this.timeoutID;
    }
    this.flash(() => {
      if (process.stdout.isTTY) {
        process.stdout.cursorTo(0, () => {
          process.stdout.moveCursor(0, - this.statusBuffer.length, () => {
            process.stdout.clearScreenDown(() => {
              callback?.();
            });
          });
        });
      } else {
        callback?.();
      }
    });
  }
}
