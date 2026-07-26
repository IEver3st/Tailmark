import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { inspectArchive } from '@main/archives/inspect';
import { fingerprintDirectory } from '@main/archives/content-fingerprint';
import { extractAnalysis } from '@main/archives/extract';
import { BackupService } from '@main/backups/backup-service';
import { readHangarConfig, updateHangarConfigFile } from '@main/config-blk/editor';
import { copyDirectory, directorySummary, pathExists, replaceDirectory } from '@main/filesystem/file-operations';
import { assertPathInside, filesystemSafeSegment } from '@main/filesystem/path-safety';
import { SoundService } from '@main/installation/sound-service';
import { StateRepository } from '@main/persistence/state';
import { isWarThunderRunning } from '@main/processes/game-process';
import type {
  ArchiveAnalysis, ManagedHangar, ManagedSight, RecoveryRecord, SafeModeState, SkinCollection, SkinPackage,
} from '@shared/models';
import { OperationJournal } from './operation-journal';

const EMPTY_SAFE_MODE: SafeModeState = {
  active: false,
  activatedAt: null,
  previousCollectionId: null,
  previousSightIds: [],
  previousHangarId: null,
  previousSoundProfileId: null,
  unmanagedWarnings: [],
};

interface ManagedContentOptions {
  dataRoot: string;
  documentsRoot: string;
  repository: StateRepository;
  backups: BackupService;
  sounds: SoundService;
  journal: OperationJournal;
}

interface ExtractedPackage {
  payloadPath: string;
  analysis: ArchiveAnalysis;
  fileCount: number;
  totalSize: number;
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Managed packages cannot contain filesystem links.');
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
  }
  return files;
}

async function unwrapSingleDirectory(root: string): Promise<string> {
  let current = root;
  for (;;) {
    const entries = await readdir(current, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile());
    const directories = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink());
    if (files.length || directories.length !== 1 || !directories[0]) return current;
    current = join(current, directories[0].name);
  }
}

export class ManagedContentService {
  private readonly dataRoot: string;
  private readonly documentsRoot: string;
  private readonly repository: StateRepository;
  private readonly backups: BackupService;
  private readonly sounds: SoundService;
  private readonly journal: OperationJournal;

  constructor(options: ManagedContentOptions) {
    this.dataRoot = options.dataRoot;
    this.documentsRoot = options.documentsRoot;
    this.repository = options.repository;
    this.backups = options.backups;
    this.sounds = options.sounds;
    this.journal = options.journal;
  }

