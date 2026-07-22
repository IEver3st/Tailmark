import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ArchiveAnalysis, CollisionPolicy, InstallResult, OperationProgress, PackageRoot, SkinPackage, SoundPackage,
} from '@shared/models';
import { extractAnalysis } from '@main/archives/extract';
import { BackupService } from '@main/backups/backup-service';
import { validateGameInstallation } from '@main/detection/game-installation';
import {
  copyDirectory, directorySummary, pathExists, readableCopyName, replaceDirectory,
} from '@main/filesystem/file-operations';
import { assertPathInside, filesystemSafeSegment } from '@main/filesystem/path-safety';
import { buildSinglePackageProfile } from '@main/installation/sound-service';
import { StateRepository } from '@main/persistence/state';

interface InstallOptions {
  analyses: ArchiveAnalysis[];
  gameRoot: string;
  collisionPolicy: CollisionPolicy;
  ignoreDuplicateContent: boolean;
  operationId: string;
  signal: AbortSignal;
  progress: (progress: OperationProgress) => void;
}

/** Prefer ZIP metadata; only walk disk after merge (destination content differs from archive). */
function rootStatsFromAnalysis(analysis: ArchiveAnalysis, root: PackageRoot): { fileCount: number; totalSize: number } {
  const prefix = root.sourcePrefix ? `${root.sourcePrefix.replace(/\/$/, '')}/` : '';
  let totalSize = 0;
  let fileCount = 0;
  for (const entry of analysis.entries) {
    if (entry.isDirectory || entry.ignored || entry.unsafeReason) continue;
    if (prefix) {
      if (!entry.normalizedPath.startsWith(prefix)) continue;
    } else if (analysis.roots.length > 1) {
      const match = analysis.roots.find((candidate) => {
        const candidatePrefix = candidate.sourcePrefix ? `${candidate.sourcePrefix.replace(/\/$/, '')}/` : '';
        return candidatePrefix ? entry.normalizedPath.startsWith(candidatePrefix) : true;
      });
      if (match?.destinationName !== root.destinationName) continue;
    }
    fileCount += 1;
    totalSize += entry.uncompressedSize;
  }
  return { fileCount: root.fileCount || fileCount, totalSize };
}

export class InstallService {
  constructor(
    private readonly dataRoot: string,
    private readonly repository: StateRepository,
    private readonly backups: BackupService,
  ) {}

