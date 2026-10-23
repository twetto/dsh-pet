import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export type Payload = Record<string, unknown>;
interface Pending {
  resolve(value: Payload): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class CodexProtocol {
  private executable: string;
  private prefix: string[];
  constructor(executable = process.env.DSH_PET_CODEX_PATH || 'codex', prefix: string[] = []) {
    this.executable = executable;
    this.prefix = prefix;
  }
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  onNotification: (method: string, params: Payload) => void = () => {};
  onDisconnect: () => void = () => {};
  onDenied: () => void = () => {};

  async connect(): Promise<void> {
    if (this.child) return;
    const child = spawn(
      this.executable,
      [
        ...this.prefix,
        'app-server',
        '--stdio',
        '-c',
        'mcp_servers={}',
        '-c',
        'features.shell_tool=false',
        '-c',
        'features.multi_agent=false',
        '-c',
        'features.apps=false',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    this.child = child;
    child.stderr.resume();
    child.stdin.on('error', () => this.disconnect(child));
    child.on('error', () => this.disconnect(child));
    child.on('exit', () => this.disconnect(child));
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) {
        this.disconnect(child);
        return;
      }
      let boundary: number;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        if (!line.trim()) continue;
        try {
          this.receive(JSON.parse(line) as Payload);
        } catch {
          this.disconnect(child);
          return;
        }
      }
    });
    try {
      await this.request('initialize', {
        clientInfo: { name: 'dsh_pet_companion', version: '0.1.0', title: 'GPT companion' },
      });
      this.send({ method: 'initialized', params: {} });
      const settings = await this.request('config/read', { includeLayers: false });
      const config = settings.config as Payload | undefined;
      if (!config) throw new Error('Codex returned no configuration');
      if (Object.keys((config?.mcp_servers as Payload) || {}).length)
        throw new Error('Companion chat requires MCP servers disabled');
      const auth = await this.request('account/read', { refreshToken: false });
      if (auth.requiresOpenaiAuth && !auth.account) throw new Error('Sign in with codex login first');
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private send(message: Payload): void {
    if (!this.child || this.child.killed) throw new Error('Codex connection is closed');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method: string, params: Payload): Promise<Payload> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex request timed out; no automatic retry'));
        this.close();
      }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Codex is unavailable'));
      }
    });
  }

  private receive(message: Payload): void {
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        this.onDenied();
        const method = message.method;
        let result: Payload | undefined;
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval')
          result = { decision: 'decline' };
        if (method === 'item/permissions/requestApproval') result = { permissions: {}, scope: 'turn' };
        if (method === 'item/tool/requestUserInput') result = { answers: {} };
        if (method === 'mcpServer/elicitation/request') result = { action: 'decline' };
        this.send(
          result
            ? { id: message.id, result }
            : { id: message.id, error: { code: -32601, message: 'Not supported in companion chat' } },
        );
      } else this.onNotification(message.method, (message.params || {}) as Payload);
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error)
      pending.reject(new Error('Codex rejected the request; check login, configuration or saved thread'));
    else pending.resolve((message.result || {}) as Payload);
  }

  private disconnect(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.child = undefined;
    child.kill();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex disconnected; the last message was not automatically resent'));
    }
    this.pending.clear();
    this.onDisconnect();
  }

  close(): void {
    if (this.child) this.disconnect(this.child);
  }
}
