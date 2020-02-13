class MyConsole {
  private static icon = ['⠁', '⠂', '⠄', '⠠', '⠐', '⠈']
  private statusBuffer: string[];
  private logBuffer: string = '';
  private icon_id: number = 0;
  private timeoutID?: NodeJS.Timeout;
  private isFlashing: boolean = false;

  constructor(process_count: number) {
    this.statusBuffer = Array(process_count).fill('idle');
    if (process.stdout.isTTY) {
      this.timeoutID = setInterval(() => this.flash(), 200);
      process.stdout.write('\n'.repeat(process_count));
    }
  }
  log(msg: string, level: 'log'| 'info' | 'warn' | 'error' = 'log') {
    if (process.stdout.isTTY && level === 'log') return;
    const styles = {
      grey: ['\x1B[90m', '\x1B[39m'],
      red: ['\x1B[31m', '\x1B[39m'],
      yellow: ['\x1B[33m', '\x1B[39m'],
      blue: ['\x1B[34m', '\x1B[39m']
    };
    let levelStr;
    if (level === 'error') {
      levelStr = styles.red[0] + level + styles.red[1];
    } else if (level === 'warn') {
      levelStr = styles.yellow[0] + level + styles.yellow[1];
    } else if (level === 'info') {
      levelStr = styles.blue[0] + level + styles.blue[1];
    } else {
      levelStr = styles.grey[0] + level + styles.grey[1];
    }
    if (process.stdout.isTTY) {
      this.logBuffer += levelStr + '\t' + msg + '\n';
      this.flash();
    } else {
      console.log(level + '\t' + msg);
    }
  }
  flash() {
    if (this.isFlashing) {
      return;
    } else if (process.stdout.isTTY) {
      this.isFlashing = true;
      let output = this.logBuffer;
      this.logBuffer = '';
      for (const i in this.statusBuffer) {
        output += `\n${MyConsole.icon[this.icon_id]} [${Number(i) + 1}/${this.statusBuffer.length}] ${this.statusBuffer[i]}`;
      }
      process.stdout.moveCursor(0, - this.statusBuffer.length, () => {
        process.stdout.cursorTo(0, () => {
          process.stdout.clearScreenDown(() => {
            process.stdout.write(output, () => {
              this.isFlashing = false;
            });
          });
        });
      });
      this.icon_id = (this.icon_id + 1) % MyConsole.icon.length;

    }
  }
  status(process_number: number, msg: string) {
    msg = '' + msg;
    let maxLength = process.stdout.columns - 15;
    if (process.stdout.isTTY) {
      if (msg.length > maxLength) {
        msg = Buffer.from(msg, 'utf-8').toString('utf-8', 0, maxLength) + '...';
      }
      this.statusBuffer[process_number] = msg;
    } else {
      console.log(process_number, msg);
    }
  }
  getWindowHeight() {
    return process.stdout.isTTY ? process.stdout.getWindowSize()[1] : this.statusBuffer.length;
  }
  destruct() {
    if (this.timeoutID) {
      clearInterval(this.timeoutID);
    }
  }
}
export default MyConsole;
