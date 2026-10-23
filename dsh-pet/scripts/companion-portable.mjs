import { lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const { exportConversation, savePortable, validatePortable, CompanionStore } =
  await import('../lib/companion-portable.js');
const [command, ...argumentsList] = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < argumentsList.length; index++) {
  const key = argumentsList[index];
  if (!['--file', '--data', '--confirm-private-export', '--confirm-import'].includes(key))
    throw new Error('Unknown option: ' + key);
  if (options.has(key)) throw new Error('Duplicate option: ' + key);
  if (key.startsWith('--confirm-')) options.set(key, true);
  else {
    const value = argumentsList[++index];
    if (!value || value.startsWith('--')) throw new Error('Missing value: ' + key);
    options.set(key, value);
  }
}
const directory = resolve(
  options.get('--data') || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-pet', 'companion'),
);
const path = options.get('--file') && resolve(options.get('--file'));
try {
  if (!path || !['export', 'inspect', 'import'].includes(command))
    throw new Error(
      'Usage: node scripts/companion-portable.mjs export|inspect|import --file PATH [--data DIRECTORY] [--confirm-private-export|--confirm-import]',
    );
  if (command === 'export') {
    if (!options.has('--confirm-private-export'))
      throw new Error('This exports private dialogue as unencrypted text. Add --confirm-private-export to consent.');
    const snapshot = exportConversation(join(directory, 'conversation.sqlite'));
    savePortable(path, snapshot);
    console.log(
      `Exported ${snapshot.messages.length} messages to ${path}. No credentials or native thread metadata included.`,
    );
  } else {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
      throw new Error('Unsafe or oversized snapshot');
    const snapshot = validatePortable(JSON.parse(readFileSync(path, 'utf8')));
    console.log(
      `Snapshot v${snapshot.version}: ${snapshot.messages.length} messages, source ${snapshot.source}, ${new Date(snapshot.exported).toISOString()}.`,
    );
    if (command === 'import') {
      if (!options.has('--confirm-import'))
        throw new Error(
          'No changes made. Stop the companion service, then add --confirm-import to restore this conversation.',
        );
      const store = new CompanionStore(directory);
      try {
        const result = store.importConversation(snapshot);
        console.log(
          `Imported ${result.added} new messages. ${result.added ? 'A fresh Codex thread will be created with labeled historical context.' : 'Identical snapshot; existing native thread preserved.'}`,
        );
      } finally {
        store.close();
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
