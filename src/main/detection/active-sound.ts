import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { createContentFingerprint, type ContentFingerprintEntry } from '@main/archives/content-fingerprint';
import { mapWithConcurrency, HASH_FILE_CONCURRENCY } from '@main/concurrency';
import { parseBlocks } from '@main/config-blk/editor';
import { pathExists } from '@main/filesystem/file-operations';
import { resolveSoundPayloadRoot } from '@main/installation/sound-payload';
import { JUNK_BASENAMES, SOUND_EXTENSIONS } from '@shared/constants';
import type {
  ExternalSoundState,
  SoundConfigState,
  SoundPackage,
  SoundProfile,
} from '@shared/models';

const MARKER_NAMES = ['.tailmark-managed.json', '.thundermod-managed.json'] as const;
const SOUND_PAYLOAD_EXTENSIONS = new Set([
  ...SOUND_EXTENSIONS,
  '.aac', '.flac', '.m4a', '.mp3', '.opus', '.wem',
]);
const FINGERPRINT_NAMESPACE = 'sound-deployment-v1';

interface SoundTreeEntry extends ContentFingerprintEntry {
  absolutePath: string;
  size: number;
}

interface SoundTreeInventory {
  contentHash: string;
  entries: SoundTreeEntry[];
  fileCount: number;
  soundFileCount: number;
  totalSize: number;
  warnings: string[];
}

interface MarkerReadResult {
  present: boolean;
  malformed: boolean;
  marker: ManagedSoundMarker | null;
}

interface CachedDigest {
  size: number;
  modifiedAt: number;
  digest: string;
}

const digestCache = new Map<string, CachedDigest>();

export interface ManagedSoundMarker {
  packageIds: string[];
  profileId: string | null;
}

function canonicalPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function isManagedMarker(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKER_NAMES.some((marker) => marker.toLowerCase() === lower);
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const value of createReadStream(path)) hash.update(value as Buffer);
  return hash.digest('hex');
}

