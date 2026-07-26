import { randomUUID } from 'node:crypto';
import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
  AppSettings, AppSnapshot, ArchiveAnalysis, ApiResult, DownloadAutomationEvent, GameInstallation, OperationProgress,
} from '@shared/models';
import {
  analyzeRequestSchema, idSchema, installRequestSchema, pathSchema, profileSchema, renameSchema,
  adoptSoundSchema, collectionSchema, pathsSchema, settingsPatchSchema, windowActionSchema,
} from '@shared/schemas';
import { inspectArchive } from '@main/archives/inspect';
import { findContentDuplicate } from '@main/archives/duplicates';
import { BackupService } from '@main/backups/backup-service';
import { ANALYZE_CONCURRENCY, mapWithConcurrency } from '@main/concurrency';
import { detectExternalSound, syncActiveSoundState } from '@main/detection/active-sound';
import { detectGameInstallation, validateGameInstallation } from '@main/detection/game-installation';
import { directorySize, pathExists } from '@main/filesystem/file-operations';
import { assertPathInside } from '@main/filesystem/path-safety';
import { InstallService } from '@main/installation/install-service';
import { completeSoundInstallResults } from '@main/installation/sound-install-completion';
import { SoundService } from '@main/installation/sound-service';
import { InstalledSkinIndex } from '@main/library/installed-skin-index';
import { StateRepository } from '@main/persistence/state';
import { isWarThunderRunning } from '@main/processes/game-process';
import { DEFAULT_SETTINGS } from '@shared/constants';
import { shouldRecycleSourceArchive } from '@shared/archive-actions';
import { DownloadAutomationPausedError, DownloadWatcher } from '@main/management/download-watcher';
import { ManagedContentService } from '@main/management/managed-content-service';
import { OperationJournal } from '@main/management/operation-journal';

interface Services {
  dataRoot: string;
  downloadsRoot: string;
  repository: StateRepository;
  backups: BackupService;
  installer: InstallService;
  sounds: SoundService;
  managed: ManagedContentService;
  journal: OperationJournal;
  getWindow: () => BrowserWindow | null;
  onSettingsChanged?(settings: AppSettings): void;
  onDownloadAutomationStateChanged?(state: AppSnapshot['downloadAutomation']): void;
  onDownloadAutomationEvent?(event: DownloadAutomationEvent): void;
}

const operations = new Map<string, AbortController>();
let downloadWatcher: DownloadWatcher | null = null;

function success<T>(data: T): ApiResult<T> { return { ok: true, data }; }
function failure(error: unknown): ApiResult<never> {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return { ok: false, error: { code: (error as NodeJS.ErrnoException).code ?? 'INTERNAL_ERROR', message, ...(error instanceof Error && error.stack ? { details: error.stack } : {}) } };
}

function handle<TArgs extends unknown[], TResult>(channel: string, callback: (...args: TArgs) => Promise<TResult>): void {
  ipcMain.handle(channel, async (_event, ...args: TArgs): Promise<ApiResult<TResult>> => {
    try { return success(await callback(...args)); } catch (error) { return failure(error); }
  });
}

