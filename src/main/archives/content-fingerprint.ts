import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { HASH_FILE_CONCURRENCY, mapWithConcurrency } from '@main/concurrency';

export interface ContentFingerprintEntry {
  path: string;
  digest: string;
}

function canonicalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export function createContentFingerprint(entries: ContentFingerprintEntry[], namespace = 'skin-v2'): string {
  const hash = createHash('sha256');
  const sorted = [...entries].sort((left, right) => {
    const leftPath = canonicalPath(left.path);
    const rightPath = canonicalPath(right.path);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
  for (const entry of sorted) {
    hash.update(canonicalPath(entry.path));
    hash.update('\0');
    hash.update(entry.digest);
    hash.update('\0');
  }
  return `${namespace}:${hash.digest('hex')}`;
}

export function entryChecksum(crc: number, size: number): string {
  return `${(crc >>> 0).toString(16).padStart(8, '0')}:${size}`;
}

async function checksumReadable(stream: Readable): Promise<string> {
  let checksum = 0;
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as ArrayBuffer);
    checksum = crc32(chunk, checksum);
    size += chunk.byteLength;
  }
  return entryChecksum(checksum, size);
}

export interface DirectoryContentSummary {
  contentHash: string;
  fileCount: number;
  totalSize: number;
}

async function collectFiles(root: string): Promise<Array<{ absolute: string; relative: string; size: number }>> {
  const files: Array<{ absolute: string; relative: string; size: number }> = [];

  async function walk(current: string): Promise<void> {
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink()) throw new Error(`Skin folder contains a link that cannot be fingerprinted: ${current}`);
    if (currentStat.isFile()) {
      files.push({ absolute: current, relative: relative(root, current), size: currentStat.size });
      return;
    }
    if (!currentStat.isDirectory()) return;
    const children = await readdir(current);
    for (const child of children) await walk(join(current, child));
  }

  await walk(root);
  return files;
}

export async function inspectDirectoryContent(root: string): Promise<DirectoryContentSummary> {
  const files = await collectFiles(root);
  const entries = await mapWithConcurrency(files, HASH_FILE_CONCURRENCY, async (file) => ({
    path: file.relative,
    digest: await checksumReadable(createReadStream(file.absolute)),
  }));

  return {
    contentHash: createContentFingerprint(entries),
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
  };
}

export async function fingerprintDirectory(root: string): Promise<string> {
  return (await inspectDirectoryContent(root)).contentHash;
}
