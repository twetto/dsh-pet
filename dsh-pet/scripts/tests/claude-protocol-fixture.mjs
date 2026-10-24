import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('fixture\n');
  process.exit(0);
}
const value = (name) => args[args.indexOf(name) + 1];
assert.equal(value('--tools'), '');
assert.equal(value('--mcp-config'), '{"mcpServers":{}}');
assert.equal(value('--permission-mode'), 'dontAsk');
assert.equal(value('--permission-prompts'), 'none');
assert.ok(args.includes('--safe-mode'));
assert.ok(args.includes('--strict-mcp-config'));
assert.ok(!args.includes('--continue'));
assert.ok(!args.includes('--dangerously-skip-permissions'));
const session = args.includes('--resume') ? value('--resume') : value('--session-id');
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\n');
const reader = createInterface({ input: process.stdin });
reader.on('line', (line) => {
  const content = JSON.parse(line).message.content;
  const text =
    typeof content === 'string'
      ? content
      : content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('');
  const images = typeof content === 'string' ? [] : content.filter((block) => block.type === 'image');
  for (const image of images) {
    assert.equal(image.source.type, 'base64');
    assert.equal(image.source.media_type, 'image/png');
    assert.equal(Buffer.from(image.source.data, 'base64').toString('hex').slice(0, 16), '89504e470d0a1a0a');
  }
  if (text === 'bad-json') {
    process.stdout.write('{broken}\n');
    return;
  }
  emit({
    type: 'system',
    subtype: 'init',
    session_id: session,
    tools: text === 'unsafe' ? ['Bash'] : [],
    mcp_servers: [],
  });
  if (text === 'disconnect') return process.exit(1);
  if (text === 'wait') {
    setInterval(() => {}, 1000);
    return;
  }
  if (text === 'tool') {
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } });
    return;
  }
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Claude' } } });
  emit({
    type: 'result',
    session_id: text === 'wrong-session' ? 'wrong' : session,
    subtype: text === 'fail' ? 'error_during_execution' : 'success',
    is_error: text === 'fail',
    result: images.length ? 'Image received' : 'Hello Claude',
  });
});
