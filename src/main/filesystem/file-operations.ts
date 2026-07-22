import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false);
}

export async function directorySummary(path: string): Promise<{ fileCount: number; totalSize: number }> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) throw new Error(`Links are not followed: ${path}`);
  if (entry.isFile()) return { fileCount: 1, totalSize: entry.size };
  if (!entry.isDirectory()) return { fileCount: 0, totalSize: 0 };
  const children = await readdir(path);
  let fileCount = 0;
  let totalSize = 0;
  for (const child of children) {
    const summary = await directorySummary(join(path, child));
    fileCount += summary.fileCount;
    totalSize += summary.totalSize;
  }
  return { fileCount, totalSize };
}

export async function directorySize(path: string): Promise<number> {
  return (await directorySummary(path)).totalSize;
}

export async function countFiles(path: string): Promise<number> {
  return (await directorySummary(path)).fileCount;
}

export async function copyDirectory(source: string, destination: string, overwrite = false): Promise<void> {
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) throw new Error(`Refusing to copy link: ${source}`);
  if (sourceStat.isFile()) {
    await mkdir(dirname(destination), { recursive: true });
    if (!overwrite && await pathExists(destination)) throw new Error(`Destination already exists: ${destination}`);
    await pipeline(createReadStream(source), createWriteStream(destination, { flags: overwrite ? 'w' : 'wx' }));
    return;
  }
  if (!sourceStat.isDirectory()) throw new Error(`Unsupported filesystem entry: ${source}`);
  await mkdir(destination, { recursive: true });
  for (const child of await readdir(source)) {
    await copyDirectory(join(source, child), join(destination, child), overwrite);
  }
}

export async function replaceDirectory(staged: string, destination: string, rollbackPath: string): Promise<void> {
  const destinationExists = await pathExists(destination);
  if (destinationExists) await rename(destination, rollbackPath);
  try {
    await rename(staged, destination);
    if (destinationExists) await rm(rollbackPath, { recursive: true, force: true });
  } catch (error) {
    if (await pathExists(destination)) await rm(destination, { recursive: true, force: true });
    if (destinationExists && await pathExists(rollbackPath)) await rename(rollbackPath, destination);
    throw error;
  }
}

export async function readableCopyName(parent: string, base: string): Promise<string> {
  let index = 2;
  let candidate = `${base} (${index})`;
  while (await pathExists(join(parent, candidate))) {
    index += 1;
    candidate = `${base} (${index})`;
  }
  return candidate;
}
