import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { stateUrl, readWorkState, watchService } from '../../runtime/quickshell/service.mjs';

test('service URL stays local and never forwards credentials', () => {
  assert.equal(stateUrl().href, 'http://127.0.0.1:3080/dsh-pet-7340/state');
  for (const url of ['https://localhost', 'http://example.com', 'http://secret@localhost'])
    assert.throws(() => stateUrl(url));
});

test('maps all service states and idle through the shared parser', async () => {
  assert.deepEqual(
    await readWorkState(stateUrl(), async () =>
      Response.json({ sections: { workStatus: { counter: 0, data: null } } }),
    ),
    { connected: true, state: 'idle', task: null },
  );
  for (const state of [null, 'thinking', 'working', 'result', 'waiting', 'success', 'error']) {
    const fetcher = async () => Response.json({ sections: { workStatus: { data: { state, task: 'test' } } } });
    assert.deepEqual(await readWorkState(stateUrl(), fetcher), {
      connected: true,
      state: state ?? 'idle',
      task: 'test',
    });
  }
  await assert.rejects(readWorkState(stateUrl(), async () => Response.json({})));
  await assert.rejects(readWorkState(stateUrl(), async () => new Response('', { status: 503 })));
});

test('polling deduplicates, clears disconnected state, and reconnects', async () => {
  let state = 'working';
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    if (requests === 4) state = 'offline';
    if (requests === 5) state = 'success';
    response.writeHead(state === 'offline' ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ sections: { workStatus: { data: { state, task: null } } } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  const received = [];
  try {
    await watchService(stateUrl(`http://127.0.0.1:${server.address().port}`), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
      interval: 5,
      emit: (line) => {
        received.push(JSON.parse(line));
        if (received.length === 3) controller.abort();
      },
    });
    assert.deepEqual(
      received.map((value) => [value.connected, value.state]),
      [
        [true, 'working'],
        [false, 'idle'],
        [true, 'success'],
      ],
    );
    assert.equal(requests, 5);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