  async run(options: InstallOptions): Promise<InstallResult[]> {
    const installation = await validateGameInstallation(options.gameRoot, 'saved');
    if (!installation.valid) throw new Error('The selected War Thunder directory is no longer valid. Select it again in Settings.');
    const results: InstallResult[] = [];
    let successes = 0;
    let warnings = 0;
    let failures = 0;
    const baseProgress = (analysis: ArchiveAnalysis, index: number, operation: string): OperationProgress => ({
      operationId: options.operationId, archiveId: analysis.id, currentArchive: analysis.originalFilename,
      operation, filesCompleted: 0, bytesProcessed: 0, itemsCompleted: index, totalItems: options.analyses.length,
      successes, warnings, failures,
    });

    for (const [index, analysis] of options.analyses.entries()) {
      if (options.signal.aborted) break;
      const type = analysis.manualType ?? analysis.detected.type;
      if ((type !== 'skin' && type !== 'sound') || analysis.warnings.some((warning) => warning.level === 'error') || analysis.roots.length === 0) {
        const reason = analysis.warnings.find((warning) => warning.level === 'error')?.detail
          ?? (analysis.roots.length === 0 ? 'Tailmark could not identify a safe folder root to install.' : `The detected archive type is ${type}, not a supported user skin or sound package.`);
        results.push({ archiveId: analysis.id, success: false, status: 'failed', destinations: [], filesWritten: 0, bytesWritten: 0, backupIds: [], message: `Archive still needs review. ${reason}` });
        failures += 1;
        continue;
      }
      const duplicateRoots = new Set(analysis.conflicts
        .filter((conflict) => conflict.kind === 'duplicate-content')
        .map((conflict) => conflict.relativePath.toLowerCase()));
      const hasDuplicateWarning = analysis.warnings.some((warning) => warning.code === 'duplicate-skin' || warning.code === 'duplicate-sound');
      const everySkinRootIsDuplicate = type === 'skin' && (duplicateRoots.size > 0
        ? analysis.roots.every((root) => duplicateRoots.has(root.destinationName.toLowerCase()))
        : hasDuplicateWarning);
      if (options.ignoreDuplicateContent && (type === 'sound' && hasDuplicateWarning || everySkinRootIsDuplicate)) {
        const message = `Skipped duplicate content${analysis.duplicateOf ? ` already installed as ${analysis.duplicateOf}` : ''}.`;
        results.push({ archiveId: analysis.id, success: true, status: 'skipped', destinations: [], filesWritten: 0, bytesWritten: 0, backupIds: [], message });
        warnings += 1;
        options.progress({ ...baseProgress(analysis, index + 1, 'Duplicate skipped'), itemsCompleted: index + 1 });
        continue;
      }
      const installAnalysis = options.ignoreDuplicateContent && type === 'skin' && duplicateRoots.size > 0
        ? { ...analysis, roots: analysis.roots.filter((root) => !duplicateRoots.has(root.destinationName.toLowerCase())) }
        : analysis;
      options.progress(baseProgress(analysis, index, type === 'skin' ? 'Staging user skin' : 'Importing sound package'));
      try {
        const result = type === 'skin'
          ? await this.installSkin(installAnalysis, options, index, baseProgress)
          : await this.importSound(installAnalysis, options, index, baseProgress);
        results.push(result);
        if (result.status === 'skipped') warnings += 1; else successes += 1;
      } catch (error) {
        failures += 1;
        const details = error instanceof Error ? error.stack : String(error);
        const systemError = error as NodeJS.ErrnoException;
        const cause = systemError.code === 'EACCES' || systemError.code === 'EPERM'
          ? 'Windows denied access to the destination. Close programs using the skin folder, check folder permissions, and try again.'
          : systemError.code === 'EBUSY'
            ? 'Windows reports that a destination file or folder is in use. Close the program holding it and try again.'
            : systemError.code === 'ENOSPC'
              ? 'The destination drive ran out of free space during installation. Free space and try again.'
              : systemError.code === 'ENOENT'
                ? 'A required archive, staging folder, or destination disappeared during installation. Verify the game path and try again.'
                : error instanceof Error && error.message.trim()
                  ? error.message
                  : 'Tailmark encountered an unexpected internal error before it could finish the filesystem change.';
        const message = `Could not install ${analysis.displayName}. ${cause}`;
        results.push({
          archiveId: analysis.id, success: false, status: 'failed', destinations: [], filesWritten: 0, bytesWritten: 0,
          backupIds: [], message,
          ...(details ? { technicalDetails: details } : {}),
        });
        await this.repository.addActivity({
          action: type === 'skin' ? 'install-skin' : 'import-sound', packageName: analysis.displayName,
          destination: analysis.proposedDestination, result: 'failed', fileCount: 0, details: message,
        }).catch(() => undefined);
      }
      options.progress({ ...baseProgress(analysis, index + 1, 'Item complete'), itemsCompleted: index + 1 });
    }
    await this.backups.enforceRetention((await this.repository.load()).settings.retainBackupCount);
    return results;
  }

  private async installSkin(
    analysis: ArchiveAnalysis,
    options: InstallOptions,
    index: number,
    base: (analysis: ArchiveAnalysis, index: number, operation: string) => OperationProgress,
  ): Promise<InstallResult> {
    const userSkins = assertPathInside(options.gameRoot, join(options.gameRoot, 'UserSkins'));
    await mkdir(userSkins, { recursive: true });
    const operationRoot = join(
      options.gameRoot,
      '.tailmark-staging',
      filesystemSafeSegment(options.operationId),
      filesystemSafeSegment(analysis.id),
    );
    await rm(operationRoot, { recursive: true, force: true });
    const extracted = await extractAnalysis(analysis, operationRoot, options.signal, (partial) => {
      options.progress({ ...base(analysis, index, 'Extracting safely'), ...partial });
    });
    const destinations: string[] = [];
    const backupIds: string[] = [];
    const installed: SkinPackage[] = [];
    try {
      for (const root of analysis.roots) {
        const staged = join(operationRoot, root.destinationName);
        let destinationName = root.destinationName;
        let destination = assertPathInside(userSkins, join(userSkins, destinationName));
        let didMerge = false;
        if (await pathExists(destination)) {
          if (options.collisionPolicy === 'skip') continue;
          if (options.collisionPolicy === 'copy') {
            destinationName = await readableCopyName(userSkins, destinationName);
            destination = assertPathInside(userSkins, join(userSkins, destinationName));
          } else {
            const backup = await this.backups.create(destination, `Before installing ${analysis.displayName}`);
            if (backup) backupIds.push(backup.id);
            if (options.collisionPolicy === 'merge') {
              const merged = join(operationRoot, `${destinationName}.merged`);
              await copyDirectory(destination, merged);
              await copyDirectory(staged, merged, true);
              await rm(staged, { recursive: true, force: true });
              await rename(merged, staged);
              didMerge = true;
            }
          }
        }
        const stats = didMerge ? await directorySummary(staged) : rootStatsFromAnalysis(analysis, root);
        const rollback = join(userSkins, `.tailmark-rollback-${randomUUID()}`);
        await replaceDirectory(staged, destination, rollback);
        destinations.push(destination);
        installed.push({
          id: randomUUID(), name: destinationName, path: destination, sourceArchive: analysis.archivePath,
          installedAt: new Date().toISOString(), fileCount: stats.fileCount, totalSize: stats.totalSize,
          contentHash: root.contentHash ?? analysis.archiveHash, validationStatus: 'valid',
        });
      }
      if (destinations.length === 0) {
        return { archiveId: analysis.id, success: true, status: 'skipped', destinations: [], filesWritten: 0, bytesWritten: 0, backupIds, message: 'Skipped because the destination already exists.' };
      }
      await this.repository.update((state) => {
        for (const skin of installed) {
          state.skins = state.skins.filter((existing) => existing.path.toLowerCase() !== skin.path.toLowerCase());
          state.skins.push(skin);
        }
      });
      await this.repository.addActivity({ action: 'install-skin', packageName: analysis.displayName, destination: destinations.join('; '), result: 'success', fileCount: extracted.files, ...(backupIds[0] ? { backupId: backupIds[0] } : {}), details: `Installed ${analysis.roots.length} skin folder(s) using ${options.collisionPolicy} collision handling.` });
      return { archiveId: analysis.id, success: true, status: 'installed', destinations, filesWritten: extracted.files, bytesWritten: extracted.bytes, backupIds, message: `Installed ${destinations.length} user skin ${destinations.length === 1 ? 'folder' : 'folders'}.` };
    } finally {
      await rm(operationRoot, { recursive: true, force: true });
    }
  }

