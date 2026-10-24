import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { privateDirectory } from './store';
import { maxImageBytes } from './image-limits';
export { maxImageBytes, maxMessageImages } from './image-limits';

export interface ImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
}

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function imageType(bytes: Buffer): string {
  let width = 0;
  let height = 0;
  let type = '';
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    type = 'image/png';
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    type = 'image/gif';
    width = bytes.readUInt16LE(6);
    height = bytes.readUInt16LE(8);
  } else if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    type = 'image/webp';
    const chunk = bytes.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
      height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6));
    }
    if (chunk === 'VP8 ' && bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    type = 'image/jpeg';
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      if (offset + 3 > bytes.length) break;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) &&
        length >= 8
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!type || !width || !height) throw new Error('Use a valid PNG, JPEG, WebP or GIF image.');
  if (width > 8000 || height > 8000 || width * height > 20_000_000)
    throw new Error('Image is too large: maximum 8000px per side and 20 megapixels.');
  if (type === 'image/png') {
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (length > bytes.length - offset - 12) break;
      if (bytes.toString('ascii', offset + 4, offset + 8) === 'IEND') {
        ended = length === 0 && offset + 12 === bytes.length;
        break;
      }
      offset += length + 12;
    }
    if (!ended) throw new Error('PNG data is truncated or malformed.');
  }
  return type;
}

function boundedRead(path: string): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxImageBytes || !stat.size)
    throw new Error('Choose a regular image file up to 5 MiB, not a link or device.');
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size > maxImageBytes) throw new Error('Unsafe image file.');
    const buffer = Buffer.alloc(maxImageBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(descriptor, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (!size || size > maxImageBytes) throw new Error('Image exceeds the 5 MiB limit.');
    return buffer.subarray(0, size);
  } finally {
    closeSync(descriptor);
  }
}

export class CompanionImages {
  private directory: string;
  constructor(directory: string) {
    this.directory = directory;
    privateDirectory(directory);
  }

  upload(value: unknown): ImageAttachment {
    const body = value as { name?: unknown; data?: unknown };
    if (
      typeof body?.data !== 'string' ||
      !body.data.length ||
      body.data.length > Math.ceil(maxImageBytes / 3) * 4 ||
      body.data.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)
    )
      throw new Error('Invalid or oversized base64 image. Maximum 5 MiB.');
    const bytes = Buffer.from(body.data, 'base64');
    if (bytes.toString('base64') !== body.data) throw new Error('Invalid base64 image.');
    return this.save(bytes, typeof body.name === 'string' ? body.name : 'image');
  }

  attachPath(value: unknown): ImageAttachment {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096)
      throw new Error('Enter an absolute image path.');
    let path = value.trim();
    if (path.startsWith('file:')) path = fileURLToPath(path);
    if (path.startsWith('~/')) path = join(homedir(), path.slice(2));
    if (!isAbsolute(path)) throw new Error('Use an absolute image path or ~/path. URLs are not fetched.');
    return this.save(boundedRead(path), basename(path));
  }

  private save(bytes: Buffer, name: string): ImageAttachment {
    if (!bytes.length || bytes.length > maxImageBytes) throw new Error('Image exceeds the 5 MiB limit.');
    const mediaType = imageType(bytes);
    let total = 0;
    for (const file of readdirSync(this.directory).filter((file) => file.endsWith('.bin')))
      total += lstatSync(join(this.directory, file)).size;
    if (total + bytes.length > 256 * 1024 * 1024) throw new Error('Private image storage reached its 256 MiB limit.');
    const info = {
      id: randomUUID(),
      name:
        basename(name.replace(/\\/g, '/'))
          .split('')
          .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
          .join('')
          .slice(0, 120) || 'image',
      mediaType,
      size: bytes.length,
    };
    const path = join(this.directory, info.id);
    writeFileSync(path + '.bin', bytes, { flag: 'wx', mode: 0o600 });
    try {
      writeFileSync(
        path + '.json',
        JSON.stringify({ ...info, digest: createHash('sha256').update(bytes).digest('hex') }),
        { flag: 'wx', mode: 0o600 },
      );
    } catch (error) {
      unlinkSync(path + '.bin');
      throw error;
    }
    return info;
  }

  read(id: string): { info: ImageAttachment; bytes: Buffer } {
    if (!validId.test(id)) throw new Error('Invalid image ID.');
    const path = join(this.directory, id);
    if (
      !existsSync(path + '.json') ||
      !lstatSync(path + '.json').isFile() ||
      lstatSync(path + '.json').isSymbolicLink() ||
      lstatSync(path + '.json').size > 4096
    )
      throw new Error('Image not found.');
    const saved = JSON.parse(readFileSync(path + '.json', 'utf8')) as ImageAttachment & { digest: string };
    const bytes = boundedRead(path + '.bin');
    if (
      saved.id !== id ||
      saved.size !== bytes.length ||
      saved.mediaType !== imageType(bytes) ||
      saved.digest !== createHash('sha256').update(bytes).digest('hex')
    )
      throw new Error('Saved image failed validation.');
    return { info: { id, name: saved.name, mediaType: saved.mediaType, size: saved.size }, bytes };
  }

  remove(id: string): void {
    this.read(id);
    unlinkSync(join(this.directory, id + '.json'));
    unlinkSync(join(this.directory, id + '.bin'));
  }
}
