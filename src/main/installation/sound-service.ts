import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SoundPackage, SoundProfile } from '@shared/models';
import { BackupService } from '@main/backups/backup-service';
import { updateConfigFile } from '@main/config-blk/editor';
import { detectExternalSound } from '@main/detection/active-sound';
import { validateGameInstallation } from '@main/detection/game-installation';
import { copyDirectory, directorySummary, replaceDirectory } from '@main/filesystem/file-operations';
import { copySoundPayload, listSoundPayloadFiles, resolveSoundPayloadRoot } from '@main/installation/sound-payload';
import { sanitizeWindowsName } from '@main/filesystem/path-safety';
import { StateRepository } from '@main/persistence/state';
import { isWarThunderRunning } from '@main/processes/game-process';

export function buildSinglePackageProfile(sound: SoundPackage, existing: SoundProfile[]): SoundProfile | null {
  const duplicate = existing.find((profile) => (
    profile.packageIds.length === 1
    && profile.packageIds[0] === sound.id
  ));
  if (duplicate) return null;
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: sound.name,
    packageIds: [sound.id],
    priority: [sound.id],
    conflicts: [],
    createdAt: now,
    updatedAt: now,
    active: sound.active,
  };
}

export class SoundService {
  constructor(
    private readonly dataRoot: string,
    private readonly repository: StateRepository,
    private readonly backups: BackupService,
  ) {}

  private async gameRoot(options: { requireClosed?: boolean } = {}): Promise<string> {
    const requireClosed = options.requireClosed ?? true;
    const root = (await this.repository.load()).settings.gameRoot;
    if (!root) throw new Error('Select a War Thunder installation in Settings first.');
    const installation = await validateGameInstallation(root, 'saved');
    if (!installation.valid) throw new Error('The saved War Thunder installation is no longer valid.');
    if (requireClosed && await isWarThunderRunning()) throw new Error('War Thunder appears to be running. Close it and choose Check Again.');
    return root;
  }

  async activatePackage(id: string): Promise<void> {
    const state = await this.repository.load();
    const sound = state.sounds.find((item) => item.id === id);
    if (!sound) throw new Error('Sound package was not found.');
    let profile = state.profiles.find((item) => item.packageIds.length === 1 && item.packageIds[0] === id);
    if (!profile) {
      profile = buildSinglePackageProfile(sound, state.profiles) ?? undefined;
      if (!profile) throw new Error('A profile could not be created for this sound package.');
      await this.repository.update((draft) => { draft.profiles.push(profile as SoundProfile); });
    }
    await this.activateSources(profile.name, [sound], profile.id);
  }

