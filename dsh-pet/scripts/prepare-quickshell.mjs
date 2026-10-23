import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreClips, animationSource, clickResponses } from '../runtime/quickshell/catalog.mjs';

const names =
  process.argv.length > 2 ? process.argv.slice(2) : [...new Set([...Object.keys(coreClips), ...clickResponses()])];
for (const name of names) {
  const source = fileURLToPath(animationSource(name));
  const output = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'dsh-pet', 'quickshell', `${name}.webp`);
  mkdirSync(dirname(output), { recursive: true });
  if (existsSync(output)) {
    console.log(output);
    continue;
  }
  const temporary = `${output}.${process.pid}.tmp.webp`;
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-c:v',
      'libvpx-vp9',
      '-i',
      source,
      '-an',
      '-vf',
      'scale=400:-1',
      '-c:v',
      'libwebp_anim',
      '-lossless',
      '1',
      '-loop',
      '0',
      temporary,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) {
    rmSync(temporary, { force: true });
    process.exit(result.status ?? 1);
  }
  renameSync(temporary, output);
  console.log(output);
}