async function discoverZips(root: string): Promise<string[]> {
  async function walk(current: string): Promise<string[]> {
    const nested = await Promise.all((await readdir(current, { withFileTypes: true })).map(async (entry): Promise<string[]> => {
      if (entry.isSymbolicLink()) return [];
      const path = join(current, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.zip') return [path];
      return [];
    }));
    return nested.flat();
  }
  return walk(root);
}

async function createBootstrapSnapshot(services: Services): Promise<AppSnapshot> {
  const state = await services.repository.load();
  const [installation, recovery] = await Promise.all([
    state.settings.gameRoot
      ? validateGameInstallation(state.settings.gameRoot, 'saved')
      : Promise.resolve(null),
    services.journal.load(),
  ]);
  const downloadAutomation = downloadWatcher?.snapshot() ?? {
    enabled: state.settings.autoInstallDownloads,
    folder: state.settings.downloadsFolder ?? services.downloadsRoot,
    status: 'off' as const,
    lastScanAt: null,
    lastEvent: null,
    error: null,
  };
  if (state.safeMode.active && downloadAutomation.enabled) downloadAutomation.status = 'paused-safe-mode';
  else if (recovery && downloadAutomation.enabled) downloadAutomation.status = 'paused-recovery';
  return {
    settings: state.settings,
    installation,
    skins: state.skins,
    sounds: state.sounds,
    profiles: state.profiles,
    collections: state.collections,
    sights: state.sights,
    hangars: state.hangars,
    safeMode: state.safeMode,
    recovery,
    downloadAutomation,
    backups: state.backups,
    activity: state.activity,
    // Keep disk-changing actions disabled until the background process check completes.
    gameRunning: true,
    externalSound: null,
  };
}

async function createSnapshot(services: Services, skinIndex: InstalledSkinIndex): Promise<AppSnapshot> {
  await services.sounds.ensurePackageProfiles();
  const state = await services.repository.load();
  const [installation, skins, externalSound, recovery, gameRunning] = await Promise.all([
    state.settings.gameRoot
      ? validateGameInstallation(state.settings.gameRoot, 'saved')
      : Promise.resolve(null),
    skinIndex.scan(state.settings.gameRoot, state.skins),
    state.settings.gameRoot
      ? detectExternalSound(state.settings.gameRoot, state.sounds, state.profiles)
      : Promise.resolve(null),
    services.journal.load(),
    isWarThunderRunning().catch(() => true),
  ]);
  const recordedPaths = new Set(state.skins.map((skin) => skin.path.toLowerCase()));
  const discovered = skins.filter((skin) => !recordedPaths.has(skin.path.toLowerCase()));
  void skinIndex.warm(skins);

  const marker = externalSound && ['managed', 'matched'].includes(externalSound.ownership)
    ? { packageIds: externalSound.packageIds, profileId: externalSound.profileId }
    : null;
  const synced = syncActiveSoundState(state.sounds, state.profiles, marker, externalSound?.enabled ?? false);
  const activeChanged = state.sounds.some((sound, index) => sound.active !== synced.sounds[index]?.active)
    || state.profiles.some((profile, index) => profile.active !== synced.profiles[index]?.active)
    || state.settings.activeSoundPackageId !== synced.activeSoundPackageId
    || state.settings.activeSoundProfileId !== synced.activeSoundProfileId;
  if (discovered.length || activeChanged) {
    await services.repository.update((draft) => {
      if (discovered.length) draft.skins.push(...discovered);
      if (activeChanged) {
        draft.sounds = synced.sounds;
        draft.profiles = synced.profiles;
        draft.settings.activeSoundPackageId = synced.activeSoundPackageId;
        draft.settings.activeSoundProfileId = synced.activeSoundProfileId;
      }
    });
  }

  const downloadAutomation = downloadWatcher?.snapshot() ?? {
    enabled: state.settings.autoInstallDownloads,
    folder: state.settings.downloadsFolder ?? services.downloadsRoot,
    status: 'off' as const,
    lastScanAt: null,
    lastEvent: null,
    error: null,
  };
  if (state.safeMode.active && downloadAutomation.enabled) downloadAutomation.status = 'paused-safe-mode';
  else if (recovery && downloadAutomation.enabled) downloadAutomation.status = 'paused-recovery';
  return {
    settings: {
      ...state.settings,
      ...(activeChanged ? {
        activeSoundPackageId: synced.activeSoundPackageId,
        activeSoundProfileId: synced.activeSoundProfileId,
      } : {}),
    },
    installation,
    skins,
    sounds: activeChanged ? synced.sounds : state.sounds,
    profiles: activeChanged ? synced.profiles : state.profiles,
    collections: state.collections,
    sights: state.sights,
    hangars: state.hangars,
    safeMode: state.safeMode,
    recovery,
    downloadAutomation,
    backups: state.backups,
    activity: state.activity,
    gameRunning,
    externalSound,
  };
}

const snapshotRequests = new WeakMap<Services, Promise<AppSnapshot>>();

function requestSnapshot(services: Services, skinIndex: InstalledSkinIndex): Promise<AppSnapshot> {
  const pending = snapshotRequests.get(services);
  if (pending) return pending;
  const request = createSnapshot(services, skinIndex).finally(() => {
    if (snapshotRequests.get(services) === request) snapshotRequests.delete(services);
  });
  snapshotRequests.set(services, request);
  return request;
}

function broadcastSnapshot(services: Services, skinIndex: InstalledSkinIndex): void {
  void requestSnapshot(services, skinIndex).then((snapshot) => services.getWindow()?.webContents.send('events:snapshot', snapshot));
}

export function registerIpc(services: Services): void {
  const skinIndex = new InstalledSkinIndex(services.repository);
  let automaticCommitTail: Promise<void> = Promise.resolve();
  const enqueueAutomaticCommit = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = automaticCommitTail.then(operation, operation);
    automaticCommitTail = result.then(() => undefined, () => undefined);
    return result;
  };
  const processDownloadedArchive = async (path: string): Promise<DownloadAutomationEvent> => {
    const state = await services.repository.load();
    const gameRoot = state.settings.gameRoot;
    if (!gameRoot) throw new Error('Automatic installation is waiting for a verified War Thunder installation.');
    const analysis = await inspectArchive(path, gameRoot, new AbortController().signal, () => undefined);
    const review = (detail: string): DownloadAutomationEvent => ({
      id: randomUUID(),
      archivePath: path,
      filename: analysis.originalFilename,
      createdAt: new Date().toISOString(),
      result: 'review',
      detail,
      analysis,
    });
    if (
      analysis.detected.type !== 'skin'
      || analysis.detected.confidence < 85
      || analysis.detected.needsReview
      || analysis.roots.length === 0
      || analysis.warnings.some((warning) => warning.level === 'error')
    ) {
      return review('The download was added to Installer because it was not a high-confidence, skin-only archive.');
    }

    return enqueueAutomaticCommit(async () => {
      const latestState = await services.repository.load();
      if (latestState.safeMode.active) throw new DownloadAutomationPausedError('safe-mode');
      if (await services.journal.load()) throw new DownloadAutomationPausedError('recovery');
      const latestGameRoot = latestState.settings.gameRoot;
      if (!latestGameRoot) throw new Error('Automatic installation is waiting for a verified War Thunder installation.');

      analysis.conflicts = [];
      analysis.warnings = analysis.warnings.filter((warning) => warning.code !== 'duplicate-skin');
      delete analysis.duplicateOf;
      analysis.status = 'ready';

      let installedSkins = await skinIndex.scan(latestGameRoot, latestState.skins);
      const warming = skinIndex.warm(installedSkins);
      await Promise.race([warming, new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25))]);
      installedSkins = await skinIndex.scan(latestGameRoot, installedSkins);
      const installedByHash = new Map<string, typeof installedSkins>();
      for (const skin of installedSkins) {
        if (!skin.contentHash) continue;
        const matches = installedByHash.get(skin.contentHash) ?? [];
        matches.push(skin);
        installedByHash.set(skin.contentHash, matches);
      }
      const duplicateRoots = new Set<string>();
      const duplicateNames = new Set<string>();
      for (const root of analysis.roots) {
        if (!root.contentHash) continue;
        for (const skin of installedByHash.get(root.contentHash) ?? []) {
          duplicateRoots.add(root.destinationName.toLowerCase());
          duplicateNames.add(skin.name);
          analysis.conflicts.push({
            relativePath: root.destinationName,
            kind: 'duplicate-content',
            packages: [skin.name],
          });
        }
      }
      const fullyDuplicate = duplicateRoots.size > 0
        && analysis.roots.every((root) => duplicateRoots.has(root.destinationName.toLowerCase()));
      if (fullyDuplicate) {
        const duplicateOf = [...duplicateNames].join(', ').slice(0, 260);
        analysis.duplicateOf = duplicateOf;
        analysis.warnings.push({
          code: 'duplicate-skin',
          level: 'warning',
          title: 'Duplicate skin already installed',
          detail: `This archive matches ${duplicateOf || 'an installed skin'} and will be recycled.`,
        });
        analysis.status = 'skipped';
      } else {
        const existing = await Promise.all(analysis.roots.map(async (root) => {
          const destination = join(latestGameRoot, 'UserSkins', root.destinationName);
          return {
            root,
            destination,
            exists: await pathExists(destination),
          };
        }));
        for (const item of existing) {
          if (!item.exists || duplicateRoots.has(item.root.destinationName.toLowerCase())) continue;
          analysis.conflicts.push({
            relativePath: item.root.destinationName,
            kind: 'destination-exists',
            existingPath: item.destination,
          });
        }
        if (analysis.conflicts.some((conflict) => conflict.kind === 'destination-exists')) {
          analysis.status = 'conflict';
          return review('The download has a destination conflict and needs review before Tailmark writes it.');
        }
      }

      const destinations = analysis.roots.map((root) => join(latestGameRoot, 'UserSkins', root.destinationName));
      await services.journal.begin({
        kind: 'downloads-install',
        label: `automatically install ${analysis.displayName}`,
        destinations,
      });
      try {
        const results = await services.installer.run({
          analyses: [analysis],
          gameRoot: latestGameRoot,
          collisionPolicy: 'skip',
          ignoreDuplicateContent: true,
          operationId: `downloads-${randomUUID()}`,
          signal: new AbortController().signal,
          progress: (progress) => services.getWindow()?.webContents.send('events:progress', progress),
        });
        const result = results[0];
        if (!result?.success) {
          await services.journal.complete();
          await downloadWatcher?.resumePending();
          return {
            id: randomUUID(), archivePath: path, filename: analysis.originalFilename,
            createdAt: new Date().toISOString(), result: 'failed',
            detail: result?.message ?? 'Automatic skin installation did not return a result.',
          };
        }
        const recycle = fullyDuplicate || latestState.settings.deleteSourceZipAfterInstall;
        if (recycle && await pathExists(path)) {
          try {
            await shell.trashItem(path);
            result.sourceZipDeleted = true;
          } catch (error) {
            result.cleanupWarning = error instanceof Error ? error.message : 'Windows rejected the Recycle Bin request.';
          }
        }
        await services.journal.complete();
        await downloadWatcher?.resumePending();
        broadcastSnapshot(services, skinIndex);
        return {
          id: randomUUID(),
          archivePath: path,
          filename: analysis.originalFilename,
          createdAt: new Date().toISOString(),
          result: fullyDuplicate
            ? result.sourceZipDeleted ? 'duplicate-recycled' : 'failed'
            : 'installed',
          detail: result.cleanupWarning
            ? `${result.message} Source cleanup failed: ${result.cleanupWarning}`
            : fullyDuplicate
              ? 'The duplicate ZIP was moved to the Recycle Bin.'
              : `${result.message}${result.sourceZipDeleted ? ' The source ZIP was moved to the Recycle Bin.' : ''}`,
        };
      } catch (error) {
        await services.journal.fail(error);
        throw error;
      }
    });
  };
  downloadWatcher = new DownloadWatcher({
    defaultFolder: services.downloadsRoot,
    maxConcurrent: ANALYZE_CONCURRENCY,
    processArchive: processDownloadedArchive,
    onEvent: (event) => {
      services.getWindow()?.webContents.send('events:download-automation', event);
      services.onDownloadAutomationEvent?.(event);
    },
    onStateChange: (state) => services.onDownloadAutomationStateChanged?.(state),
    canProcess: async () => {
      const state = await services.repository.load();
      if (state.safeMode.active) return 'safe-mode';
      if (await services.journal.load()) return 'recovery';
      return 'ready';
    },
  });
  handle('app:bootstrap', () => createBootstrapSnapshot(services));
  handle('app:snapshot', () => requestSnapshot(services, skinIndex));
  handle('app:open-data', async () => { await shell.openPath(services.dataRoot); return null; });
  handle('app:clear-temp', async () => {
    if (await services.journal.load()) throw new Error('Resolve the interrupted operation before clearing temporary files.');
    const temp = join(services.dataRoot, 'temp');
    let bytes = 0;
    if (await pathExists(temp)) bytes = await directorySize(temp);
    await rm(temp, { recursive: true, force: true });
    const gameRoot = (await services.repository.load()).settings.gameRoot;
    if (gameRoot) {
      await Promise.all([
        rm(join(gameRoot, '.tailmark-staging'), { recursive: true, force: true }),
        rm(join(gameRoot, '.thundermod-staging'), { recursive: true, force: true }),
      ]);
    }
    return bytes;
  });

  handle('dialogs:archives', async () => {
    const window = services.getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined as never, { title: 'Select Mod Archives', properties: ['openFile', 'multiSelections'], filters: [{ name: 'ZIP archives', extensions: ['zip'] }] });
    return result.canceled ? [] : result.filePaths;
  });
  handle('dialogs:folder', async () => {
    const window = services.getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined as never, { title: 'Select Folder Containing ZIP Archives', properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? [] : discoverZips(result.filePaths[0]);
  });
  handle('dialogs:game-root', async () => {
    const window = services.getWindow();
    const result = await dialog.showOpenDialog(window ?? undefined as never, { title: 'Select War Thunder Installation', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const installation = await validateGameInstallation(result.filePaths[0], 'manual');
    if (!installation.valid) throw new Error('That folder does not look like a War Thunder installation. Select the directory containing config.blk and aces.exe.');
    await services.repository.update((state) => { state.settings.gameRoot = installation.root; });
    broadcastSnapshot(services, skinIndex);
    return installation;
  });
  handle('dialogs:downloads-folder', async () => {
    const result = await dialog.showOpenDialog(services.getWindow() ?? undefined as never, {
      title: 'Choose Downloads Watch Folder',
      defaultPath: (await services.repository.load()).settings.downloadsFolder ?? services.downloadsRoot,
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle('dialogs:export-activity', async (defaultName: unknown, content: unknown) => {
    if (typeof defaultName !== 'string' || defaultName.length > 180 || typeof content !== 'string' || content.length > 10_000_000) throw new Error('Invalid export data.');
    const result = await dialog.showSaveDialog(services.getWindow() ?? undefined as never, { title: 'Export Activity Log', defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'Text', extensions: ['txt'] }] });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, 'utf8');
    return result.filePath;
  });
  handle('files:open-path', async (raw: unknown) => {
    const path = pathSchema.parse(raw);
    const state = await services.repository.load();
    const allowedRoots = [services.dataRoot, state.settings.gameRoot].filter((item): item is string => Boolean(item)).map((item) => resolve(item));
    if (!allowedRoots.some((root) => { try { assertPathInside(root, path); return true; } catch { return false; } })) throw new Error('The requested path is outside the managed application and game directories.');
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
    return null;
  });

  handle('archives:analyze', async (raw: unknown) => {
    const request = analyzeRequestSchema.parse(raw);
    const controller = new AbortController();
    operations.set(request.operationId, controller);
    try {
      const state = await services.repository.load();
      const { ignoreDuplicateContent } = state.settings;
      const paths = [...new Set(request.paths)];
      let itemsCompleted = 0;
      let successes = 0;

      const sendProgress = (path: string, operation: string, filesCompleted = 0, totalFiles?: number): void => {
        services.getWindow()?.webContents.send('events:progress', {
          operationId: request.operationId,
          currentArchive: path.split(/[\\/]/).at(-1) ?? path,
          operation,
          filesCompleted,
          ...(totalFiles === undefined ? {} : { totalFiles }),
          bytesProcessed: 0,
          itemsCompleted,
          totalItems: paths.length,
          successes,
          warnings: 0,
          failures: 0,
        } satisfies OperationProgress);
      };

      // One shallow index + short warm wait for the whole batch (not per archive).
      let installedSkins = request.gameRoot ? await skinIndex.scan(request.gameRoot, state.skins) : [];
      if (request.gameRoot) {
        const warming = skinIndex.warm(installedSkins);
        await Promise.race([warming, new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25))]);
        installedSkins = await skinIndex.scan(request.gameRoot, installedSkins);
      }

      const inspected = await mapWithConcurrency(paths, ANALYZE_CONCURRENCY, async (path) => {
        if (controller.signal.aborted) throw new Error('Operation cancelled.');
        sendProgress(path, 'Opening ZIP');
        try {
          const analysis = await inspectArchive(path, request.gameRoot, controller.signal, ({ entriesRead, totalEntries }) => {
            sendProgress(path, 'Reading ZIP directory', entriesRead, totalEntries);
          });
          itemsCompleted += 1;
          successes += 1;
          sendProgress(path, 'Analysis complete', analysis.fileCount, analysis.fileCount);
          return analysis;
        } catch (error) {
          itemsCompleted += 1;
          const message = error instanceof Error ? error.message : 'Analysis failed.';
          const filename = path.split(/[\\/]/).at(-1) ?? path;
          sendProgress(path, 'Analysis failed');
          return {
            id: `failed:${path}`,
            archivePath: path,
            displayName: filename.replace(/\.zip$/i, ''),
            originalFilename: filename,
            archiveHash: '',
            fileCount: 0,
            uncompressedSize: 0,
            compressedSize: 0,
            entries: [],
            detected: { type: 'unsupported' as const, confidence: 0, reasons: [], needsReview: true },
            roots: [],
            transformations: [],
            proposedDestination: 'Unavailable',
            warnings: [{ code: 'analysis-failed', level: 'error' as const, title: 'Archive could not be analysed', detail: message }],
            conflicts: [],
            status: 'failed' as const,
            failure: { stage: 'analysis' as const, message, ...(error instanceof Error && error.stack ? { technicalDetails: error.stack } : {}) },
          } satisfies ArchiveAnalysis;
        }
      });

      const installedSkinsByHash = new Map<string, typeof installedSkins>();
      for (const skin of installedSkins) {
        if (!skin.contentHash) continue;
        const matches = installedSkinsByHash.get(skin.contentHash) ?? [];
        matches.push(skin);
        installedSkinsByHash.set(skin.contentHash, matches);
      }
      const analyses: ArchiveAnalysis[] = [];
      for (const analysis of inspected) {
        if (request.gameRoot && analysis.detected.type === 'skin') {
          const gameRoot = request.gameRoot;
          const duplicates = analysis.roots.flatMap((root) => root.contentHash
            ? (installedSkinsByHash.get(root.contentHash) ?? []).map((skin) => ({ root: root.destinationName, skin }))
            : []);
          if (duplicates.length) {
            const names = [...new Set(duplicates.map(({ skin }) => skin.name))];
            const firstName = names[0] ?? 'an installed skin';
            analysis.duplicateOf = names.length > 1 ? `${firstName.slice(0, 180)} and ${names.length - 1} more` : firstName.slice(0, 260);
            analysis.warnings.push({
              code: 'duplicate-skin', level: 'warning', title: 'Duplicate skin already installed',
              detail: duplicates.length === 1
                ? `The files in ${duplicates[0]?.root ?? analysis.displayName} match the installed skin ${firstName}.${ignoreDuplicateContent ? ' This folder will be skipped.' : ' Review the duplicate before continuing.'}`
                : `${duplicates.length} skin folders match content already installed as ${names.join(', ')}.${ignoreDuplicateContent ? ' Duplicate folders will be skipped.' : ' Review the duplicates before continuing.'}`,
            });
            const packagesByRoot = new Map<string, Set<string>>();
            for (const { root, skin } of duplicates) {
              const packages = packagesByRoot.get(root) ?? new Set<string>();
              packages.add(skin.name);
              packagesByRoot.set(root, packages);
            }
            for (const [rootName, packages] of packagesByRoot) {
              analysis.conflicts.push({ relativePath: rootName, kind: 'duplicate-content', packages: [...packages] });
            }
            const everyRootIsDuplicate = analysis.roots.every((root) => analysis.conflicts.some((conflict) => conflict.kind === 'duplicate-content' && conflict.relativePath === root.destinationName));
            if (analysis.status === 'ready') analysis.status = ignoreDuplicateContent && everyRootIsDuplicate ? 'skipped' : 'duplicate';
          }
          await Promise.all(analysis.roots.map(async (root) => {
            const destination = join(gameRoot, 'UserSkins', root.destinationName);
            if (await pathExists(destination)) analysis.conflicts.push({ relativePath: root.destinationName, kind: 'destination-exists', existingPath: destination });
          }));
          if (analysis.conflicts.length && analysis.status === 'ready') analysis.status = 'conflict';
        } else if (analysis.detected.type === 'sound') {
          const existingHash = findContentDuplicate(analysis.archiveHash, [...state.sounds, ...analyses]);
          if (existingHash) {
            analysis.duplicateOf = existingHash;
            analysis.warnings.push({ code: 'duplicate-sound', level: 'warning', title: 'Sound package already imported', detail: `This archive matches ${existingHash} in the sound library${ignoreDuplicateContent ? ' and will be skipped.' : '.'}` });
            if (analysis.status === 'ready') analysis.status = ignoreDuplicateContent ? 'skipped' : 'duplicate';
          }
        }
        analyses.push(analysis);
      }
      return analyses;
    } finally { operations.delete(request.operationId); }
  });
  handle('archives:cancel', async (raw: unknown) => { const operationId = idSchema.parse(raw); operations.get(operationId)?.abort(); return null; });

  handle('install:run', async (raw: unknown) => {
    const request = installRequestSchema.parse(raw);
    const state = await services.repository.load();
    const gameRoot = state.settings.gameRoot;
    if (!gameRoot) throw new Error('Select a verified War Thunder installation before installing.');
    const controller = new AbortController();
    const analyses = request.analyses as ArchiveAnalysis[];
    const destinations = analyses.flatMap((analysis) => {
      const type = analysis.manualType ?? analysis.detected.type;
      return type === 'skin'
        ? analysis.roots.map((root) => join(gameRoot, 'UserSkins', root.destinationName))
        : type === 'sound'
          ? [join(gameRoot, 'sound', 'mod')]
          : [];
    });
    await services.journal.begin({
      kind: 'archive-install',
      label: `install ${analyses.length} archive${analyses.length === 1 ? '' : 's'}`,
      destinations,
    });
    operations.set(request.operationId, controller);
    try {
      const results = await services.installer.run({
        analyses, gameRoot,
        collisionPolicy: request.collisionPolicy, ignoreDuplicateContent: state.settings.ignoreDuplicateContent,
        operationId: request.operationId, signal: controller.signal,
        progress: (progress: OperationProgress) => services.getWindow()?.webContents.send('events:progress', progress),
      });
      await completeSoundInstallResults(results, gameRoot, (packageId) => services.sounds.activatePackage(packageId));
      const sources = new Map(request.analyses.map((analysis) => {
        const source = analysis as ArchiveAnalysis;
        return [source.id, source] as const;
      }));
      await Promise.all(results.map(async (result) => {
        const source = sources.get(result.archiveId);
        if (!source || !shouldRecycleSourceArchive(result, source, state.settings.deleteSourceZipAfterInstall)) return;
        if (!source.archivePath) return;
        if (!await pathExists(source.archivePath)) {
          result.sourceZipDeleted = true;
          return;
        }
        try {
          await shell.trashItem(source.archivePath);
          result.sourceZipDeleted = true;
        } catch (error) {
          const action = result.status === 'skipped' ? 'The duplicate was skipped' : 'The skin was installed';
          result.cleanupWarning = `${action}, but its source ZIP could not be moved to the Recycle Bin. ${error instanceof Error ? error.message : 'Windows rejected the cleanup request.'}`;
        }
      }));
      await services.journal.complete();
      await downloadWatcher?.resumePending();
      broadcastSnapshot(services, skinIndex);
      return results;
    } catch (error) {
      await services.journal.fail(error);
      throw error;
    } finally { operations.delete(request.operationId); }
  });

  handle('library:refresh', async () => {
    const snapshot = await createSnapshot(services, skinIndex);
    return { skins: snapshot.skins, sounds: snapshot.sounds, profiles: snapshot.profiles, backups: snapshot.backups, activity: snapshot.activity };
  });
  handle('library:remove-skin', async (raw: unknown) => {
    const id = idSchema.parse(raw); const state = await services.repository.load();
    const skin = (await skinIndex.scan(state.settings.gameRoot, state.skins)).find((item) => item.id === id);
    if (!skin) throw new Error('User skin was not found.');
    const backupSource = await pathExists(skin.path) ? skin.path : skin.libraryPath;
    if (backupSource) await services.backups.create(backupSource, `Before removing ${skin.name}`, skin.id);
    await rm(skin.path, { recursive: true, force: true });
    if (skin.libraryPath) await rm(dirname(skin.libraryPath), { recursive: true, force: true });
    await services.repository.update((draft) => {
      draft.skins = draft.skins.filter((item) => item.id !== id && item.path.toLowerCase() !== skin.path.toLowerCase());
      draft.collections = draft.collections.map((collection) => ({
        ...collection,
        skinIds: collection.skinIds.filter((skinId) => skinId !== id),
        updatedAt: new Date().toISOString(),
      }));
    });
    await services.repository.addActivity({ action: 'remove', packageName: skin.name, destination: skin.path, result: 'success', fileCount: skin.fileCount, details: 'Removed user skin after creating a restorable backup.' });
    broadcastSnapshot(services, skinIndex); return null;
  });
  handle('library:remove-sound', async (raw: unknown) => {
    const id = idSchema.parse(raw); const state = await services.repository.load(); const sound = state.sounds.find((item) => item.id === id);
    if (!sound) throw new Error('Sound package was not found.');
    if (sound.active) throw new Error('Deactivate this sound package before removing it.');
    await services.backups.create(sound.libraryPath, `Before removing ${sound.name}`, sound.id);
    await rm(dirname(sound.libraryPath), { recursive: true, force: true });
    await services.repository.update((draft) => { draft.sounds = draft.sounds.filter((item) => item.id !== id); draft.profiles = draft.profiles.filter((profile) => !profile.packageIds.includes(id)); });
    broadcastSnapshot(services, skinIndex); return null;
  });
  handle('library:rename-skin', async (rawId: unknown, rawName: unknown) => {
    const { id, name } = renameSchema.parse({ id: rawId, name: rawName }); const state = await services.repository.load();
    const skin = (await skinIndex.scan(state.settings.gameRoot, state.skins)).find((item) => item.id === id);
    if (!skin) throw new Error('User skin was not found.');
    const destination = join(dirname(skin.path), name);
    if (await pathExists(destination)) throw new Error('A skin folder with that name already exists.');
    if (skin.active !== false && await pathExists(skin.path)) await rename(skin.path, destination);
    const updated = { ...skin, name, path: destination };
    await services.repository.update((draft) => { draft.skins = draft.skins.map((item) => item.id === id ? updated : item); });
    broadcastSnapshot(services, skinIndex); return updated;
  });
  handle('library:activate-sound', async (raw: unknown) => { await services.sounds.activatePackage(idSchema.parse(raw)); broadcastSnapshot(services, skinIndex); return null; });
  handle('library:deactivate-sound', async () => { await services.sounds.deactivate(); broadcastSnapshot(services, skinIndex); return null; });
  handle('library:create-profile', async (rawName: unknown, rawIds: unknown) => { const value = profileSchema.parse({ name: rawName, packageIds: rawIds }); const profile = await services.sounds.createProfile(value.name, value.packageIds); broadcastSnapshot(services, skinIndex); return profile; });
  handle('library:adopt-sound', async (raw: unknown) => { const { name } = adoptSoundSchema.parse(typeof raw === 'string' ? { name: raw } : raw); const profile = await services.sounds.adoptExternal(name); broadcastSnapshot(services, skinIndex); return profile; });
  handle('library:reconnect-sound', async () => { const profile = await services.sounds.reconnectExternal(); broadcastSnapshot(services, skinIndex); return profile; });
  handle('library:activate-profile', async (raw: unknown) => { await services.sounds.activateProfile(idSchema.parse(raw)); broadcastSnapshot(services, skinIndex); return null; });
  handle('library:rename-profile', async (rawId: unknown, rawName: unknown) => { const value = renameSchema.parse({ id: rawId, name: rawName }); const profile = await services.sounds.renameProfile(value.id, value.name); broadcastSnapshot(services, skinIndex); return profile; });
  handle('library:remove-profile', async (raw: unknown) => { await services.sounds.removeProfile(idSchema.parse(raw)); broadcastSnapshot(services, skinIndex); return null; });
  handle('library:restore-backup', async (raw: unknown) => { const id = idSchema.parse(raw); const record = (await services.repository.load()).backups.find((item) => item.id === id); if (!record) throw new Error('Backup was not found.'); await services.backups.restore(record); broadcastSnapshot(services, skinIndex); return null; });
  handle('library:create-collection', async (raw: unknown) => {
    const { name } = renameSchema.pick({ name: true }).parse({ name: raw });
    const collection = await services.managed.createCollection(name);
    broadcastSnapshot(services, skinIndex);
    return collection;
  });
  handle('library:set-collection-members', async (rawId: unknown, rawIds: unknown) => {
    const value = collectionSchema.parse({ id: rawId, skinIds: rawIds });
    const collection = await services.managed.setCollectionMembers(value.id, value.skinIds);
    broadcastSnapshot(services, skinIndex);
    return collection;
  });
  handle('library:activate-collection', async (raw: unknown) => {
    await services.managed.activateCollection(idSchema.parse(raw));
    await downloadWatcher?.resumePending();
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('library:remove-collection', async (raw: unknown) => {
    await services.managed.removeCollection(idSchema.parse(raw));
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('library:import-sights', async (raw: unknown) => {
    const sights = await services.managed.importSights(pathsSchema.parse(raw));
    broadcastSnapshot(services, skinIndex);
    return sights;
  });
  handle('library:activate-sight', async (raw: unknown) => {
    await services.managed.activateSight(idSchema.parse(raw));
    await downloadWatcher?.resumePending();
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('library:deactivate-sight', async (raw: unknown) => {
    await services.managed.deactivateSight(idSchema.parse(raw));
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('library:remove-sight', async (raw: unknown) => {
    await services.managed.removeSight(idSchema.parse(raw));
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('library:import-hangars', async (raw: unknown) => {
    const hangars = await services.managed.importHangars(pathsSchema.parse(raw));
    broadcastSnapshot(services, skinIndex);
    return hangars;
  });
  handle('library:activate-hangar', async (raw: unknown) => {
    await services.managed.activateHangar(idSchema.parse(raw));
    await downloadWatcher?.resumePending();
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('library:deactivate-hangar', async () => {
    await services.managed.deactivateHangar();
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('library:remove-hangar', async (raw: unknown) => {
    await services.managed.removeHangar(idSchema.parse(raw));
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('safe-mode:enter', async () => {
    const safeMode = await services.managed.enterSafeMode();
    broadcastSnapshot(services, skinIndex);
    return safeMode;
  });
  handle('safe-mode:restore', async () => {
    const safeMode = await services.managed.restoreSafeMode();
    await downloadWatcher?.resumePending();
    broadcastSnapshot(services, skinIndex);
    return safeMode;
  });
  handle('recovery:resume', async () => {
    await services.managed.resumeRecovery();
    await downloadWatcher?.resumePending();
    broadcastSnapshot(services, skinIndex);
    return null;
  });
  handle('recovery:rollback', async () => {
    await services.managed.rollbackRecovery();
    await downloadWatcher?.resumePending();
    broadcastSnapshot(services, skinIndex);
    return null;
  });

  handle('game:detect', async () => {
    const state = await services.repository.load(); const installation = await detectGameInstallation(state.settings.gameRoot);
    if (installation) await services.repository.update((draft) => { draft.settings.gameRoot = installation.root; });
    broadcastSnapshot(services, skinIndex); return installation;
  });
  handle('game:validate', async (raw: unknown) => validateGameInstallation(pathSchema.parse(raw), 'manual'));
  handle('game:running', () => isWarThunderRunning());
  handle('settings:update', async (raw: unknown) => {
    const patch = settingsPatchSchema.parse(raw);
    if (patch.gameRoot) { const installation = await validateGameInstallation(patch.gameRoot, 'manual'); if (!installation.valid) throw new Error('The selected War Thunder directory is not valid.'); }
    const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<AppSettings>;
    const state = await services.repository.update((draft) => { draft.settings = { ...draft.settings, ...cleanPatch, version: 1 }; });
    services.onSettingsChanged?.(state.settings);
    if (patch.autoInstallDownloads !== undefined || patch.downloadsFolder !== undefined) {
      await downloadWatcher?.configure(state.settings.autoInstallDownloads, state.settings.downloadsFolder);
    }
    broadcastSnapshot(services, skinIndex); return state.settings;
  });
  handle('settings:reset', async () => {
    const state = await services.repository.update((draft) => { draft.settings = structuredClone(DEFAULT_SETTINGS); });
    services.onSettingsChanged?.(state.settings);
    await downloadWatcher?.configure(state.settings.autoInstallDownloads, state.settings.downloadsFolder);
    broadcastSnapshot(services, skinIndex);
    return state.settings;
  });

  ipcMain.handle('window:control', (_event, raw: unknown) => {
    const action = windowActionSchema.parse(raw); const window = services.getWindow(); if (!window) return;
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else window.close();
  });
  void services.managed.ensureSkinLibrary().then(() => broadcastSnapshot(services, skinIndex)).catch(() => undefined);
  void services.repository.load().then((state) => downloadWatcher?.configure(
    state.settings.autoInstallDownloads,
    state.settings.downloadsFolder,
  ));
}
