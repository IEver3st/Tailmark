import { extname } from 'node:path';
import { README_PATTERN, SKIN_TEXTURE_EXTENSIONS, SOUND_EXTENSIONS } from '@shared/constants';
import type { ArchiveEntry, DetectedMod, DetectionReason } from '@shared/models';

export function classifyArchive(entries: ArchiveEntry[]): DetectedMod {
  const files = entries.filter((entry) => !entry.isDirectory && !entry.ignored && !entry.unsafeReason);
  const signalFiles = files.filter((entry) => !README_PATTERN.test(entry.normalizedPath));
  const reasons: DetectionReason[] = [];
  let skin = 0;
  let sound = 0;

  const blk = signalFiles.filter((entry) => extname(entry.normalizedPath).toLowerCase() === '.blk');
  const textures = signalFiles.filter((entry) => SKIN_TEXTURE_EXTENSIONS.has(extname(entry.normalizedPath).toLowerCase()));
  const soundBanks = signalFiles.filter((entry) => ['.bank', '.fsb', '.fev'].includes(extname(entry.normalizedPath).toLowerCase()));
  const audio = signalFiles.filter((entry) => SOUND_EXTENSIONS.has(extname(entry.normalizedPath).toLowerCase()));
  const soundPaths = signalFiles.filter((entry) => /(^|\/)sound(\/mod)?\//i.test(entry.normalizedPath));

  if (blk.length > 0) {
    skin += 30;
    reasons.push({ label: `${blk.length} BLK definition ${blk.length === 1 ? 'file' : 'files'}`, weight: 30, kind: 'skin' });
  }
  if (textures.length > 0) {
    const weight = Math.min(35, 15 + textures.length * 3);
    skin += weight;
    reasons.push({ label: `${textures.length} texture ${textures.length === 1 ? 'file' : 'files'}`, weight, kind: 'skin' });
  }
  if (blk.length > 0 && textures.length > 0) {
    skin += 25;
    reasons.push({ label: 'BLK definitions and textures occur together', weight: 25, kind: 'skin' });
  }
  if (soundBanks.length > 0) {
    sound += 60;
    reasons.push({ label: `${soundBanks.length} FMOD bank ${soundBanks.length === 1 ? 'file' : 'files'}`, weight: 60, kind: 'sound' });
  }
  if (soundPaths.length > 0) {
    sound += 25;
    reasons.push({ label: 'Files use a War Thunder sound/mod layout', weight: 25, kind: 'sound' });
  }
  if (audio.length >= 3) {
    sound += 20;
    reasons.push({ label: `${audio.length} audio assets`, weight: 20, kind: 'sound' });
  }

  const hasExecutable = files.some((entry) => entry.executable);
  const unsafe = entries.filter((entry) => entry.unsafeReason);
  if (hasExecutable) reasons.push({ label: 'Executable content requires review and will never run', weight: 100, kind: 'safety' });
  if (unsafe.length > 0) reasons.push({ label: `${unsafe.length} unsafe archive ${unsafe.length === 1 ? 'path' : 'paths'}`, weight: 100, kind: 'safety' });

  const credibleSkin = skin >= 55;
  const credibleSound = sound >= 55;
  let type: DetectedMod['type'];
  if (credibleSkin && credibleSound) type = 'ambiguous';
  else if (credibleSkin) type = 'skin';
  else if (credibleSound) type = 'sound';
  else type = 'unsupported';

  const confidence = type === 'skin' ? Math.min(100, skin) : type === 'sound' ? Math.min(100, sound) : 0;
  return {
    type,
    confidence,
    reasons,
    needsReview: type === 'ambiguous' || type === 'unsupported' || hasExecutable || unsafe.length > 0,
  };
}

export function isCredibleSkin(entries: ArchiveEntry[]): boolean {
  return classifyArchive(entries).type === 'skin';
}
