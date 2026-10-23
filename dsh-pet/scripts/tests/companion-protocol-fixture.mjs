import { createInterface } from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
let probe;
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (!message.method) {
    send({ id: probe, result: message.result || { denied: true } });
    return;
  }
  if (message.id === undefined) return;
  if (message.method === 'probe/disconnect') process.exit(0);
  if (message.method === 'probe/approval') {
    probe = message.id;
    send({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { command: 'should never run' } });
    return;
  }
  const result =
    message.method === 'config/read'
      ? { config: { mcp_servers: {} } }
      : message.method === 'account/read'
        ? { requiresOpenaiAuth: false }
        : {};
  send({ id: message.id, result });
});
