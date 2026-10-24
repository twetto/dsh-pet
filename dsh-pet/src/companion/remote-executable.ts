import { statSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';

/** ConPTY does not perform Node's Windows .exe lookup. Never use a shell wrapper. */
export function remoteExecutable(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  platform: string = process.platform,
): string {
  if (platform !== 'win32') return executable;
  const extension = extname(executable).toLowerCase();
  if (extension && !['.exe', '.com'].includes(extension))
    throw new Error(
      'Browser upload requires a native executable. Set DSH_PET_AGY_PATH to the full path of agy.exe, not a shell script.',
    );
  const names = extension ? [executable] : [executable + '.exe', executable + '.com'];
  const explicit = isAbsolute(executable) || /[\\/]/.test(executable);
  const path = Object.entries(env).find(([name]) => name.toUpperCase() === 'PATH')?.[1] || '';
  const directories = explicit
    ? [cwd]
    : path
        .split(';')
        .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
        .filter(Boolean);
  for (const directory of directories) {
    for (const name of names) {
      const candidate = resolve(explicit ? resolve(cwd, name) : join(directory, name));
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* Try the next PATH entry. */
      }
    }
  }
  throw new Error(
    `Browser upload could not find the native executable "${executable}"${explicit ? '' : ' on PATH'}. Set DSH_PET_AGY_PATH to the full path of agy.exe and restart the service.`,
  );
}
