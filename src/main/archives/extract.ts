import { createWriteStream } from 'node:fs';
import { mkdir, statfs } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { ArchiveAnalysis, OperationProgress, PackageRoot } from '@shared/models';
import { README_PATTERN } from '@shared/constants';
import { assertPathInside, checkArchivePath } from '@main/filesystem/path-safety';

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('Could not open ZIP archive.'));
      else resolveZip(zip);
    });
  });
}

function readStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error(`Could not read ${entry.fileName}.`));
      else resolveStream(stream);
    });
  });
}

function mappedPath(entryPath: string, roots: PackageRoot[]): string | null {
  for (const root of roots) {
    const prefix = root.sourcePrefix ? `${root.sourcePrefix.replace(/\/$/, '')}/` : '';
    if (prefix && !entryPath.startsWith(prefix)) continue;
    const child = prefix ? entryPath.slice(prefix.length) : entryPath;
    if (!child) return null;
    return join(root.destinationName, ...child.split('/'));
  }
  return null;
}

export async function ensureDiskSpace(path: string, requiredBytes: number): Promise<void> {
  const stats = await statfs(path);
  const available = stats.bavail * stats.bsize;
  if (available < requiredBytes * 1.15) {
    throw new Error(`Insufficient disk space. ${Math.ceil(requiredBytes * 1.15).toLocaleString()} bytes are required with a safety margin.`);
  }
}

export async function extractAnalysis(
  analysis: ArchiveAnalysis,
  stagingRoot: string,
  signal: AbortSignal,
  onProgress: (progress: Partial<OperationProgress>) => void,
): Promise<{ files: number; bytes: number }> {
  await mkdir(stagingRoot, { recursive: true });
  await ensureDiskSpace(stagingRoot, analysis.uncompressedSize);
  const zip = await openZip(analysis.archivePath);
  let files = 0;
  let bytes = 0;

  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      zip.close();
      if (error) reject(error); else resolvePromise();
    };
    zip.on('error', (error) => finish(error));
    zip.on('entry', (entry) => {
      void (async () => {
        if (signal.aborted) throw new Error('Operation cancelled.');
        const checked = checkArchivePath(entry.fileName);
        if (checked.unsafeReason) throw new Error(`${entry.fileName}: ${checked.unsafeReason}`);
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw new Error('Password-protected archives are not supported.');
        if (/\/$/.test(entry.fileName) || checked.ignored) { zip.readEntry(); return; }
        const soundType = (analysis.manualType ?? analysis.detected.type) === 'sound';
        const documentationPath = soundType && README_PATTERN.test(checked.normalized)
          ? join(analysis.roots[0]?.destinationName ?? analysis.displayName, checked.normalized.split('/').at(-1) ?? 'README.txt')
          : null;
        const relativePath = documentationPath ?? mappedPath(checked.normalized, analysis.roots);
        if (!relativePath) { zip.readEntry(); return; }
        const destination = assertPathInside(stagingRoot, join(stagingRoot, relativePath));
        const rel = relative(resolve(stagingRoot), destination);
        if (!rel || rel.startsWith('..')) throw new Error('Staged path validation failed.');
        await mkdir(dirname(destination), { recursive: true });
        const stream = await readStream(zip, entry);
        await pipeline(stream, createWriteStream(destination, { flags: 'wx' }));
        files += 1;
        bytes += entry.uncompressedSize;
        onProgress({ filesCompleted: files, bytesProcessed: bytes, totalFiles: analysis.fileCount, totalBytes: analysis.uncompressedSize });
        zip.readEntry();
      })().catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
    });
    zip.on('end', () => finish());
    zip.readEntry();
  });
  return { files, bytes };
}
