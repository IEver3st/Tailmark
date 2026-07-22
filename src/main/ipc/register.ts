import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { AppSettings, AppSnapshot, ArchiveAnalysis, ApiResult, GameInstallation, OperationProgress } from '@shared/models';
import {
  analyzeRequestSchema, idSchema, installRequestSchema, pathSchema, profileSchema, renameSchema,
  adoptSoundSchema, settingsPatchSchema, windowActionSchema,
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

interface Services {
  dataRoot: string;
  repository: StateRepository;
  backups: BackupService;
  installer: InstallService;
  sounds: SoundService;
  getWindow: () => BrowserWindow | null;
}

const operations = new Map<string, AbortController>();

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
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.zip') result.push(path);
    }
  }
  await walk(root);
  return result;
}

async function createSnapshot(services: Services, skinIndex: InstalledSkinIndex): Promise<AppSnapshot> {
  await services.sounds.ensurePackageProfiles();
  const state = await services.repository.load();
  let installation: GameInstallation | null = null;
  if (state.settings.gameRoot) installation = await validateGameInstallation(state.settings.gameRoot, 'saved');
  const skins = await skinIndex.scan(state.settings.gameRoot, state.skins);
  const recordedPaths = new Set(state.skins.map((skin) => skin.path.toLowerCase()));
  const discovered = skins.filter((skin) => !recordedPaths.has(skin.path.toLowerCase()));
  if (discovered.length) await services.repository.update((draft) => { draft.skins.push(...discovered); });
  void skinIndex.warm(skins);

  const externalSound = state.settings.gameRoot
    ? await detectExternalSound(state.settings.gameRoot, state.sounds, state.profiles)
    : null;
  const marker = externalSound && ['managed', 'matched'].includes(externalSound.ownership)
    ? { packageIds: externalSound.packageIds, profileId: externalSound.profileId }
    : null;
  const synced = syncActiveSoundState(state.sounds, state.profiles, marker, externalSound?.enabled ?? false);
  const activeChanged = state.sounds.some((sound, index) => sound.active !== synced.sounds[index]?.active)
    || state.profiles.some((profile, index) => profile.active !== synced.profiles[index]?.active)
    || state.settings.activeSoundPackageId !== synced.activeSoundPackageId
    || state.settings.activeSoundProfileId !== synced.activeSoundProfileId;
  if (activeChanged) {
    await services.repository.update((draft) => {
      draft.sounds = synced.sounds;
      draft.profiles = synced.profiles;
      draft.settings.activeSoundPackageId = synced.activeSoundPackageId;
      draft.settings.activeSoundProfileId = synced.activeSoundProfileId;
    });
  }

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
    backups: state.backups,
    activity: state.activity,
    gameRunning: await isWarThunderRunning().catch(() => true),
    externalSound,
  };
}

function broadcastSnapshot(services: Services, skinIndex: InstalledSkinIndex): void {
  void createSnapshot(services, skinIndex).then((snapshot) => services.getWindow()?.webContents.send('events:snapshot', snapshot));
}

export function registerIpc(services: Services): void {
  const skinIndex = new InstalledSkinIndex(services.repository);
  handle('app:snapshot', () => createSnapshot(services, skinIndex));
  handle('app:open-data', async () => { await shell.openPath(services.dataRoot); return null; });
  handle('app:clear-temp', async () => {
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

      const analyses: ArchiveAnalysis[] = [];
      for (const analysis of inspected) {
        if (request.gameRoot && analysis.detected.type === 'skin') {
          const duplicates = analysis.roots.flatMap((root) => root.contentHash
            ? installedSkins.filter((skin) => skin.contentHash === root.contentHash).map((skin) => ({ root: root.destinationName, skin }))
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
          for (const root of analysis.roots) {
            const destination = join(request.gameRoot, 'UserSkins', root.destinationName);
            if (await pathExists(destination)) analysis.conflicts.push({ relativePath: root.destinationName, kind: 'destination-exists', existingPath: destination });
          }
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
    operations.set(request.operationId, controller);
    try {
      const results = await services.installer.run({
        analyses: request.analyses as ArchiveAnalysis[], gameRoot,
        collisionPolicy: request.collisionPolicy, ignoreDuplicateContent: state.settings.ignoreDuplicateContent,
        operationId: request.operationId, signal: controller.signal,
        progress: (progress: OperationProgress) => services.getWindow()?.webContents.send('events:progress', progress),
      });
      await completeSoundInstallResults(results, gameRoot, (packageId) => services.sounds.activatePackage(packageId));
      if (state.settings.deleteSourceZipAfterInstall) {
        for (const result of results) {
          if (!result.success || result.status !== 'installed') continue;
          const source = request.analyses.find((analysis) => (analysis as ArchiveAnalysis).id === result.archiveId) as ArchiveAnalysis | undefined;
          if ((source?.manualType ?? source?.detected.type) !== 'skin') continue;
          if (!source?.archivePath || !await pathExists(source.archivePath)) continue;
          try {
            await shell.trashItem(source.archivePath);
            result.sourceZipDeleted = true;
          } catch (error) {
            result.cleanupWarning = `The skin was installed, but its source ZIP could not be moved to the Recycle Bin. ${error instanceof Error ? error.message : 'Windows rejected the cleanup request.'}`;
          }
        }
      }
      broadcastSnapshot(services, skinIndex);
      return results;
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
    await services.backups.create(skin.path, `Before removing ${skin.name}`, skin.id);
    await rm(skin.path, { recursive: true, force: true });
    await services.repository.update((draft) => { draft.skins = draft.skins.filter((item) => item.id !== id && item.path.toLowerCase() !== skin.path.toLowerCase()); });
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
    await rename(skin.path, destination);
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
    broadcastSnapshot(services, skinIndex); return state.settings;
  });
  handle('settings:reset', async () => { const state = await services.repository.update((draft) => { draft.settings = structuredClone(DEFAULT_SETTINGS); }); broadcastSnapshot(services, skinIndex); return state.settings; });

  ipcMain.handle('window:control', (_event, raw: unknown) => {
    const action = windowActionSchema.parse(raw); const window = services.getWindow(); if (!window) return;
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else window.close();
  });
}
