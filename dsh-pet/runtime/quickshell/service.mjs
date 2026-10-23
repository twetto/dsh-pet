import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { toWorkStatus } from '../../src/shared/work-status.ts';
import { actionCatalog } from './catalog.mjs';

export function stateUrl(value = 'http://127.0.0.1:3080') {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error('Pet service must be a local HTTP URL without credentials');
  return new URL('/dsh-pet-7340/state', url);
}

export async function readWorkState(url, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
  if (!response.ok) throw new Error(`Pet service HTTP ${response.status}`);
  const body = await response.json();
  const leaf = body?.sections?.workStatus;
  const snapshot =
    leaf?.data === null && Number.isFinite(leaf.counter) ? { state: null, task: null } : toWorkStatus(leaf?.data);
  if (!snapshot) throw new Error('Pet service returned no work-status snapshot');
  return { connected: true, state: snapshot.state ?? 'idle', task: snapshot.task };
}

export async function watchService(url, { emit = console.log, signal, interval = 1000 } = {}) {
  let previous;
  while (!signal?.aborted) {
    let state;
    try {
      state = await readWorkState(url);
    } catch {
      state = { connected: false, state: 'idle', task: null };
    }
    const line = JSON.stringify(state);
    if (line !== previous) emit(line);
    previous = line;
    try {
      await setTimeout(interval, undefined, { signal });
    } catch {
      break;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ actions: actionCatalog() }));
  await watchService(stateUrl(process.env.DSH_PET_SERVICE_URL));
}
