import { basename, extname } from 'node:path';
import type { ArchiveEntry, DetectedMod, FolderTransformation, PackageRoot } from '@shared/models';
import { isCredibleSkin } from '@main/detection/mod-detection';
import { sanitizeWindowsName } from '@main/filesystem/path-safety';
import { SOUND_EXTENSIONS } from '@shared/constants';

export interface NormalizationResult {
  roots: PackageRoot[];
  transformations: FolderTransformation[];
  ambiguous: boolean;
}

function archiveName(path: string): string {
  return sanitizeWindowsName(basename(path, extname(path)));
}

function filesWithin(entries: ArchiveEntry[], prefix: string): ArchiveEntry[] {
  const normalized = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
  return entries
    .filter((entry) => !entry.isDirectory && !entry.ignored && !entry.unsafeReason)
    .filter((entry) => !normalized || entry.normalizedPath.startsWith(normalized))
    .map((entry) => ({
      ...entry,
      normalizedPath: normalized ? entry.normalizedPath.slice(normalized.length) : entry.normalizedPath,
    }));
}

function directChildren(entries: ArchiveEntry[], prefix: string): { files: ArchiveEntry[]; directories: string[] } {
  const normalized = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
  const files: ArchiveEntry[] = [];
  const directories = new Set<string>();
  for (const entry of entries) {
    if (entry.isDirectory || entry.ignored || entry.unsafeReason || (normalized && !entry.normalizedPath.startsWith(normalized))) continue;
    const rest = normalized ? entry.normalizedPath.slice(normalized.length) : entry.normalizedPath;
    const [head, ...tail] = rest.split('/');
    if (!head) continue;
    if (tail.length === 0) files.push(entry);
    else directories.add(head);
  }
  return { files, directories: [...directories] };
}

function meaningfulFiles(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.filter((entry) => !/(^|\/)(readme|instructions?|install)(\.[^/]*)?$/i.test(entry.normalizedPath));
}

function canonicalSoundModPrefix(entries: ArchiveEntry[]): string | null {
  const soundFiles = entries.filter((entry) => (
    !entry.isDirectory
    && !entry.ignored
    && !entry.unsafeReason
    && SOUND_EXTENSIONS.has(extname(entry.normalizedPath).toLowerCase())
  ));
  if (!soundFiles.length) return null;
  const prefixes = soundFiles.map((entry) => {
    const parts = entry.normalizedPath.split('/');
    for (let index = parts.length - 2; index >= 0; index -= 1) {
      if (parts[index]?.toLowerCase() !== 'mod') continue;
      if (index > 0 && parts[index - 1]?.toLowerCase() === 'sound') return parts.slice(0, index + 1).join('/');
      return parts.slice(0, index + 1).join('/');
    }
    return null;
  });
  const candidate = prefixes[0];
  if (!candidate || prefixes.some((prefix) => prefix?.toLowerCase() !== candidate.toLowerCase())) return null;
  return candidate;
}

export function normalizeArchive(entries: ArchiveEntry[], archivePath: string, detected: DetectedMod): NormalizationResult {
  const transformations: FolderTransformation[] = [];
  const clean = entries.filter((entry) => !entry.ignored && !entry.unsafeReason);
  const fallbackName = archiveName(archivePath);

  if (detected.type === 'skin') {
    const top = directChildren(clean, '');
    const independent = top.directories.filter((directory) => isCredibleSkin(filesWithin(clean, directory)));
    const rootMeaningfulFiles = meaningfulFiles(top.files);
    if (independent.length >= 2 && rootMeaningfulFiles.length === 0 && independent.length === top.directories.length) {
      const roots = independent.map((directory) => ({
        sourcePrefix: directory,
        destinationName: sanitizeWindowsName(directory),
        fileCount: filesWithin(clean, directory).length,
      }));
      transformations.push({
        kind: 'multi-root', from: fallbackName, to: roots.map((root) => root.destinationName).join(', '),
        reason: `${roots.length} independent skin folders were found.`,
      });
      return { roots, transformations, ambiguous: false };
    }

    if (top.directories.length === 0 || rootMeaningfulFiles.length > 0) {
      transformations.push({
        kind: 'wrap-loose-files', from: '(ZIP root)', to: fallbackName,
        reason: 'Loose skin files need one parent folder under UserSkins.',
      });
      return { roots: [{ sourcePrefix: '', destinationName: fallbackName, fileCount: filesWithin(clean, '').length }], transformations, ambiguous: false };
    }

    let prefix = '';
    const wrappers: string[] = [];
    while (true) {
      const current = directChildren(clean, prefix);
      const currentFiles = meaningfulFiles(current.files);
      if (currentFiles.length > 0 || current.directories.length !== 1) break;
      const child = current.directories[0];
      if (!child) break;
      wrappers.push(child);
      prefix = prefix ? `${prefix}/${child}` : child;
    }
    const selectedFiles = filesWithin(clean, prefix);
    if (prefix && isCredibleSkin(selectedFiles)) {
      const destinationName = sanitizeWindowsName(prefix.split('/').at(-1) ?? fallbackName);
      transformations.push({
        kind: wrappers.length > 1 ? 'flatten-wrapper' : 'preserve-root',
        from: prefix,
        to: destinationName,
        reason: wrappers.length > 1 ? 'Redundant single-child wrapper folders were removed.' : 'The existing valid skin folder is preserved.',
      });
      return { roots: [{ sourcePrefix: prefix, destinationName, fileCount: selectedFiles.length }], transformations, ambiguous: false };
    }
    return { roots: [], transformations, ambiguous: true };
  }

  if (detected.type === 'sound') {
    const canonicalPrefix = canonicalSoundModPrefix(clean);
    if (canonicalPrefix) {
      const files = filesWithin(clean, canonicalPrefix);
      transformations.push({
        kind: 'flatten-wrapper',
        from: canonicalPrefix,
        to: fallbackName,
        reason: 'The archive sound/mod wrapper is removed so its contents deploy directly into War Thunder/sound/mod.',
      });
      return { roots: [{ sourcePrefix: canonicalPrefix, destinationName: fallbackName, fileCount: files.length }], transformations, ambiguous: files.length === 0 };
    }
    let prefix = '';
    const wrappers: string[] = [];
    while (true) {
      const current = directChildren(clean, prefix);
      const meaningful = meaningfulFiles(current.files);
      if (meaningful.length > 0 || current.directories.length !== 1) break;
      const child = current.directories[0];
      if (!child) break;
      wrappers.push(child);
      prefix = prefix ? `${prefix}/${child}` : child;
    }
    const files = filesWithin(clean, prefix);
    transformations.push({
      kind: wrappers.length > 1 ? 'flatten-wrapper' : prefix ? 'preserve-root' : 'wrap-loose-files',
      from: prefix || '(ZIP root)',
      to: fallbackName,
      reason: 'Sound files are normalised into a managed library package before activation.',
    });
    return { roots: [{ sourcePrefix: prefix, destinationName: fallbackName, fileCount: files.length }], transformations, ambiguous: files.length === 0 };
  }

  return { roots: [], transformations, ambiguous: true };
}