  async ensureSkinLibrary(): Promise<void> {
    const state = await this.repository.load();
    const updates = new Map<string, string>();
    for (const skin of state.skins) {
      if (skin.id.startsWith('external:')) continue;
      const libraryPath = skin.libraryPath ?? join(this.dataRoot, 'library', 'skins', filesystemSafeSegment(skin.id), 'content');
      if (!await pathExists(libraryPath) && skin.active !== false && await pathExists(skin.path)) {
        const staging = `${libraryPath}.staging`;
        await rm(staging, { recursive: true, force: true });
        await copyDirectory(skin.path, staging);
        await mkdir(dirname(libraryPath), { recursive: true });
        await rename(staging, libraryPath);
      }
      if (await pathExists(libraryPath)) updates.set(skin.id, libraryPath);
    }
    const managedActive = state.skins.filter((skin) => !skin.id.startsWith('external:') && skin.active !== false);
    if (!updates.size && (state.collections.length || !managedActive.length)) return;
    await this.repository.update((draft) => {
      for (const skin of draft.skins) {
        const libraryPath = updates.get(skin.id);
        if (libraryPath) skin.libraryPath = libraryPath;
      }
      if (!draft.collections.length && managedActive.length) {
        const now = new Date().toISOString();
        draft.collections.push({
          id: randomUUID(),
          name: 'Current Installation',
          skinIds: managedActive.map((skin) => skin.id),
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  }

  async createCollection(name: string): Promise<SkinCollection> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a collection name.');
    const state = await this.repository.load();
    if (state.collections.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('A skin collection with that name already exists.');
    }
    const now = new Date().toISOString();
    const collection: SkinCollection = {
      id: randomUUID(), name: trimmed, skinIds: [], active: false, createdAt: now, updatedAt: now,
    };
    await this.repository.update((draft) => { draft.collections.push(collection); });
    return collection;
  }

  async setCollectionMembers(id: string, skinIds: string[]): Promise<SkinCollection> {
    const state = await this.repository.load();
    const collection = state.collections.find((item) => item.id === id);
    if (!collection) throw new Error('Skin collection was not found.');
    const managedIds = new Set(state.skins.filter((skin) => !skin.id.startsWith('external:')).map((skin) => skin.id));
    if (skinIds.some((skinId) => !managedIds.has(skinId))) throw new Error('Collections can contain only Tailmark-managed skins.');
    const unique = [...new Set(skinIds)];
    const updated = { ...collection, skinIds: unique, updatedAt: new Date().toISOString() };
    await this.repository.update((draft) => {
      draft.collections = draft.collections.map((item) => item.id === id ? updated : item);
    });
    return updated;
  }

  async removeCollection(id: string): Promise<void> {
    const state = await this.repository.load();
    const collection = state.collections.find((item) => item.id === id);
    if (!collection) throw new Error('Skin collection was not found.');
    if (collection.active) throw new Error('Activate another collection or enter Safe Mode before removing this collection.');
    await this.repository.update((draft) => {
      draft.collections = draft.collections.filter((item) => item.id !== id);
    });
  }

  async activateCollection(id: string): Promise<void> {
    await this.switchCollection(id, true);
  }

  private async switchCollection(id: string | null, journaled: boolean): Promise<void> {
    await this.ensureSkinLibrary();
    const state = await this.repository.load();
    const collection = id ? state.collections.find((item) => item.id === id) : null;
    if (id && !collection) throw new Error('Skin collection was not found.');
    const managed = state.skins.filter((skin) => !skin.id.startsWith('external:'));
    const desired = new Set(collection?.skinIds ?? []);
    const destinations = managed.map((skin) => skin.path);
    const previousCollectionId = state.collections.find((item) => item.active)?.id;
    if (journaled) {
      await this.journal.begin({
        kind: 'collection-switch',
        label: collection ? `activate ${collection.name}` : 'deactivate managed skin collection',
        destinations,
        ...(collection ? { resumeAction: 'activate-collection' as const, resumeId: collection.id } : {}),
        ...(previousCollectionId ? { rollbackId: previousCollectionId } : {}),
      });
    }
    try {
      if (journaled) await this.journal.phase('staging');
      const activeIds = new Set<string>();
      for (const skin of managed) {
        const shouldBeActive = desired.has(skin.id);
        const activeOnDisk = await pathExists(skin.path);
        if (!shouldBeActive && activeOnDisk && skin.active !== false) {
          const libraryPath = skin.libraryPath;
          if (!libraryPath) throw new Error(`${skin.name} has no managed library copy.`);
          const staging = `${libraryPath}.staging`;
          await rm(staging, { recursive: true, force: true });
          await copyDirectory(skin.path, staging);
          await mkdir(dirname(libraryPath), { recursive: true });
          await replaceDirectory(staging, libraryPath, `${libraryPath}.rollback-${randomUUID()}`);
          await rm(skin.path, { recursive: true, force: true });
        }
        if (shouldBeActive) {
          if (activeOnDisk && skin.active === false) {
            if (!skin.libraryPath || !await pathExists(skin.libraryPath)) {
              throw new Error(`${skin.name} conflicts with a folder outside Tailmark's managed library.`);
            }
            const [destinationHash, libraryHash] = await Promise.all([
              fingerprintDirectory(skin.path),
              fingerprintDirectory(skin.libraryPath),
            ]);
            if (destinationHash !== libraryHash) {
              throw new Error(`${skin.name} conflicts with an unmanaged UserSkins folder and needs review.`);
            }
          }
          if (!activeOnDisk) {
            if (!skin.libraryPath || !await pathExists(skin.libraryPath)) {
              throw new Error(`${skin.name} is missing from Tailmark's managed library.`);
            }
            const staging = join(dirname(skin.path), `.tailmark-collection-${filesystemSafeSegment(skin.id)}`);
            await rm(staging, { recursive: true, force: true });
            await copyDirectory(skin.libraryPath, staging);
            if (await pathExists(skin.path)) throw new Error(`${skin.name} conflicts with an unmanaged UserSkins folder.`);
            await rename(staging, skin.path);
          }
          activeIds.add(skin.id);
        }
      }
      if (journaled) await this.journal.phase('committing');
      await this.repository.update((draft) => {
        for (const skin of draft.skins) {
          if (!skin.id.startsWith('external:')) skin.active = activeIds.has(skin.id);
        }
        draft.collections = draft.collections.map((item) => ({ ...item, active: item.id === id }));
      });
      await this.repository.addActivity({
        action: 'collection-switch',
        packageName: collection?.name ?? 'No active collection',
        destination: state.settings.gameRoot ? join(state.settings.gameRoot, 'UserSkins') : 'UserSkins',
        result: 'success',
        fileCount: activeIds.size,
        details: collection ? `Activated ${activeIds.size} managed skins.` : 'Moved all managed skins into Tailmark storage.',
      });
      if (journaled) await this.journal.complete();
    } catch (error) {
      if (journaled) await this.journal.fail(error);
      throw error;
    }
  }

  async importSights(paths: string[]): Promise<ManagedSight[]> {
    const imported: ManagedSight[] = [];
    for (const path of paths) {
      const extracted = await this.extractManagedArchive(path, 'sights');
      const files = await listFiles(extracted.payloadPath);
      const sightFiles = files.filter((file) => extname(file).toLowerCase() === '.blk');
      if (!sightFiles.length) {
        await rm(dirname(extracted.payloadPath), { recursive: true, force: true });
        throw new Error(`${basename(path)} does not contain a custom sight .blk file.`);
      }
      const lowerParts = sightFiles[0]?.split('/').map((part) => part.toLowerCase()) ?? [];
      const allTanks = lowerParts.includes('all_tanks');
      const vehicleId = allTanks ? undefined : lowerParts.at(-2);
      const scopes = new Set(sightFiles.map((file) => {
        const parts = file.split('/');
        const allTanksIndex = parts.findIndex((part) => part.toLowerCase() === 'all_tanks');
        return allTanksIndex >= 0 ? 'all_tanks' : parts.at(-2)?.toLowerCase() ?? '';
      }).filter(Boolean));
      if (scopes.size !== 1) {
        await rm(dirname(extracted.payloadPath), { recursive: true, force: true });
        throw new Error(`${basename(path)} contains multiple sight scopes. Import one vehicle or all_tanks package at a time.`);
      }
      const firstSightParts = sightFiles[0]!.split('/');
      const scopeName = allTanks ? 'all_tanks' : vehicleId;
      const scopeIndex = scopeName
        ? firstSightParts.findIndex((part) => part.toLowerCase() === scopeName.toLowerCase())
        : -1;
      const payloadPath = scopeIndex >= 0
        ? join(extracted.payloadPath, ...firstSightParts.slice(0, scopeIndex + 1))
        : extracted.payloadPath;
      const sight: ManagedSight = {
        id: randomUUID(),
        name: basename(path, extname(path)),
        libraryPath: extracted.payloadPath,
        payloadPath,
        sourceArchive: path,
        scope: allTanks ? 'all-tanks' : 'vehicle',
        ...(vehicleId ? { vehicleId } : {}),
        active: false,
        fileCount: extracted.fileCount,
        totalSize: extracted.totalSize,
        contentHash: await fingerprintDirectory(extracted.payloadPath),
        importedAt: new Date().toISOString(),
        validationStatus: vehicleId || allTanks ? 'valid' : 'warning',
      };
      imported.push(sight);
    }
    await this.repository.update((draft) => { draft.sights.push(...imported); });
    for (const sight of imported) {
      await this.repository.addActivity({
        action: 'install-sight', packageName: sight.name, destination: sight.libraryPath,
        result: 'success', fileCount: sight.fileCount, details: 'Imported and validated a custom sight package.',
      });
    }
    return imported;
  }

  async activateSight(id: string): Promise<void> {
    const state = await this.repository.load();
    const sight = state.sights.find((item) => item.id === id);
    if (!sight) throw new Error('Custom sight was not found.');
    const root = await this.resolveUserSightsRoot();
    const scopeFolder = sight.scope === 'all-tanks' ? 'all_tanks' : sight.vehicleId;
    if (!scopeFolder) throw new Error('Choose a vehicle folder for this sight before activation.');
    const destination = assertPathInside(root, join(root, scopeFolder));
    await this.journal.begin({
      kind: 'sight-activation', label: `activate ${sight.name}`, destinations: [destination],
      resumeAction: 'activate-sight', resumeId: sight.id,
    });
    try {
      await this.journal.phase('staging');
      for (const active of state.sights.filter((item) => item.active && item.destinationPath?.toLowerCase() === destination.toLowerCase())) {
        await this.deactivateSightInternal(active);
      }
      const backup = await this.backups.create(destination, `Before activating sight ${sight.name}`, sight.id);
      const staging = `${destination}.tailmark-staging-${filesystemSafeSegment(sight.id)}`;
      await rm(staging, { recursive: true, force: true });
      if (await pathExists(destination)) await copyDirectory(destination, staging);
      else await mkdir(staging, { recursive: true });
      await copyDirectory(sight.payloadPath ?? await unwrapSingleDirectory(sight.libraryPath), staging, true);
      await this.journal.phase('committing');
      await mkdir(dirname(destination), { recursive: true });
      await replaceDirectory(staging, destination, `${destination}.tailmark-rollback-${randomUUID()}`);
      await this.repository.update((draft) => {
        draft.sights = draft.sights.map((item) => item.id === id
          ? { ...item, active: true, destinationPath: destination, ...(backup ? { backupId: backup.id } : {}) }
          : item.destinationPath?.toLowerCase() === destination.toLowerCase() ? { ...item, active: false } : item);
      });
      await this.repository.addActivity({
        action: 'activate-sight', packageName: sight.name, destination, result: 'success',
        fileCount: sight.fileCount, ...(backup ? { backupId: backup.id } : {}), details: 'Activated a managed custom sight.',
      });
      await this.journal.complete();
    } catch (error) {
      await this.journal.fail(error);
      throw error;
    }
  }

  async deactivateSight(id: string): Promise<void> {
    const sight = (await this.repository.load()).sights.find((item) => item.id === id);
    if (!sight) throw new Error('Custom sight was not found.');
    await this.deactivateSightInternal(sight);
  }

  private async deactivateSightInternal(sight: ManagedSight): Promise<void> {
    if (!sight.active || !sight.destinationPath) return;
    const state = await this.repository.load();
    const backup = sight.backupId ? state.backups.find((item) => item.id === sight.backupId) : null;
    if (backup) await this.backups.restore(backup);
    else await rm(sight.destinationPath, { recursive: true, force: true });
    await this.repository.update((draft) => {
      draft.sights = draft.sights.map((item) => {
        if (item.id !== sight.id) return item;
        const { destinationPath: _destinationPath, backupId: _backupId, ...rest } = item;
        return { ...rest, active: false };
      });
    });
  }

  async removeSight(id: string): Promise<void> {
    const sight = (await this.repository.load()).sights.find((item) => item.id === id);
    if (!sight) throw new Error('Custom sight was not found.');
    if (sight.active) throw new Error('Deactivate this sight before removing it.');
    await rm(dirname(sight.libraryPath), { recursive: true, force: true });
    await this.repository.update((draft) => { draft.sights = draft.sights.filter((item) => item.id !== id); });
  }

  async importHangars(paths: string[]): Promise<ManagedHangar[]> {
    const imported: ManagedHangar[] = [];
    for (const path of paths) {
      const extracted = await this.extractManagedArchive(path, 'hangars');
      const files = await listFiles(extracted.payloadPath);
      const blkFiles = files.filter((file) => extname(file).toLowerCase() === '.blk' && basename(file).toLowerCase() !== 'config.blk');
      const binFiles = files.filter((file) => extname(file).toLowerCase() === '.bin');
      if (!blkFiles.length || !binFiles.length) {
        await rm(dirname(extracted.payloadPath), { recursive: true, force: true });
        throw new Error(`${basename(path)} needs both a hangar .blk configuration and a .bin location.`);
      }
      const payload = await unwrapSingleDirectory(extracted.payloadPath);
      const configPath = join(extracted.payloadPath, ...blkFiles[0]!.split('/'));
      const configFile = relative(payload, configPath).replaceAll('\\', '/');
      if (configFile.startsWith('..')) throw new Error(`${basename(path)} has an invalid hangar configuration path.`);
      const hangar: ManagedHangar = {
        id: randomUUID(),
        name: basename(path, extname(path)),
        libraryPath: extracted.payloadPath,
        sourceArchive: path,
        configFile,
        active: false,
        fileCount: extracted.fileCount,
        totalSize: extracted.totalSize,
        contentHash: await fingerprintDirectory(extracted.payloadPath),
        importedAt: new Date().toISOString(),
        validationStatus: 'valid',
      };
      imported.push(hangar);
    }
    await this.repository.update((draft) => { draft.hangars.push(...imported); });
    for (const hangar of imported) {
      await this.repository.addActivity({
        action: 'install-hangar', packageName: hangar.name, destination: hangar.libraryPath,
        result: 'success', fileCount: hangar.fileCount, details: 'Imported and validated a custom hangar package.',
      });
    }
    return imported;
  }

  async activateHangar(id: string): Promise<void> {
    if (await isWarThunderRunning()) throw new Error('Close War Thunder and its launcher before changing the active hangar.');
    const state = await this.repository.load();
    const root = state.settings.gameRoot;
    if (!root) throw new Error('Select a War Thunder installation first.');
    const hangar = state.hangars.find((item) => item.id === id);
    if (!hangar) throw new Error('Custom hangar was not found.');
    const payload = await unwrapSingleDirectory(hangar.libraryPath);
    const topLevel = await readdir(payload, { withFileTypes: true });
    const deployable = topLevel.filter((entry) => entry.name.toLowerCase() !== 'config.blk');
    const deployedPaths = deployable.map((entry) => assertPathInside(root, join(root, entry.name)));
    const configPath = join(root, 'config.blk');
    await this.journal.begin({
      kind: 'hangar-activation', label: `activate ${hangar.name}`, destinations: [...deployedPaths, configPath],
      resumeAction: 'activate-hangar', resumeId: hangar.id,
    });
    try {
      const active = state.hangars.find((item) => item.active);
      if (active) await this.deactivateHangarInternal(active);
      await this.journal.phase('staging');
      const backupIds: string[] = [];
      for (const entry of deployable) {
        const source = join(payload, entry.name);
        const destination = assertPathInside(root, join(root, entry.name));
        const backup = await this.backups.create(destination, `Before activating hangar ${hangar.name}`, hangar.id);
        if (backup) backupIds.push(backup.id);
        const staging = join(root, `.tailmark-hangar-${filesystemSafeSegment(hangar.id)}-${filesystemSafeSegment(entry.name)}`);
        await rm(staging, { recursive: true, force: true });
        if (await pathExists(destination) && entry.isDirectory()) await copyDirectory(destination, staging);
        await copyDirectory(source, staging, true);
        await replaceDirectory(staging, destination, `${destination}.tailmark-rollback-${randomUUID()}`);
      }
      const originalConfig = await readFile(configPath, 'utf8');
      const previousHangar = readHangarConfig(originalConfig);
      await this.backups.create(configPath, `Before activating hangar ${hangar.name}`, hangar.id);
      await this.journal.phase('committing');
      await updateHangarConfigFile(configPath, hangar.configFile.replaceAll('/', '\\'));
      await this.repository.update((draft) => {
        draft.hangars = draft.hangars.map((item) => item.id === id
          ? {
            ...item, active: true, deployedPaths, backupIds,
            previousConfigValue: previousHangar,
          }
          : { ...item, active: false });
      });
      await this.repository.addActivity({
        action: 'activate-hangar', packageName: hangar.name, destination: root, result: 'success',
        fileCount: hangar.fileCount, details: 'Activated a managed custom hangar and updated hangarBlk.',
      });
      await this.journal.complete();
    } catch (error) {
      await this.journal.fail(error);
      throw error;
    }
  }

  async deactivateHangar(): Promise<void> {
    const active = (await this.repository.load()).hangars.find((item) => item.active);
    if (active) await this.deactivateHangarInternal(active);
  }

  private async deactivateHangarInternal(hangar: ManagedHangar): Promise<void> {
    const state = await this.repository.load();
    const root = state.settings.gameRoot;
    if (!root) throw new Error('Select a War Thunder installation first.');
    const backupIds = new Set(hangar.backupIds ?? []);
    for (const destination of [...(hangar.deployedPaths ?? [])].reverse()) {
      const backup = state.backups.find((item) => backupIds.has(item.id) && item.sourcePath.toLowerCase() === destination.toLowerCase());
      if (backup) await this.backups.restore(backup);
      else await rm(destination, { recursive: true, force: true });
    }
    const configPath = join(root, 'config.blk');
    await updateHangarConfigFile(configPath, hangar.previousConfigValue ?? null);
    await this.repository.update((draft) => {
      draft.hangars = draft.hangars.map((item) => {
        if (item.id !== hangar.id) return item;
        const {
          deployedPaths: _deployedPaths,
          backupIds: _backupIds,
          previousConfigValue: _previousConfigValue,
          ...rest
        } = item;
        return { ...rest, active: false };
      });
    });
  }

  async removeHangar(id: string): Promise<void> {
    const hangar = (await this.repository.load()).hangars.find((item) => item.id === id);
    if (!hangar) throw new Error('Custom hangar was not found.');
    if (hangar.active) throw new Error('Deactivate this hangar before removing it.');
    await rm(dirname(hangar.libraryPath), { recursive: true, force: true });
    await this.repository.update((draft) => { draft.hangars = draft.hangars.filter((item) => item.id !== id); });
  }

  async enterSafeMode(): Promise<SafeModeState> {
    if (await isWarThunderRunning()) throw new Error('Close War Thunder and its launcher before entering Safe Mode.');
    const state = await this.repository.load();
    if (state.safeMode.active) return state.safeMode;
    const activeCollection = state.collections.find((item) => item.active);
    const activeSightIds = state.sights.filter((item) => item.active).map((item) => item.id);
    const activeHangar = state.hangars.find((item) => item.active);
    const unmanaged = state.skins.filter((skin) => skin.id.startsWith('external:')).map((skin) => skin.name);
    const existingPlan = state.safeMode.previousCollectionId
      || state.safeMode.previousSightIds.length
      || state.safeMode.previousHangarId
      || state.safeMode.previousSoundProfileId;
    const plan: SafeModeState = existingPlan ? state.safeMode : {
      active: false,
      activatedAt: null,
      previousCollectionId: activeCollection?.id ?? null,
      previousSightIds: activeSightIds,
      previousHangarId: activeHangar?.id ?? null,
      previousSoundProfileId: state.settings.activeSoundProfileId,
      unmanagedWarnings: unmanaged.length ? [`${unmanaged.length} externally installed skin folder${unmanaged.length === 1 ? '' : 's'} remain untouched.`] : [],
    };
    await this.repository.update((draft) => { draft.safeMode = plan; });
    const destinations = [
      ...state.skins.filter((skin) => skin.active !== false && !skin.id.startsWith('external:')).map((skin) => skin.path),
      ...state.sights.filter((item) => item.active && item.destinationPath).map((item) => item.destinationPath!),
      ...(activeHangar?.deployedPaths ?? []),
      ...(state.settings.gameRoot ? [join(state.settings.gameRoot, 'sound', 'mod')] : []),
    ];
    await this.journal.begin({
      kind: 'safe-mode-enter', label: 'enter Safe Mode', destinations, resumeAction: 'enter-safe-mode',
    });
    try {
      await this.switchCollection(null, false);
      for (const sight of state.sights.filter((item) => item.active)) await this.deactivateSightInternal(sight);
      if (activeHangar) await this.deactivateHangarInternal(activeHangar);
      if (state.settings.activeSoundProfileId || state.settings.activeSoundPackageId) await this.sounds.deactivate();
      const safeMode: SafeModeState = { ...plan, active: true, activatedAt: new Date().toISOString() };
      await this.repository.update((draft) => { draft.safeMode = safeMode; });
      await this.repository.addActivity({
        action: 'safe-mode', packageName: 'Safe Mode', destination: state.settings.gameRoot ?? 'Managed content',
        result: plan.unmanagedWarnings.length ? 'warning' : 'success', fileCount: destinations.length,
        details: plan.unmanagedWarnings.length ? plan.unmanagedWarnings.join(' ') : 'Disabled all Tailmark-managed content.',
      });
      await this.journal.complete();
      return safeMode;
    } catch (error) {
      await this.journal.fail(error);
      throw error;
    }
  }

  async restoreSafeMode(): Promise<SafeModeState> {
    const state = await this.repository.load();
    if (!state.safeMode.active) return state.safeMode;
    try {
      if (state.safeMode.previousCollectionId) await this.switchCollection(state.safeMode.previousCollectionId, true);
      for (const id of state.safeMode.previousSightIds) await this.activateSight(id);
      if (state.safeMode.previousHangarId) await this.activateHangar(state.safeMode.previousHangarId);
      if (state.safeMode.previousSoundProfileId) await this.sounds.activateProfile(state.safeMode.previousSoundProfileId);
      await this.repository.update((draft) => { draft.safeMode = structuredClone(EMPTY_SAFE_MODE); });
      await this.repository.addActivity({
        action: 'safe-mode', packageName: 'Safe Mode', destination: state.settings.gameRoot ?? 'Managed content',
        result: 'success', fileCount: 0, details: 'Restored the managed content that was active before Safe Mode.',
      });
      return structuredClone(EMPTY_SAFE_MODE);
    } catch (error) {
      throw error;
    }
  }

  async resumeRecovery(): Promise<void> {
    const recovery = await this.journal.load();
    if (!recovery?.resumeAction) throw new Error('This interrupted operation can only be rolled back safely.');
    await this.journal.complete();
    if (recovery.resumeAction === 'activate-collection' && recovery.resumeId) await this.activateCollection(recovery.resumeId);
    else if (recovery.resumeAction === 'enter-safe-mode') await this.enterSafeMode();
    else if (recovery.resumeAction === 'restore-safe-mode') await this.restoreSafeMode();
    else if (recovery.resumeAction === 'activate-sight' && recovery.resumeId) await this.activateSight(recovery.resumeId);
    else if (recovery.resumeAction === 'activate-hangar' && recovery.resumeId) await this.activateHangar(recovery.resumeId);
    else throw new Error('The recovery command is incomplete. Roll back safely instead.');
  }

  async rollbackRecovery(): Promise<void> {
    const recovery = await this.journal.load();
    if (!recovery) return;
    await this.journal.phase('rollback');
    const state = await this.repository.load();
    if (recovery.kind === 'safe-mode-enter') {
      await this.journal.complete();
      await this.repository.update((draft) => {
        draft.safeMode = {
          ...draft.safeMode,
          active: true,
          activatedAt: draft.safeMode.activatedAt ?? new Date().toISOString(),
        };
      });
      await this.restoreSafeMode();
      return;
    }
    for (const target of [...recovery.destinations].reverse()) {
      const backup = state.backups
        .filter((item) => item.sourcePath.toLowerCase() === target.path.toLowerCase() && item.createdAt >= recovery.startedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (backup) await this.backups.restore(backup);
      else if (!target.existed && recovery.kind !== 'collection-switch') {
        await rm(target.path, { recursive: true, force: true });
      }
    }
    if (recovery.kind === 'collection-switch') {
      for (const skin of state.skins.filter((item) => !item.id.startsWith('external:'))) {
        const target = recovery.destinations.find((item) => item.path.toLowerCase() === skin.path.toLowerCase());
        if (!target) continue;
        const exists = await pathExists(skin.path);
        if (target.existed && !exists) {
          if (!skin.libraryPath || !await pathExists(skin.libraryPath)) {
            throw new Error(`${skin.name} cannot be restored because its managed library copy is missing.`);
          }
          const staging = join(dirname(skin.path), `.tailmark-recovery-${filesystemSafeSegment(skin.id)}`);
          await rm(staging, { recursive: true, force: true });
          await copyDirectory(skin.libraryPath, staging);
          await rename(staging, skin.path);
        } else if (!target.existed && exists) {
          if (!skin.libraryPath || !await pathExists(skin.libraryPath)) {
            throw new Error(`${skin.name} cannot be removed safely because its managed library copy is missing.`);
          }
          const [destinationHash, libraryHash] = await Promise.all([
            fingerprintDirectory(skin.path),
            fingerprintDirectory(skin.libraryPath),
          ]);
          if (destinationHash !== libraryHash) {
            throw new Error(`${skin.name} changed after the interrupted operation. Tailmark left it in place for review.`);
          }
          await rm(skin.path, { recursive: true, force: true });
        }
      }
    }
    if (state.settings.gameRoot) await rm(join(state.settings.gameRoot, '.tailmark-staging'), { recursive: true, force: true });
    await this.repository.update((draft) => {
      if (recovery.kind === 'collection-switch') {
        const activeIds = new Set<string>();
        for (const skin of draft.skins) {
          if (skin.id.startsWith('external:')) continue;
          skin.active = recovery.destinations.some((target) => target.path.toLowerCase() === skin.path.toLowerCase() && target.existed);
          if (skin.active) activeIds.add(skin.id);
        }
        let matchedCollection = false;
        draft.collections = draft.collections.map((collection) => {
          const members = new Set(collection.skinIds);
          const fallbackMatch = activeIds.size > 0
            && members.size === activeIds.size
            && [...members].every((id) => activeIds.has(id));
          const matches = recovery.rollbackId
            ? collection.id === recovery.rollbackId
            : !matchedCollection && fallbackMatch;
          if (matches) matchedCollection = true;
          return { ...collection, active: matches };
        });
      } else if (recovery.kind === 'sight-activation' && recovery.resumeId) {
        draft.sights = draft.sights.map((item) => {
          if (item.id !== recovery.resumeId) return item;
          const { destinationPath: _destinationPath, backupId: _backupId, ...rest } = item;
          return { ...rest, active: false };
        });
      } else if (recovery.kind === 'hangar-activation') {
        draft.hangars = draft.hangars.map((item) => {
          const {
            deployedPaths: _deployedPaths,
            backupIds: _backupIds,
            previousConfigValue: _previousConfigValue,
            ...rest
          } = item;
          return { ...rest, active: false };
        });
      }
    });
    await this.repository.addActivity({
      action: 'recovery', packageName: recovery.label, destination: recovery.destinations[0]?.path ?? this.dataRoot,
      result: 'success', fileCount: recovery.destinations.length, details: 'Rolled back an interrupted managed-content operation.',
    });
    await this.journal.complete();
  }

  private async extractManagedArchive(path: string, category: 'sights' | 'hangars'): Promise<ExtractedPackage> {
    const analysis = await inspectArchive(path, null, new AbortController().signal, () => undefined);
    const unsafe = analysis.warnings.find((warning) => warning.level === 'error')
      ?? analysis.entries.find((entry) => entry.executable || entry.unsafeReason);
    if (unsafe) throw new Error(`${basename(path)} contains unsafe or unsupported content.`);
    const id = randomUUID();
    const packageRoot = join(this.dataRoot, 'library', category, id);
    const extraction: ArchiveAnalysis = {
      ...analysis,
      roots: [{ sourcePrefix: '', destinationName: 'content', fileCount: analysis.fileCount }],
      manualType: 'skin',
    };
    try {
      await extractAnalysis(extraction, packageRoot, new AbortController().signal, () => undefined);
      const payloadPath = join(packageRoot, 'content');
      const summary = await directorySummary(payloadPath);
      return { payloadPath, analysis, fileCount: summary.fileCount, totalSize: summary.totalSize };
    } catch (error) {
      await rm(packageRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async resolveUserSightsRoot(): Promise<string> {
    const saves = join(this.documentsRoot, 'My Games', 'WarThunder', 'Saves');
    if (!await pathExists(saves)) throw new Error('War Thunder save profiles were not found under Documents/My Games/WarThunder/Saves.');
    const profiles = (await readdir(saves, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
    if (!profiles[0]) throw new Error('No War Thunder save profile is available for custom sights.');
    const root = join(saves, profiles[0], 'production', 'UserSights');
    await mkdir(root, { recursive: true });
    return root;
  }
}
