import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { stat } from 'node:fs/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import {
  MAX_ARCHIVE_FILES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_COMPRESSION_RATIO,
} from '@shared/constants';
import type { ArchiveAnalysis, ArchiveEntry, PackageRoot, ValidationWarning } from '@shared/models';
import { checkArchivePath } from '@main/filesystem/path-safety';
import { classifyArchive } from '@main/detection/mod-detection';
import { normalizeArchive } from './normalization';
import { createContentFingerprint, entryChecksum, type ContentFingerprintEntry } from './content-fingerprint';

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('Could not open ZIP archive.'));
      else resolve(zip);
    });
  });
}

function isSymlink(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

function rootMatch(entryPath: string, roots: PackageRoot[]): { index: number; relativePath: string } | null {
  for (const [index, root] of roots.entries()) {
    const prefix = root.sourcePrefix ? `${root.sourcePrefix.replace(/\/$/, '')}/` : '';
    if (prefix && !entryPath.startsWith(prefix)) continue;
    const relativePath = prefix ? entryPath.slice(prefix.length) : entryPath;
    if (relativePath) return { index, relativePath };
  }
  return null;
}

function fingerprintArchiveRoots(entries: ArchiveMetadataEntry[], roots: PackageRoot[]): string[] {
  const entriesByRoot: ContentFingerprintEntry[][] = roots.map(() => []);
  for (const entry of entries) {
    if (entry.isDirectory || entry.ignored || entry.unsafe) continue;
    const match = rootMatch(entry.path, roots);
    if (match) entriesByRoot[match.index]?.push({ path: match.relativePath, digest: entry.checksum });
  }
  return entriesByRoot.map((entries) => createContentFingerprint(entries));
}

interface ArchiveMetadataEntry {
  path: string;
  checksum: string;
  isDirectory: boolean;
  ignored: boolean;
  unsafe: boolean;
}

export interface ArchiveInspectionProgress {
  entriesRead: number;
  totalEntries: number;
}

export async function inspectArchive(
  archivePath: string,
  gameRoot: string | null,
  signal?: AbortSignal,
  onProgress?: (progress: ArchiveInspectionProgress) => void,
): Promise<ArchiveAnalysis> {
  if (extname(archivePath).toLowerCase() !== '.zip') throw new Error('Only ZIP archives are supported.');
  const archiveStat = await stat(archivePath);
  if (!archiveStat.isFile()) throw new Error('The selected archive is not a file.');
  const zip = await openZip(archivePath);
  const entries: ArchiveEntry[] = [];
  const metadataEntries: ArchiveMetadataEntry[] = [];
  const warnings: ValidationWarning[] = [];

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      zip.close();
      if (error) reject(error); else resolve();
    };
    zip.on('error', (error) => finish(error));
    zip.on('entry', (entry) => {
      if (signal?.aborted) return finish(new Error('Archive analysis cancelled.'));
      if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
        warnings.push({ code: 'encrypted', level: 'error', title: 'Password-protected archive', detail: 'Encrypted ZIP entries cannot be inspected or installed safely.' });
      }
      const checked = checkArchivePath(entry.fileName);
      const directory = /\/$/.test(entry.fileName);
      const symlink = isSymlink(entry);
      metadataEntries.push({
        path: checked.normalized,
        checksum: entryChecksum(entry.crc32, entry.uncompressedSize),
        isDirectory: directory,
        ignored: checked.ignored,
        unsafe: Boolean(checked.unsafeReason || symlink),
      });
      entries.push({
        path: entry.fileName,
        normalizedPath: checked.normalized,
        isDirectory: directory,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        ignored: checked.ignored,
        executable: checked.executable,
        ...(checked.unsafeReason || symlink ? { unsafeReason: checked.unsafeReason ?? 'Symbolic links are not allowed in archives.' } : {}),
      });
      if (entries.length === 1 || entries.length % 250 === 0 || entries.length === zip.entryCount) {
        onProgress?.({ entriesRead: entries.length, totalEntries: zip.entryCount });
      }
      if (entries.length > MAX_ARCHIVE_FILES) return finish(new Error(`Archive exceeds the ${MAX_ARCHIVE_FILES.toLocaleString()} entry safety limit.`));
      zip.readEntry();
    });
    zip.on('end', () => finish());
    zip.readEntry();
  });

  const files = entries.filter((entry) => !entry.isDirectory);
  const totalUncompressed = files.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  const totalCompressed = files.reduce((sum, entry) => sum + entry.compressedSize, 0);
  if (totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    warnings.push({ code: 'size-limit', level: 'error', title: 'Archive is too large', detail: 'The estimated extracted size exceeds the 20 GB safety limit.' });
  }
  const ratio = totalUncompressed / Math.max(1, totalCompressed);
  if (ratio > MAX_COMPRESSION_RATIO) {
    warnings.push({ code: 'compression-ratio', level: 'error', title: 'Implausible compression ratio', detail: `The ${Math.round(ratio)}:1 ratio resembles a decompression bomb.` });
  }
  const unsafe = files.filter((entry) => entry.unsafeReason);
  if (unsafe.length) warnings.push({ code: 'unsafe-path', level: 'error', title: 'Unsafe archive paths', detail: `${unsafe.length} entries contain traversal, link, reserved-name, or absolute-path hazards.` });
  const executable = files.filter((entry) => entry.executable);
  if (executable.length) warnings.push({ code: 'executable', level: 'warning', title: 'Executable content included', detail: `${executable.length} executable ${executable.length === 1 ? 'file was' : 'files were'} found. Tailmark will never run them.` });

  const detected = classifyArchive(entries);
  const normalized = normalizeArchive(entries, archivePath, detected);
  if (normalized.ambiguous) detected.needsReview = true;
  const hardError = warnings.some((warning) => warning.level === 'error');
  const rootHashes = detected.type === 'skin' && !hardError && normalized.roots.length
    ? fingerprintArchiveRoots(metadataEntries, normalized.roots)
    : [];
  const roots = normalized.roots.map((root, index) => rootHashes[index] ? { ...root, contentHash: rootHashes[index] } : root);
  const displayName = basename(archivePath, extname(archivePath));
  const typeRoot = detected.type === 'skin' ? 'UserSkins' : detected.type === 'sound' ? 'Sound library' : 'Review required';
  const proposedDestination = normalized.roots.length === 1
    ? `${typeRoot}/${normalized.roots[0]?.destinationName ?? displayName}`
    : `${typeRoot}/${normalized.roots.length} folders`;

  return {
    id: randomUUID(),
    archivePath,
    displayName,
    originalFilename: basename(archivePath),
    archiveHash: createContentFingerprint(
      metadataEntries
        .filter((entry) => !entry.isDirectory && !entry.ignored && !entry.unsafe)
        .map((entry) => ({ path: entry.path, digest: entry.checksum })),
      'archive-v2',
    ),
    fileCount: files.length,
    uncompressedSize: totalUncompressed,
    compressedSize: archiveStat.size,
    entries,
    detected,
    roots,
    transformations: normalized.transformations,
    proposedDestination: gameRoot ? `${gameRoot}/${proposedDestination}` : proposedDestination,
    warnings,
    conflicts: [],
    status: hardError || detected.needsReview ? 'needs-review' : 'ready',
  };
}
