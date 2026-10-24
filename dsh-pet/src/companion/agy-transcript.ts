import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import type { CompanionStore, ChatMessage } from './store';
import type { CompanionImages, ImageAttachment } from './images';
import { maxMessageImages } from './image-limits';

const maxTranscriptBytes = 32 * 1024 * 1024;
const validThread = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type RecordValue = Record<string, unknown>;
interface NativeStep extends RecordValue {
  step_index: number;
  source: string;
  type: string;
  status: string;
}
export interface TranscriptCheckpoint {
  version: 1;
  count: number;
  digest: string;
}

function directory(root: string, parts: string[]): string {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe native transcript directory');
  }
  return path;
}

function conversationRoot(home: string, threadId: string): string {
  if (!validThread.test(threadId)) throw new Error('Invalid native conversation ID');
  return directory(realpathSync(home), ['.gemini', 'antigravity-cli', 'brain', threadId]);
}

function readSteps(home: string, threadId: string): NativeStep[] {
  const root = conversationRoot(home, threadId);
  const path = join(directory(root, ['.system_generated', 'logs']), 'transcript.jsonl');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxTranscriptBytes)
    throw new Error('Unsafe or oversized native transcript');
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  let text: string;
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > maxTranscriptBytes) throw new Error('Unsafe native transcript');
    const bytes = Buffer.alloc(Math.min(opened.size + 1, maxTranscriptBytes + 1));
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(descriptor);
    if (size !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      throw new Error('Native transcript is still changing');
    text = bytes.subarray(0, size).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
  const lines = text.trim() ? text.trimEnd().split('\n') : [];
  if (lines.length > 50000) throw new Error('Native transcript has too many steps');
  return lines.map((line, index) => {
    const value = JSON.parse(line) as NativeStep;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.step_index !== index ||
      typeof value.source !== 'string' ||
      typeof value.type !== 'string' ||
      typeof value.status !== 'string'
    )
      throw new Error('Unrecognized native transcript format');
    return value;
  });
}

function digest(steps: NativeStep[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        steps.map((step) => ({
          step_index: step.step_index,
          source: step.source,
          type: step.type,
          status: step.status,
          created_at: step.created_at,
          content: step.content,
          media: step.media,
          truncated_fields: step.truncated_fields,
        })),
      ),
    )
    .digest('hex');
}

export function captureAgyTranscript(home: string, threadId: string): TranscriptCheckpoint {
  const steps = readSteps(home, threadId);
  return { version: 1, count: steps.length, digest: digest(steps) };
}

function userText(content: string): string {
  const start = '<USER_REQUEST>\n';
  const end = '\n</USER_REQUEST>';
  const boundary = content.indexOf(end);
  if (!content.startsWith(start) || boundary < 0 || boundary !== content.lastIndexOf(end))
    throw new Error('Unrecognized native user-message wrapper');
  const suffix = content.slice(boundary + end.length);
  if (
    suffix &&
    !/^\n<ADDITIONAL_METADATA>[\s\S]*<\/ADDITIONAL_METADATA>(?:\n<USER_SETTINGS_CHANGE>[\s\S]*<\/USER_SETTINGS_CHANGE>)?\s*$/.test(
      suffix,
    )
  )
    throw new Error('Unrecognized native user-message metadata');
  return content.slice(start.length, boundary);
}

/** Repair checkpoints discarded by older versions only when the entire short,
 * complete local chat exactly matches the native prefix. Never guess a boundary
 * from a single repeated message, a partial display window or imported history.
 */
export function recoverAgyTranscriptCheckpoint(
  home: string,
  threadId: string,
  messages: ChatMessage[],
): TranscriptCheckpoint {
  if (
    !messages.length ||
    messages.length >= 200 ||
    messages.length % 2 ||
    messages.some(
      (message, index) =>
        !validThread.test(message.id) ||
        message.status !== 'complete' ||
        message.role !== (index % 2 ? 'assistant' : 'user') ||
        !!message.images?.length,
    )
  )
    throw new Error('Cannot verify the complete local history prefix');
  const steps = readSteps(home, threadId);
  let matched = 0;
  for (const step of steps) {
    const user = step.source === 'USER_EXPLICIT' && step.type === 'USER_INPUT';
    const assistant = step.source === 'MODEL' && step.type === 'PLANNER_RESPONSE';
    if (!user && !assistant) {
      if (step.source === 'SYSTEM' || ['TOOL_CALL', 'TOOL_RESULT', 'TOOL_RESPONSE'].includes(step.type)) continue;
      throw new Error('Unrecognized native message type');
    }
    const message = messages[matched];
    if (
      step.status !== 'DONE' ||
      typeof step.content !== 'string' ||
      (step.truncated_fields !== undefined &&
        (!Array.isArray(step.truncated_fields) || step.truncated_fields.length)) ||
      (step.media !== undefined && (!Array.isArray(step.media) || step.media.length)) ||
      message.role !== (user ? 'user' : 'assistant') ||
      (user
        ? message.text !== userText(step.content)
        : message.text.replace(/\r?\n$/, '') !== step.content.replace(/\r?\n$/, ''))
    )
      throw new Error('Local history does not match the complete native prefix');
    matched++;
    if (matched === messages.length) {
      const count = step.step_index + 1;
      return { version: 1, count, digest: digest(steps.slice(0, count)) };
    }
  }
  throw new Error('Native history is shorter than the saved local history');
}

