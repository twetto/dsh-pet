import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RegisteredRoute } from '../standalone/context';
import type { CompanionSession } from './session';
import { companionPage, companionScript, companionStyle } from './page';

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function companionRoute(session: CompanionSession): RegisteredRoute {
  return {
    path: '/companion',
    kind: 'prefix',
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      const assets: Record<string, [string, string]> = {
        '/companion/': [companionPage, 'text/html'],
        '/companion/chat.js': [companionScript, 'text/javascript'],
        '/companion/style.css': [companionStyle, 'text/css'],
      };
      if (request.method === 'GET' && assets[path]) {
        const [body, type] = assets[path];
        response.writeHead(200, {
          'content-type': type + '; charset=utf-8',
          'content-security-policy':
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'x-frame-options': 'DENY',
        });
        response.end(body);
        return;
      }
      if (request.method === 'GET' && path === '/companion/state') {
        json(response, 200, session.snapshot());
        return;
      }
      if (request.method !== 'POST') {
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        json(response, 415, { error: 'JSON required' });
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        await new Promise<void>((resolve, reject) => {
          request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 32768) reject(new Error('Message too large'));
            else chunks.push(Buffer.from(chunk));
          });
          request.once('end', resolve);
          request.once('error', reject);
        });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { text?: unknown; id?: unknown };
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          json(response, 400, { error: 'Invalid request' });
          return;
        }
        if (path === '/companion/connect') await session.connect();
        else if (path === '/companion/stop') await session.stop();
        else if (path === '/companion/message') {
          if (
            typeof body.text !== 'string' ||
            !body.text.trim() ||
            body.text.length > 4000 ||
            typeof body.id !== 'string' ||
            !/^[0-9a-f-]{36}$/.test(body.id)
          ) {
            json(response, 400, { error: 'A message (up to 4000 characters) and unique ID are required' });
            return;
          }
          await session.send(body.text.trim(), body.id);
        } else {
          json(response, 404, { error: 'Not found' });
          return;
        }
        json(response, 200, { ok: true });
      } catch (error) {
        json(response, 409, {
          error:
            error instanceof SyntaxError
              ? 'Invalid JSON'
              : error instanceof Error
                ? error.message
                : 'Companion request failed',
        });
      }
    },
  };
}