async function scanSoundTree(root: string): Promise<SoundTreeInventory> {
  const files: Array<{ absolutePath: string; path: string; size: number; modifiedAt: number }> = [];
  const warnings: string[] = [];

  const walk = async (current: string): Promise<void> => {
    let children;
    try {
      children = await readdir(current, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      warnings.push(`Could not read ${relative(root, current) || 'sound/mod'} (${code}).`);
      return;
    }
    for (const child of children) {
      const absolutePath = join(current, child.name);
      if (child.isSymbolicLink()) {
        warnings.push(`Skipped linked entry ${relative(root, absolutePath).replace(/\\/g, '/')}.`);
        continue;
      }
      if (child.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!child.isFile() || isManagedMarker(child.name) || JUNK_BASENAMES.has(child.name.toLowerCase())) continue;
      try {
        const info = await lstat(absolutePath);
        files.push({
          absolutePath,
          path: relative(root, absolutePath).replace(/\\/g, '/'),
          size: info.size,
          modifiedAt: info.mtimeMs,
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
        warnings.push(`Could not inspect ${relative(root, absolutePath).replace(/\\/g, '/')} (${code}).`);
      }
    }
  };

  await walk(root);
  const inspectedEntries = await mapWithConcurrency(files, HASH_FILE_CONCURRENCY, async (file): Promise<SoundTreeEntry | null> => {
    try {
      const cacheKey = file.absolutePath.toLowerCase();
      const cached = digestCache.get(cacheKey);
      const digest = cached && cached.size === file.size && cached.modifiedAt === file.modifiedAt
        ? cached.digest
        : await digestFile(file.absolutePath);
      digestCache.set(cacheKey, { size: file.size, modifiedAt: file.modifiedAt, digest });
      return { path: file.path, absolutePath: file.absolutePath, size: file.size, digest };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      warnings.push(`Could not fingerprint ${file.path} (${code}).`);
      return null;
    }
  });
  const entries = inspectedEntries.filter((entry): entry is SoundTreeEntry => Boolean(entry));
  entries.sort((left, right) => canonicalPath(left.path).localeCompare(canonicalPath(right.path)));
  return {
    contentHash: createContentFingerprint(entries, FINGERPRINT_NAMESPACE),
    entries,
    fileCount: entries.length,
    soundFileCount: entries.filter((entry) => SOUND_PAYLOAD_EXTENSIONS.has(extname(entry.path).toLowerCase())).length,
    totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
    warnings,
  };
}

function mergedInventory(inventories: SoundTreeInventory[]): Pick<SoundTreeInventory, 'contentHash' | 'entries'> {
  const entries = new Map<string, SoundTreeEntry>();
  for (const inventory of inventories) {
    for (const entry of inventory.entries) entries.set(canonicalPath(entry.path), entry);
  }
  const merged = [...entries.values()];
  return {
    entries: merged,
    contentHash: createContentFingerprint(merged, FINGERPRINT_NAMESPACE),
  };
}

function booleanProperty(block: string, name: string): boolean | null {
  const match = block.match(new RegExp(`^\\s*${name}\\s*:\\s*b\\s*=\\s*(yes|no|true|false|1|0)\\s*(?:\\/\\/.*)?$`, 'im'));
  if (!match?.[1]) return null;
  return ['yes', 'true', '1'].includes(match[1].toLowerCase());
}

export function parseSoundConfig(content: string): SoundConfigState {
  let block: string | null = null;
  try {
    const sounds = parseBlocks(content).filter((candidate) => candidate.name.toLowerCase() === 'sound');
    if (sounds.length > 1) return { status: 'unreadable', enableMod: null, fmodSoundEnable: null };
    const sound = sounds[0];
    if (sound) block = content.slice(sound.open + 1, sound.close);
  } catch {
    return { status: 'unreadable', enableMod: null, fmodSoundEnable: null };
  }
  if (!block) return { status: 'missing', enableMod: null, fmodSoundEnable: null };
  const enableMod = booleanProperty(block, 'enable_mod');
  const fmodSoundEnable = booleanProperty(block, 'fmod_sound_enable');
  let status: SoundConfigState['status'];
  if (enableMod === true && fmodSoundEnable !== false) status = 'enabled';
  else if (enableMod === false) status = 'disabled';
  else if (enableMod === null && fmodSoundEnable === null) status = 'missing';
  else status = 'partial';
  return { status, enableMod, fmodSoundEnable };
}

export function isSoundModEnabled(content: string): boolean {
  return parseSoundConfig(content).enableMod === true;
}

async function readMarker(destination: string): Promise<MarkerReadResult> {
  for (const name of MARKER_NAMES) {
    const path = join(destination, name);
    if (!await pathExists(path)) continue;
    try {
      const info = await lstat(path);
      if (info.size > 64 * 1024) return { present: true, malformed: true, marker: { packageIds: [], profileId: null } };
      const raw = JSON.parse(await readFile(path, 'utf8')) as { packageIds?: unknown; profileId?: unknown };
      const packageIds = Array.isArray(raw.packageIds)
        ? [...new Set(raw.packageIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 100)
        : [];
      const profileId = typeof raw.profileId === 'string' && raw.profileId.length > 0 ? raw.profileId : null;
      return { present: true, malformed: false, marker: { packageIds, profileId } };
    } catch {
      return { present: true, malformed: true, marker: { packageIds: [], profileId: null } };
    }
  }
  return { present: false, malformed: false, marker: null };
}

export async function readManagedSoundMarker(destination: string): Promise<ManagedSoundMarker | null> {
  return (await readMarker(destination)).marker;
}

function preferredProfile(profiles: SoundProfile[]): SoundProfile | undefined {
  return profiles.find((profile) => profile.active) ?? profiles[0];
}

export async function detectExternalSound(
  gameRoot: string,
  sounds: SoundPackage[] = [],
  profiles: SoundProfile[] = [],
): Promise<ExternalSoundState | null> {
  const destination = join(gameRoot, 'sound', 'mod');
  if (!await pathExists(destination)) return null;
  const inventory = await scanSoundTree(destination);
  if (inventory.fileCount === 0) return null;

  let config: SoundConfigState;
  try {
    config = parseSoundConfig(await readFile(join(gameRoot, 'config.blk'), 'utf8'));
  } catch (error) {
    config = {
      status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable',
      enableMod: null,
      fmodSoundEnable: null,
    };
  }

  const packageInventories = new Map<string, SoundTreeInventory>();
  const inspectedPackages = await mapWithConcurrency(sounds, HASH_FILE_CONCURRENCY, async (sound) => {
    if (!await pathExists(sound.libraryPath)) return null;
    const payloadRoot = await resolveSoundPayloadRoot(sound.libraryPath);
    return { id: sound.id, inventory: await scanSoundTree(payloadRoot) };
  });
  for (const inspected of inspectedPackages) {
    if (inspected) packageInventories.set(inspected.id, inspected.inventory);
  }
  const profileFingerprints = new Map<string, string>();
  for (const profile of profiles) {
    const order = profile.priority.length ? profile.priority : profile.packageIds;
    const sourceInventories = order.map((id) => packageInventories.get(id));
    if (!sourceInventories.length || sourceInventories.some((item) => !item)) continue;
    profileFingerprints.set(profile.id, mergedInventory(sourceInventories as SoundTreeInventory[]).contentHash);
  }

  const markerRead = await readMarker(destination);
  const marker = markerRead.marker;
  const markerProfile = marker?.profileId ? profiles.find((profile) => profile.id === marker.profileId) : undefined;
  const markerPackageInventories = marker?.packageIds.map((id) => packageInventories.get(id)) ?? [];
  const markerHash = markerProfile
    ? profileFingerprints.get(markerProfile.id)
    : markerPackageInventories.length > 0 && markerPackageInventories.every(Boolean)
      ? mergedInventory(markerPackageInventories as SoundTreeInventory[]).contentHash
      : null;

  const matchingProfiles = profiles.filter((profile) => profileFingerprints.get(profile.id) === inventory.contentHash);
  const matchedProfile = preferredProfile(matchingProfiles);
  const matchingPackages = sounds.filter((sound) => packageInventories.get(sound.id)?.contentHash === inventory.contentHash);
  const matchedPackage = matchingPackages.find((sound) => sound.active) ?? matchingPackages[0];
  const packageProfile = matchedPackage
    ? preferredProfile(profiles.filter((profile) => profile.packageIds.length === 1 && profile.packageIds[0] === matchedPackage.id))
    : undefined;
  const fingerprintProfile = matchedProfile ?? packageProfile;

  let ownership: ExternalSoundState['ownership'];
  let packageIds: string[] = [];
  let profileId: string | null = null;
  if (markerRead.present && markerHash === inventory.contentHash) {
    ownership = 'managed';
    packageIds = markerProfile?.packageIds ?? fingerprintProfile?.packageIds ?? marker?.packageIds ?? [];
    profileId = markerProfile?.id ?? fingerprintProfile?.id ?? null;
  } else if (fingerprintProfile || matchedPackage) {
    ownership = 'matched';
    packageIds = fingerprintProfile?.packageIds ?? (matchedPackage ? [matchedPackage.id] : []);
    profileId = fingerprintProfile?.id ?? null;
  } else if (markerRead.present) {
    const referencesKnownContent = Boolean(markerProfile)
      || Boolean(marker?.packageIds.length && marker.packageIds.some((id) => packageInventories.has(id)));
    ownership = referencesKnownContent ? 'modified' : 'stale';
  } else {
    ownership = 'unmanaged';
  }

  const warnings = [...inventory.warnings];
  if (inventory.soundFileCount === 0) warnings.push('The folder has files, but no recognized FMOD bank or audio extensions were found.');
  if (config.status === 'partial') warnings.push('The sound configuration is incomplete or contradictory.');
  if (config.status === 'missing') warnings.push('config.blk does not contain a readable sound-mod setting.');
  if (config.status === 'unreadable') warnings.push('config.blk could not be read.');
  if (markerRead.malformed) warnings.push('The existing Tailmark management marker is malformed.');
  if (ownership === 'modified') warnings.push('Files changed after Tailmark last activated this install; Tailmark will not delete it as managed content.');
  if (ownership === 'stale') warnings.push('The management marker references packages or a profile that are no longer in the library.');

  return {
    present: true,
    enabled: config.enableMod === true,
    managed: ownership === 'managed',
    markerPresent: markerRead.present,
    ownership,
    fileCount: inventory.fileCount,
    soundFileCount: inventory.soundFileCount,
    totalSize: inventory.totalSize,
    path: destination,
    contentHash: inventory.contentHash,
    packageIds,
    profileId,
    config,
    warnings,
  };
}

export function syncActiveSoundState(
  sounds: SoundPackage[],
  profiles: SoundProfile[],
  marker: ManagedSoundMarker | null,
  enabled = true,
): {
  sounds: SoundPackage[];
  profiles: SoundProfile[];
  activeSoundPackageId: string | null;
  activeSoundProfileId: string | null;
} {
  if (!marker || marker.packageIds.length === 0 || !enabled) {
    return {
      sounds: sounds.map((sound) => ({ ...sound, active: false })),
      profiles: profiles.map((profile) => ({ ...profile, active: false })),
      activeSoundPackageId: null,
      activeSoundProfileId: null,
    };
  }
  const activePackages = new Set(marker.packageIds);
  const profileId = marker.profileId && profiles.some((profile) => profile.id === marker.profileId)
    ? marker.profileId
    : null;
  return {
    sounds: sounds.map((sound) => ({ ...sound, active: activePackages.has(sound.id) })),
    profiles: profiles.map((profile) => ({ ...profile, active: profile.id === profileId })),
    activeSoundPackageId: profileId ? null : marker.packageIds[0] ?? null,
    activeSoundProfileId: profileId,
  };
}
