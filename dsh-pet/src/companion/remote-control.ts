import { stripVTControlCharacters } from 'node:util';
import type { IPty } from 'node-pty';

export interface RemoteControl {
  start(executable: string, args: string[], cwd: string): Promise<string>;
  close(): Promise<void>;
}

export function isRemoteControlUrl(value: string): boolean {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  return new RegExp('^https://antigravity[.]google[.]com/r/' + uuid + '(?:-v2)?(?:[?]p=c%2F' + uuid + ')?$').test(
    value,
  );
}

export class AgyRemoteControl implements RemoteControl {
  private terminal?: IPty;
  private exited?: Promise<void>;
  private starting?: Promise<string>;
  private rejectStart?: (error: Error) => void;
  private stopped = false;
  private onExit: () => void;

  constructor(onExit: () => void = () => {}) {
    this.onExit = onExit;
  }

  async start(executable: string, args: string[], cwd: string): Promise<string> {
    this.starting = this.open(executable, args, cwd);
    try {
      return await this.starting;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async open(executable: string, args: string[], cwd: string): Promise<string> {
    const { spawn } = await import('node-pty').catch(() => {
      throw new Error('Remote Control requires the optional node-pty dependency. Reinstall dependencies for this OS.');
    });
    if (this.stopped) throw new Error('Remote Control was stopped.');
    const terminal = spawn(executable, args, {
      cwd,
      name: 'xterm-256color',
      cols: 240,
      rows: 40,
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    this.terminal = terminal;
    let resolveExit!: () => void;
    this.exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    let timer: ReturnType<typeof setTimeout>;
    terminal.onExit(() => {
      clearTimeout(timer);
      this.terminal = undefined;
      this.rejectStart?.(
        new Error('Antigravity Remote Control exited before connecting. Check agy login and account access.'),
      );
      this.rejectStart = undefined;
      resolveExit();
      this.onExit();
    });
    return new Promise<string>((resolve, reject) => {
      this.rejectStart = reject;
      let buffer = '';
      let trusted = false;
      timer = setTimeout(
        () => reject(new Error('Remote Control startup timed out. Check agy login and account access.')),
        45000,
      );
      terminal.onData((data) => {
        if (data.includes('\x1b]11;?')) terminal.write('\x1b]11;rgb:ffff/ffff/ffff\x07');
        if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R');
        buffer = (buffer + data).slice(-65536);
        const plain = stripVTControlCharacters(buffer);
        if (!trusted && plain.includes('Do you trust the contents of this project?')) {
          trusted = true;
          terminal.write('\r');
        }
        if (/Remote control is not enabled for your account/i.test(plain)) {
          reject(new Error('Remote Control is not enabled for this Antigravity account.'));
          return;
        }
        const announcement = plain.lastIndexOf('Remote control on for this session.');
        if (announcement < 0) return;
        const text = plain.slice(announcement).replace(/\r?\n[ \t]*/g, '');
        const match = text.match(
          /https:\/\/antigravity\.google\.com\/r\/[0-9a-f-]+(?:-v2)?(?:[?]p=c%2F[0-9a-f-]+)?(?=\s)/,
        );
        if (match && isRemoteControlUrl(match[0])) {
          const conversation = args[args.indexOf('--conversation') + 1];
          const selected = new URL(match[0]).searchParams.get('p');
          if (selected && selected !== 'c/' + conversation) {
            reject(new Error('Remote Control returned a different conversation. Chat remains unchanged.'));
            return;
          }
          clearTimeout(timer);
          this.rejectStart = undefined;
          resolve(match[0]);
        }
      });
    });
  }

  async close(): Promise<void> {
    this.stopped = true;
    const terminal = this.terminal;
    if (!terminal) return;
    this.rejectStart?.(new Error('Remote Control was stopped.'));
    this.rejectStart = undefined;
    terminal.write('/exit\r');
    const kill = setTimeout(() => {
      if (this.terminal === terminal) terminal.kill();
    }, 2000);
    const force = setTimeout(() => {
      if (this.terminal === terminal) terminal.kill('SIGKILL');
    }, 4000);
    try {
      await Promise.race([
        this.exited,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Remote Control has not exited. Chat remains paused.')), 7000).unref(),
        ),
      ]);
    } finally {
      clearTimeout(kill);
      clearTimeout(force);
    }
  }
}
