import { readdir } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { copyDirectory, pathExists } from '@main/filesystem/file-operations';
import { SOUND_EXTENSIONS } from '@shared/constants';

const RECOGNIZED_SOUND_EXTENSIONS = new Set([
  ...SOUND_EXTENSIONS,
  '.aac', '.flac', '.m4a', '.mp3', '.opus', '.wem',
]);

export async function listSoundPayloadFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Sound package contains a link: ${path}`);
    if (entry.isDirectory()) result.push(...await listSoundPayloadFiles(root, path));
    else if (entry.isFile()) result.push(relative(root, path).replace(/\\/g, '/'));
  }
  return result;
}

async function containsRecognizedSound(root: string): Promise<boolean> {
  if (!await pathExists(root)) return false;
  try {
    return (await listSoundPayloadFiles(root)).some((path) => RECOGNIZED_SOUND_EXTENSIONS.has(extname(path).toLowerCase()));
  } catch {
    return false;
  }
}

async function containsDirectRecognizedSound(root: string): Promise<boolean> {
  if (!await pathExists(root)) return false;
  try {
    return (await readdir(root, { withFileTypes: true })).some((entry) => (
      entry.isFile() && RECOGNIZED_SOUND_EXTENSIONS.has(extname(entry.name).toLowerCase())
    ));
  } catch {
    return false;
  }
}

/**
 * Resolve the directory whose contents belong directly in War Thunder/sound/mod.
 * Older imports may still contain package, sound, or mod wrapper directories.
 */
export async function resolveSoundPayloadRoot(libraryPath: string): Promise<string> {
  let current = libraryPath;
  for (let depth = 0; depth < 6; depth += 1) {
    const canonicalCandidates = [join(current, 'sound', 'mod'), join(current, 'mod')];
    if (basename(current).toLowerCase() === 'mod') canonicalCandidates.unshift(current);
    for (const candidate of canonicalCandidates) {
      if (await containsRecognizedSound(candidate)) return candidate;
    }
    if (await containsDirectRecognizedSound(current)) return current;
    let directories;
    try {
      directories = (await readdir(current, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
    } catch {
      break;
    }
    if (directories.length !== 1 || !directories[0]) break;
    current = join(current, directories[0].name);
  }
  if (await containsRecognizedSound(libraryPath)) return libraryPath;
  return libraryPath;
}

export async function copySoundPayload(libraryPath: string, destination: string): Promise<string> {
  const payloadRoot = await resolveSoundPayloadRoot(libraryPath);
  await copyDirectory(payloadRoot, destination, true);
  return payloadRoot;
}