  async activateProfile(id: string): Promise<void> {
    const state = await this.repository.load();
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) throw new Error('Sound profile was not found.');
    if (profile.packageIds.length > 1 && !state.settings.advancedSoundMerging) {
      throw new Error('Enable advanced sound-mod merging in Settings first.');
    }
    const packages = profile.priority.map((packageId) => state.sounds.find((sound) => sound.id === packageId)).filter((sound): sound is SoundPackage => Boolean(sound));
    if (packages.length !== profile.priority.length) throw new Error('One or more packages in this profile are missing.');
    await this.activateSources(profile.name, packages, profile.id);
  }

  private async activateSources(name: string, packages: SoundPackage[], profileId: string | null): Promise<void> {
    const root = await this.gameRoot();
    const soundRoot = join(root, 'sound');
    const destination = join(soundRoot, 'mod');
    const staging = join(soundRoot, `.tailmark-staging-${randomUUID()}`);
    const rollback = join(soundRoot, `.tailmark-rollback-${randomUUID()}`);
    await mkdir(soundRoot, { recursive: true });
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    let backupId: string | undefined;
    try {
      for (const sound of packages) await copySoundPayload(sound.libraryPath, staging);
      await writeFile(join(staging, '.tailmark-managed.json'), JSON.stringify({
        version: 1,
        packageIds: packages.map((item) => item.id),
        profileId,
        activatedAt: new Date().toISOString(),
      }, null, 2));
      const backup = await this.backups.create(destination, `Before activating ${name}`, packages[0]?.id);
      backupId = backup?.id;
      await updateConfigFile(join(root, 'config.blk'), true);
      await replaceDirectory(staging, destination, rollback);
      await this.repository.update((draft) => {
        draft.sounds.forEach((sound) => { sound.active = packages.some((item) => item.id === sound.id); });
        draft.profiles.forEach((profile) => { profile.active = profile.id === profileId; });
        draft.settings.activeSoundPackageId = profileId ? null : packages[0]?.id ?? null;
        draft.settings.activeSoundProfileId = profileId;
      });
      await this.repository.addActivity({ action: 'activate-sound', packageName: name, destination, result: 'success', fileCount: (await listSoundPayloadFiles(destination)).length, ...(backupId ? { backupId } : {}), details: packages.length > 1 ? `Activated combined profile with priority: ${packages.map((item) => item.name).join(' → ')}. Later packages won conflicts.` : 'Installed the package contents directly into sound/mod and enabled sound mods in config.blk.' });
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      if (backupId) {
        const record = (await this.repository.load()).backups.find((item) => item.id === backupId);
        if (record) await this.backups.restore(record).catch(() => undefined);
      }
      throw error;
    }
  }

  async deactivate(): Promise<void> {
    const root = await this.gameRoot();
    const state = await this.repository.load();
    const destination = join(root, 'sound', 'mod');
    const external = await detectExternalSound(root, state.sounds, state.profiles);
    await updateConfigFile(join(root, 'config.blk'), false);
    let removedManagedFolder = false;
    if (external?.ownership === 'managed') {
      await this.backups.create(destination, 'Before deactivating managed sound mod');
      await rm(destination, { recursive: true, force: true });
      removedManagedFolder = true;
    }
    await this.repository.update((draft) => {
      draft.sounds.forEach((sound) => { sound.active = false; });
      draft.profiles.forEach((profile) => { profile.active = false; });
      draft.settings.activeSoundPackageId = null;
      draft.settings.activeSoundProfileId = null;
    });
    await this.repository.addActivity({
      action: 'deactivate-sound',
      packageName: 'Sound mods',
      destination,
      result: external && !removedManagedFolder ? 'warning' : 'success',
      fileCount: external?.fileCount ?? 0,
      details: removedManagedFolder
        ? 'Disabled enable_mod and removed the verified Tailmark-managed deployment.'
        : 'Disabled enable_mod. Existing files were preserved because Tailmark could not verify sole ownership of the deployment.',
    });
  }

  async createProfile(name: string, packageIds: string[]): Promise<SoundProfile> {
    const state = await this.repository.load();
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a profile name.');
    if (packageIds.length < 1) throw new Error('Select at least one sound package.');
    if (packageIds.length > 1 && !state.settings.advancedSoundMerging) {
      throw new Error('Enable advanced sound-mod merging in Settings before creating a combined profile.');
    }
    const packages = packageIds.map((id) => state.sounds.find((sound) => sound.id === id));
    if (packages.some((item) => !item)) throw new Error('One or more selected sound packages are missing.');
    const owners = new Map<string, string[]>();
    const packageFiles = await Promise.all((packages as SoundPackage[]).map(async (sound) => ({
      sound,
      files: await listSoundPayloadFiles(await resolveSoundPayloadRoot(sound.libraryPath)),
    })));
    for (const { sound, files } of packageFiles) {
      for (const file of files) {
        const key = file.toLowerCase();
        owners.set(key, [...(owners.get(key) ?? []), sound.id]);
      }
    }
    const conflicts = [...owners.entries()].filter(([, ids]) => ids.length > 1).map(([path, ids]) => ({ path, winnerPackageId: ids.at(-1) as string, packageIds: ids }));
    const now = new Date().toISOString();
    const profile: SoundProfile = { id: randomUUID(), name: trimmed, packageIds, priority: packageIds, conflicts, createdAt: now, updatedAt: now, active: false };
    await this.repository.update((draft) => { draft.profiles.push(profile); });
    return profile;
  }

  async ensureAutoProfile(sound: SoundPackage): Promise<SoundProfile | null> {
    const state = await this.repository.load();
    const profile = buildSinglePackageProfile(sound, state.profiles);
    if (!profile) return null;
    await this.repository.update((draft) => { draft.profiles.push(profile); });
    return profile;
  }

  async ensurePackageProfiles(): Promise<void> {
    const state = await this.repository.load();
    const missing = state.sounds
      .map((sound) => buildSinglePackageProfile(sound, [...state.profiles]))
      .filter((profile): profile is SoundProfile => Boolean(profile));
    if (!missing.length) return;
    await this.repository.update((draft) => {
      for (const sound of draft.sounds) {
        const profile = buildSinglePackageProfile(sound, draft.profiles);
        if (profile) draft.profiles.push(profile);
      }
    });
  }

  async adoptExternal(name: string): Promise<SoundProfile> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a name for this sound mod profile.');
    const root = await this.gameRoot({ requireClosed: false });
    const state = await this.repository.load();
    const external = await detectExternalSound(root, state.sounds, state.profiles);
    if (!external) throw new Error('No sound mod files were found in sound/mod.');
    if (external.managed) throw new Error('This sound/mod folder is already Tailmark-managed. Use the existing profile.');
    if (external.ownership === 'matched') throw new Error('This install already matches a saved profile. Reconnect that profile instead of creating a duplicate.');
    const destination = external.path;
    const packageId = randomUUID();
    const folderName = sanitizeWindowsName(trimmed);
    const packageRoot = join(this.dataRoot, 'library', 'sounds', packageId);
    const storedPath = join(packageRoot, folderName);
    const staging = `${packageRoot}.staging`;
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    try {
      await copyDirectory(destination, join(staging, folderName), true);
      for (const marker of ['.tailmark-managed.json', '.thundermod-managed.json']) {
        await rm(join(staging, folderName, marker), { force: true });
      }
      await mkdir(join(this.dataRoot, 'library', 'sounds'), { recursive: true });
      await rm(packageRoot, { recursive: true, force: true });
      await rename(staging, packageRoot);
      const summary = await directorySummary(storedPath);
      const now = new Date().toISOString();
      const soundPackage: SoundPackage = {
        id: packageId,
        name: trimmed,
        libraryPath: storedPath,
        archiveSource: destination,
        importedAt: now,
        fileCount: summary.fileCount,
        totalSize: summary.totalSize,
        active: external.enabled,
        validationStatus: 'valid',
        conflicts: [],
        variants: [],
        contentHash: `adopted:${packageId}`,
        notes: 'Adopted from the currently installed sound/mod folder.',
      };
      const profile: SoundProfile = {
        id: randomUUID(),
        name: trimmed,
        packageIds: [packageId],
        priority: [packageId],
        conflicts: [],
        createdAt: now,
        updatedAt: now,
        active: external.enabled,
      };
      await writeFile(join(destination, '.tailmark-managed.json'), JSON.stringify({
        version: 1,
        packageIds: [packageId],
        profileId: profile.id,
        adoptedAt: now,
      }, null, 2));
      await this.repository.update((draft) => {
        draft.sounds.forEach((sound) => { sound.active = false; });
        draft.profiles.forEach((item) => { item.active = false; });
        draft.sounds.push(soundPackage);
        draft.profiles.push(profile);
        draft.settings.activeSoundPackageId = null;
        draft.settings.activeSoundProfileId = external.enabled ? profile.id : null;
      });
      await this.repository.addActivity({
        action: 'import-sound',
        packageName: trimmed,
        destination: storedPath,
        result: 'success',
        fileCount: summary.fileCount,
        details: 'Adopted the existing sound/mod install into the managed library and created a named profile.',
      });
      return profile;
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      await rm(packageRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async reconnectExternal(): Promise<SoundProfile> {
    const root = await this.gameRoot({ requireClosed: false });
    const state = await this.repository.load();
    const external = await detectExternalSound(root, state.sounds, state.profiles);
    if (!external || external.ownership !== 'matched' || !external.profileId) {
      throw new Error('The installed files do not exactly match a saved profile. Save them as a new profile instead.');
    }
    const profile = state.profiles.find((item) => item.id === external.profileId);
    if (!profile) throw new Error('The matching sound profile is missing.');
    const profilePackageIds = new Set(profile.packageIds);
    await writeFile(join(external.path, '.tailmark-managed.json'), JSON.stringify({
      version: 1,
      packageIds: profile.packageIds,
      profileId: profile.id,
      reconnectedAt: new Date().toISOString(),
    }, null, 2));
    await this.repository.update((draft) => {
      draft.sounds.forEach((sound) => { sound.active = external.enabled && profilePackageIds.has(sound.id); });
      draft.profiles.forEach((item) => { item.active = external.enabled && item.id === profile.id; });
      draft.settings.activeSoundPackageId = null;
      draft.settings.activeSoundProfileId = external.enabled ? profile.id : null;
    });
    await this.repository.addActivity({
      action: 'settings',
      packageName: profile.name,
      destination: external.path,
      result: 'success',
      fileCount: external.fileCount,
      details: 'Reconnected an exact on-disk content match to its saved sound profile without replacing files.',
    });
    return profile;
  }

  async renameProfile(id: string, name: string): Promise<SoundProfile> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Enter a profile name.');
    let renamed: SoundProfile | undefined;
    await this.repository.update((draft) => {
      const profile = draft.profiles.find((item) => item.id === id);
      if (!profile) throw new Error('Sound profile was not found.');
      profile.name = trimmed;
      profile.updatedAt = new Date().toISOString();
      renamed = { ...profile, packageIds: [...profile.packageIds], priority: [...profile.priority], conflicts: [...profile.conflicts] };
    });
    return renamed as SoundProfile;
  }

  async removeProfile(id: string): Promise<void> {
    const state = await this.repository.load();
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) throw new Error('Sound profile was not found.');
    if (profile.active || state.settings.activeSoundProfileId === id) {
      throw new Error('Deactivate this profile before removing it.');
    }
    const isOnlyProfileForPackage = profile.packageIds.length === 1
      && !state.profiles.some((item) => item.id !== id && item.packageIds.length === 1 && item.packageIds[0] === profile.packageIds[0]);
    if (isOnlyProfileForPackage) {
      throw new Error('Every sound package keeps one profile. Remove the sound package instead, or create another single-package profile first.');
    }
    await this.repository.update((draft) => {
      draft.profiles = draft.profiles.filter((item) => item.id !== id);
    });
  }
}
