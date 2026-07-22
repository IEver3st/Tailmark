import type { AppSettings } from '../models';
import { DEFAULT_THEME } from '../themes';

export const APP_NAME = 'Tailmark';
export const DATA_VERSION = 1;
export const MAX_ARCHIVE_FILES = 25_000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_COMPRESSION_RATIO = 500;
export const MAX_PATH_DEPTH = 24;
export const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.ps1', '.msi', '.dll', '.scr', '.com', '.vbs', '.js', '.jar', '.lnk',
]);
export const JUNK_BASENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
export const JUNK_DIRECTORIES = new Set(['__macosx']);
export const SKIN_TEXTURE_EXTENSIONS = new Set(['.dds', '.tga', '.png', '.jpg', '.jpeg']);
export const SOUND_EXTENSIONS = new Set(['.bank', '.fsb', '.fev', '.wav', '.ogg']);
export const README_PATTERN = /(^|\/)(readme|instructions?|install)(\.[^/]*)?$/i;

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  theme: DEFAULT_THEME,
  gameRoot: null,
  autoDetectInstallation: true,
  defaultDuplicateBehaviour: 'skip',
  ignoreDuplicateContent: true,
  deleteSourceZipAfterInstall: false,
  retainBackupCount: 10,
  confirmBeforeReplacement: true,
  advancedSoundMerging: false,
  activeSoundPackageId: null,
  activeSoundProfileId: null,
};
