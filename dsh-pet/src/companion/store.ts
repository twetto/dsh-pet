import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { acquireCompanionLock } from './lock';
import { fingerprint, historicalContext, validatePortable } from './portable';
import type { PortableConversation } from './portable';

export interface ChatMessage {
  id: string;
  role: string;
  text: string;
  status: string;
  created: number;
}

export function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Unsafe data directory');
  if (process.platform === 'win32') {
    const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    const identity = execFileSync(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const sid = identity.match(/\bS-1-\d+(?:-\d+)+\b/)?.[0];
    if (!sid) throw new Error('Cannot identify file owner');
    execFileSync(join(system, 'icacls.exe'), [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], {
      stdio: 'pipe',
      windowsHide: true,
    });
  } else chmodSync(path, 0o700);
}

export class CompanionStore {
  private database: DatabaseSync;
  private release: () => void;

  constructor(directory: string) {
    privateDirectory(directory);
    this.release = acquireCompanionLock(directory);
    try {
      const path = join(directory, 'conversation.sqlite');
      if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600));
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
        throw new Error('Unsafe conversation database');
      if (process.platform !== 'win32') chmodSync(path, 0o600);
      this.database = new DatabaseSync(path);
      const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number };
      if (version.user_version > 1) {
        this.database.close();
        throw new Error('Conversation database is from a newer version');
      }
      this.database.exec(`
      PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, role TEXT NOT NULL, text TEXT NOT NULL,
        status TEXT NOT NULL, created INTEGER NOT NULL
      );
      PRAGMA user_version=1;
      UPDATE messages SET status='interrupted' WHERE status IN ('pending', 'streaming');
    `);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  metadata(key: string): string | undefined {
    return (this.database.prepare('SELECT value FROM metadata WHERE key=?').get(key) as { value: string } | undefined)
      ?.value;
  }

  setMetadata(key: string, value: string): void {
    this.database
      .prepare('INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value);
  }

  put(message: ChatMessage): void {
    this.database
      .prepare(
        `INSERT INTO messages VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET text=excluded.text, status=excluded.status`,
      )
      .run(message.id, message.role, message.text, message.status, message.created);
  }

  has(id: string): boolean {
    return !!this.database.prepare('SELECT id FROM messages WHERE id=?').get(id);
  }

  messages(): ChatMessage[] {
    return this.database
      .prepare(
        'SELECT id, role, text, status, created FROM (SELECT rowid AS sequence, * FROM messages ORDER BY rowid DESC LIMIT 200) ORDER BY sequence',
      )
      .all() as unknown as ChatMessage[];
  }

  importConversation(value: unknown): { added: number; source: string } {
    const snapshot: PortableConversation = validatePortable(value);
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const current = this.database
        .prepare('SELECT id, role, text, status, created FROM messages ORDER BY rowid')
        .all() as unknown as ChatMessage[];
      if (
        current.length > snapshot.messages.length ||
        fingerprint(current) !== fingerprint(snapshot.messages.slice(0, current.length))
      )
        throw new Error(
          'Stale or conflicting snapshot: existing conversation was not changed. Import into a new data directory to keep a separate branch.',
        );
      const added = snapshot.messages.length - current.length;
      if (added) {
        for (const message of snapshot.messages.slice(current.length)) this.put(message);
        this.setMetadata('pendingContext', historicalContext(snapshot.messages));
        this.setMetadata('continuationSource', snapshot.source);
        this.database.prepare("DELETE FROM metadata WHERE key IN ('threadId', 'platform')").run();
      }
      this.database.exec('COMMIT;');
      return { added, source: snapshot.source };
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  close(): void {
    this.database.close();
    this.release();
  }
}
