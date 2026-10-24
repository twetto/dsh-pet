import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { privateDirectory } from './store';

/** A child-only home: no global plugins, hooks, rules, MCP or settings are inherited.
 * Native conversation databases and transcripts keep their original location so
 * existing thread IDs and Remote Control history remain usable. Credentials are
 * resolved by agy through the OS keyring; we never copy login files.
 */
export function prepareAgyHome(home: string, nativeHome: string): NodeJS.ProcessEnv {
  privateDirectory(home);
  privateDirectory(join(home, '.gemini'));
  privateDirectory(join(home, '.gemini', 'config'));
  const local = join(home, '.gemini', 'antigravity-cli');
  privateDirectory(local);
  let native = realpathSync(nativeHome);
  for (const part of ['.gemini', 'antigravity-cli']) {
    native = join(native, part);
    mkdirSync(native, { recursive: true, mode: 0o700 });
    const stat = lstatSync(native);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe Antigravity native data directory');
  }
  for (const name of ['brain', 'conversations']) {
    const source = join(native, name);
    mkdirSync(source, { recursive: true, mode: 0o700 });
    const stat = lstatSync(source);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe Antigravity native data directory');
    const target = join(local, name);
    let linked = false;
    try {
      linked = lstatSync(target).isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (linked) {
      if (realpathSync(target) !== realpathSync(source)) throw new Error('Unexpected Antigravity native data link');
    } else {
      if (existsSync(target)) throw new Error('Unexpected Antigravity native data directory');
      symlinkSync(resolve(source), target, process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
  // Reuse only first-run completion booleans already recorded by the user's CLI.
  // Never accept terms automatically or import settings, tokens or plugin state.
  const onboarding = join(native, 'cache', 'onboarding.json');
  if (existsSync(onboarding)) {
    const stat = lstatSync(onboarding);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192)
      throw new Error('Unsafe Antigravity onboarding status');
    const source = JSON.parse(readFileSync(onboarding, 'utf8')) as Record<string, unknown>;
    if (source?.onboardingComplete === true) {
      const cache = join(local, 'cache');
      privateDirectory(cache);
      const target = join(cache, 'onboarding.json');
      if (existsSync(target) && (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()))
        throw new Error('Unsafe companion onboarding status');
      writeFileSync(
        target,
        JSON.stringify({
          onboardingComplete: true,
          consumerOnboardingComplete: source.consumerOnboardingComplete === true,
          enterpriseOnboardingComplete: source.enterpriseOnboardingComplete === true,
        }),
        { mode: 0o600 },
      );
    }
  }
  const env = { ...process.env };
  // Windows environment keys are case-insensitive; remove alternate spellings.
  for (const name of Object.keys(env)) {
    if (
      ['HOME', 'USERPROFILE'].includes(name.toUpperCase()) ||
      ['ANTIGRAVITY_LS_ADDRESS', 'ANTIGRAVITY_CSRF_TOKEN', 'ANTIGRAVITY_PROJECT_ID'].includes(name)
    )
      delete env[name];
  }
  return { ...env, HOME: resolve(home), USERPROFILE: resolve(home) };
}