  private async importSound(
    analysis: ArchiveAnalysis,
    options: InstallOptions,
    index: number,
    base: (analysis: ArchiveAnalysis, index: number, operation: string) => OperationProgress,
  ): Promise<InstallResult> {
    const state = await this.repository.load();
    const duplicate = state.sounds.find((sound) => sound.contentHash === analysis.archiveHash);
    if (duplicate && options.ignoreDuplicateContent) return { archiveId: analysis.id, success: true, status: 'skipped', destinations: [duplicate.libraryPath], filesWritten: 0, bytesWritten: 0, backupIds: [], message: `Already imported as ${duplicate.name}.` };
    const packageId = randomUUID();
    const packageRoot = join(this.dataRoot, 'library', 'sounds', packageId);
    const staging = `${packageRoot}.staging`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      const extracted = await extractAnalysis(analysis, staging, options.signal, (partial) => {
        options.progress({ ...base(analysis, index, 'Copying into sound library'), ...partial });
      });
      const rootName = analysis.roots[0]?.destinationName;
      if (!rootName) throw new Error('Sound package root is missing.');
      const storedPath = join(packageRoot, rootName);
      await mkdir(join(this.dataRoot, 'library', 'sounds'), { recursive: true });
      await rename(staging, packageRoot);
      const note = await this.findReadme(storedPath);
      const soundPackage: SoundPackage = {
        id: packageId, name: analysis.displayName, libraryPath: storedPath, archiveSource: analysis.archivePath,
        importedAt: new Date().toISOString(), fileCount: extracted.files, totalSize: extracted.bytes, active: false,
        validationStatus: analysis.warnings.length ? 'warning' : 'valid', conflicts: [], variants: [],
        ...(note ? { notes: note } : {}), contentHash: analysis.archiveHash,
      };
      await this.repository.update((draft) => {
        draft.sounds.push(soundPackage);
        const profile = buildSinglePackageProfile(soundPackage, draft.profiles);
        if (profile) draft.profiles.push(profile);
      });
      await this.repository.addActivity({ action: 'import-sound', packageName: analysis.displayName, destination: storedPath, result: 'success', fileCount: extracted.files, details: 'Imported to the managed sound library and created a named profile. Game files were not changed.' });
      return {
        archiveId: analysis.id,
        packageId,
        success: true,
        status: 'imported',
        destinations: [storedPath],
        filesWritten: extracted.files,
        bytesWritten: extracted.bytes,
        backupIds: [],
        message: 'Imported into the sound library and prepared for deployment to War Thunder.',
      };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      await rm(packageRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async findReadme(root: string): Promise<string | undefined> {
    for (const name of await readdir(root).catch(() => [])) {
      if (/^(readme|instructions?|install)(\.[^.]+)?$/i.test(name)) {
        const text = await readFile(join(root, name), 'utf8').catch(() => '');
        if (text) return text.slice(0, 8_000);
      }
    }
    return undefined;
  }
}
