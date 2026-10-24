import { createInterface } from 'node:readline';
import { join } from 'node:path';

const args = process.argv.slice(2);
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('--print')) {
  emit({
    command: {
      data: {
        hooks: process.env.PET_TEST_AGY_BAD_HOOK
          ? []
          : [
              {
                name: 'dsh-pet-chat-only',
                enabled: true,
                source: join(process.cwd(), '.agents/hooks.json'),
                actions: [{ event: 'PreToolUse', matcher: '*', command: 'node deny-tools.cjs' }],
              },
            ],
      },
    },
  });
  process.exit(0);
}
const previous = args.indexOf('--conversation');
const conversation = previous < 0 ? '12345678-1234-4234-8234-123456789abc' : args[previous + 1];
emit({
  event: 'init',
  conversation_id: conversation,
  init: {
    agent: 'dsh-pet-gemini',
    tools: ['run_command'],
    permission_mode: process.env.PET_TEST_AGY_UNSAFE ? 'always-proceed' : 'request-review',
  },
});
createInterface({ input: process.stdin }).on('line', (line) => {
  const text = JSON.parse(line).message.content;
  if (text === 'disconnect') return process.exit(1);
  if (text === 'wait') return;
  if (text === 'tool') {
    emit({ event: 'step_update', step_update: { step_type: 'tool', tool_name: 'run_command' } });
    return;
  }
  emit({ event: 'step_update', step_update: { step_type: 'agent_response', step_index: 2, text_delta: 'Hello ' } });
  emit({ event: 'step_update', step_update: { step_type: 'agent_response', step_index: 2, text_delta: 'Gemini' } });
  emit({
    event: 'result',
    result: { conversation_id: conversation, status: text === 'fail' ? 'ERROR' : 'SUCCESS', response: 'Hello Gemini' },
  });
});
