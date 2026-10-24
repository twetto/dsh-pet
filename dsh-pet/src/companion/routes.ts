import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RegisteredRoute } from '../standalone/context';
import type { CompanionSession } from './session';
import { companionPage, companionScript, companionStyle } from './page';
import type { CompanionImages } from './images';
import { maxImageRequestBytes, maxMessageImages } from './image-limits';

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function companionRoute(
  session: Pick<CompanionSession, 'snapshot' | 'connect' | 'stop'> & {
    send(text: string, id: string, images?: string[]): Promise<void>;
    images?: CompanionImages;
    historyImages?: Pick<CompanionImages, 'read'>;
    discardImage?(id: string): void;
    startRemoteControl?(): Promise<string>;
    returnFromRemoteControl?(): Promise<void>;
  },
  provider: 'codex' | 'agy' | 'claude' = 'codex',
): RegisteredRoute {
  const base = provider === 'agy' ? '/companion/gemini' : provider === 'claude' ? '/companion/claude' : '/companion';
  const page =
    provider !== 'codex'
      ? companionPage
          .split('/companion/')
          .join(base + '/')
          .split('GPT girl')
          .join(provider === 'agy' ? 'Gemini' : 'Claude')
          .split('Codex conversation')
          .join(provider === 'agy' ? 'Antigravity conversation' : 'Claude Code conversation')
      : companionPage;
  return {
    path: base,
    kind: 'prefix',
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      const assets: Record<string, [string, string]> = {
        [base + '/']: [page, 'text/html'],
        [base + '/chat.js']: [companionScript, 'text/javascript'],
        [base + '/style.css']: [companionStyle, 'text/css'],
      };
      if (request.method === 'GET' && assets[path]) {
        const [body, type] = assets[path];
        response.writeHead(200, {
          'content-type': type + '; charset=utf-8',
          'content-security-policy':
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          'x-frame-options': 'DENY',
        });
        response.end(body);
        return;
      }
      if (request.method === 'GET' && path === base + '/state') {
        json(response, 200, session.snapshot());
        return;
      }
      const imageReader = session.images || session.historyImages;
      if (imageReader && request.method === 'GET' && path.startsWith(base + '/images/')) {
        try {
          const image = imageReader.read(path.slice((base + '/images/').length));
          response.writeHead(200, {
            'content-type': image.info.mediaType,
            'content-length': image.bytes.length,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'content-disposition': 'inline',
          });
          response.end(image.bytes);
        } catch {
          json(response, 404, { error: 'Image not found' });
        }
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
        const limit = session.images && path === base + '/images' ? maxImageRequestBytes : 32768;
        await new Promise<void>((resolve, reject) => {
          request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) reject(new Error('Request too large'));
            else chunks.push(Buffer.from(chunk));
          });
          request.once('end', resolve);
          request.once('error', reject);
        });
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          text?: unknown;
          id?: unknown;
          images?: unknown;
          path?: unknown;
        };
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          json(response, 400, { error: 'Invalid request' });
          return;
        }
        if (session.images && path === base + '/images') {
          json(response, 200, session.images.upload(body));
          return;
        } else if (session.images && path === base + '/images/path') {
          json(response, 200, session.images.attachPath(body.path));
          return;
        } else if (session.discardImage && path === base + '/images/remove') {
          if (typeof body.id !== 'string') throw new Error('Image ID required');
          session.discardImage(body.id);
        } else if (provider === 'agy' && session.startRemoteControl && path === base + '/remote/start') {
          json(response, 200, { url: await session.startRemoteControl() });
          return;
        } else if (provider === 'agy' && session.returnFromRemoteControl && path === base + '/remote/return') {
          await session.returnFromRemoteControl();
        } else if (path === base + '/connect') await session.connect();
        else if (path === base + '/stop') await session.stop();
        else if (path === base + '/message') {
          const images = body.images === undefined ? [] : body.images;
          if (
            !Array.isArray(images) ||
            images.length > maxMessageImages ||
            new Set(images).size !== images.length ||
            images.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) ||
            (images.length > 0 && !session.images)
          ) {
            json(response, 400, {
              error: 'Attach up to four images to a supported companion. Antigravity currently accepts text only.',
            });
            return;
          }
          if (
            typeof body.text !== 'string' ||
            (!body.text.trim() && !images.length) ||
            body.text.length > 4000 ||
            typeof body.id !== 'string' ||
            !/^[0-9a-f-]{36}$/.test(body.id)
          ) {
            json(response, 400, { error: 'A message (up to 4000 characters) and unique ID are required' });
            return;
          }
          await session.send(body.text.trim(), body.id, images as string[]);
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