function mediaPath(home: string, threadId: string, uri: unknown, aliasHome?: string): string {
  if (typeof uri !== 'string' || uri.length > 4096 || !isAbsolute(uri))
    throw new Error('Unsafe native image reference');
  let imagePath = uri;
  const root = directory(conversationRoot(home, threadId), ['.user_uploaded']);
  let inside = relative(root, imagePath);
  // Agy sees its child-only home, so uploads can use the approved brain junction.
  // Rebase only that exact alias; arbitrary symlinked paths remain rejected.
  if (aliasHome) {
    const aliasParent = directory(realpathSync(aliasHome), ['.gemini', 'antigravity-cli']);
    const aliasBrain = join(aliasParent, 'brain');
    const nativeBrain = directory(realpathSync(home), ['.gemini', 'antigravity-cli', 'brain']);
    if (!lstatSync(aliasBrain).isSymbolicLink() || realpathSync(aliasBrain) !== realpathSync(nativeBrain))
      throw new Error('Unverified companion native-image alias');
    const aliasRoot = join(aliasBrain, threadId, '.user_uploaded');
    const candidate = relative(aliasRoot, imagePath);
    if (
      candidate &&
      candidate !== '..' &&
      !candidate.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
      !isAbsolute(candidate)
    ) {
      inside = candidate;
      imagePath = join(root, inside);
    }
  }
  if (
    !inside ||
    inside === '..' ||
    inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
    isAbsolute(inside)
  )
    throw new Error('Image is outside the native conversation');
  const parent = dirname(inside);
  directory(root, parent === '.' ? [] : parent.split(/[\\/]/));
  const stat = lstatSync(imagePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe native image file');
  if (relative(root, realpathSync(imagePath)) !== inside) throw new Error('Native image path changed');
  return imagePath;
}

export function importAgyTranscript(
  home: string,
  threadId: string,
  checkpoint: TranscriptCheckpoint,
  store: CompanionStore,
  images: CompanionImages,
  metadata: Record<string, string> = {},
  aliasHome?: string,
): number {
  const steps = readSteps(home, threadId);
  if (
    checkpoint.version !== 1 ||
    !Number.isSafeInteger(checkpoint.count) ||
    checkpoint.count < 0 ||
    checkpoint.count > steps.length ||
    digest(steps.slice(0, checkpoint.count)) !== checkpoint.digest
  )
    throw new Error('Native history changed or was rewound; saved history was not modified');
  const imported: ChatMessage[] = [];
  const staged: ImageAttachment[] = [];
  const committedMetadata = { ...metadata };
  try {
    for (const step of steps.slice(checkpoint.count)) {
      const user = step.source === 'USER_EXPLICIT' && step.type === 'USER_INPUT';
      const assistant = step.source === 'MODEL' && step.type === 'PLANNER_RESPONSE';
      if (!user && !assistant) {
        if (step.source === 'SYSTEM' || ['TOOL_CALL', 'TOOL_RESULT', 'TOOL_RESPONSE'].includes(step.type)) continue;
        throw new Error('Unrecognized native message type');
      }
      if (
        step.status !== 'DONE' ||
        typeof step.content !== 'string' ||
        step.content.length > 1024 * 1024 ||
        (step.truncated_fields !== undefined && (!Array.isArray(step.truncated_fields) || step.truncated_fields.length))
      )
        throw new Error('Native message is incomplete or truncated');
      const text = user ? userText(step.content) : step.content;
      const created = typeof step.created_at === 'string' ? Date.parse(step.created_at) : NaN;
      if (!Number.isFinite(created)) throw new Error('Native message has no valid timestamp');
      const id = `agy:${threadId}:${step.step_index}`;
      const nativeDigest = digest([step]);
      const existing = store.message(id);
      if (existing) {
        if (
          existing.text !== text ||
          existing.role !== (user ? 'user' : 'assistant') ||
          existing.created !== created ||
          store.metadata('agyNativeStep:' + id) !== nativeDigest
        )
          throw new Error('Native message conflicts with imported history');
        continue;
      }
      const attachments: ImageAttachment[] = [];
      committedMetadata['agyNativeStep:' + id] = nativeDigest;
      if (step.media !== undefined) {
        if (!user || !Array.isArray(step.media) || step.media.length > maxMessageImages)
          throw new Error('Unsupported native image attachments');
        for (const value of step.media) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native image');
          const media = value as RecordValue;
          const path = mediaPath(home, threadId, media.uri, aliasHome);
          const image = images.attachPath(path);
          staged.push(image);
          if (image.mediaType !== media.mime_type) throw new Error('Unsupported native image format');
          attachments.push({ ...image, name: basename(path) });
        }
      }
      imported.push({
        id,
        role: user ? 'user' : 'assistant',
        text,
        status: 'complete',
        created,
        ...(attachments.length ? { images: attachments } : {}),
      });
    }
    store.importMessages(imported, committedMetadata);
    return imported.length;
  } catch (error) {
    for (const image of staged) images.remove(image.id);
    throw error;
  }
}
