import { extname, isAbsolute, relative, resolve } from 'node:path';
import {
  EXECUTABLE_EXTENSIONS,
  JUNK_BASENAMES,
  JUNK_DIRECTORIES,
  MAX_PATH_DEPTH,
} from '@shared/constants';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_INVALID = /[<>:"/\\|?*\u0000-\u001f]/g;

export interface PathCheck {
  normalized: string;
  unsafeReason?: string;
  ignored: boolean;
  executable: boolean;
}

export function checkArchivePath(input: string): PathCheck {
  const forward = input.replace(/\\/g, '/');
  const segments = forward.split('/').filter(Boolean);
  let unsafeReason: string | undefined;

  if (!input || forward.startsWith('/') || forward.startsWith('//') || /^[a-z]:/i.test(forward) || isAbsolute(input)) {
    unsafeReason = 'Absolute archive paths are not allowed.';
  } else if (segments.some((segment) => segment === '..' || segment === '.')) {
    unsafeReason = 'Path traversal segments are not allowed.';
  } else if (segments.some((segment) => segment.includes(':'))) {
    unsafeReason = 'NTFS alternate data stream syntax is not allowed.';
  } else if (segments.length > MAX_PATH_DEPTH) {
    unsafeReason = `Directory depth exceeds the ${MAX_PATH_DEPTH}-level safety limit.`;
  } else if (segments.some((segment) => RESERVED.test(segment) || /[. ]$/.test(segment))) {
    unsafeReason = 'The path contains a reserved or invalid Windows filename.';
  }

  const lower = segments.map((segment) => segment.toLowerCase());
  const basename = lower.at(-1) ?? '';
  const ignored = lower.some((segment) => JUNK_DIRECTORIES.has(segment))
    || JUNK_BASENAMES.has(basename)
    || basename.startsWith('._');
  const executable = EXECUTABLE_EXTENSIONS.has(extname(basename));

  return { normalized: segments.join('/'), ...(unsafeReason ? { unsafeReason } : {}), ignored, executable };
}

export function sanitizeWindowsName(input: string, fallback = 'Imported Mod'): string {
  let value = input.replace(WINDOWS_INVALID, '_').replace(/[. ]+$/g, '').trim();
  if (!value) value = fallback;
  if (RESERVED.test(value)) value = `${value}_mod`;
  return value.slice(0, 180);
}

/** Make an opaque id safe as a single Windows path segment (e.g. operation ids with colons). */
export function filesystemSafeSegment(input: string, fallback = 'segment'): string {
  let value = input.replace(WINDOWS_INVALID, '_').replace(/[. ]+$/g, '').trim();
  if (!value) value = fallback;
  return value.slice(0, 180);
}

export function assertPathInside(parent: string, candidate: string): string {
  const root = resolve(parent);
  const target = resolve(candidate);
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return target;
  throw new Error(`Destination escapes the allowed directory: ${candidate}`);
}

export function isJunkPath(path: string): boolean {
  return checkArchivePath(path).ignored;
}
