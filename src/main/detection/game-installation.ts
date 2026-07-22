import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { GameInstallation } from '@shared/models';

async function exists(path: string): Promise<boolean> {
  return access(path, constants.F_OK).then(() => true).catch(() => false);
}

function steamRoots(): string[] {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const programFiles64 = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  return [join(programFiles, 'Steam'), join(programFiles64, 'Steam')];
}

async function parseSteamLibraries(steamRoot: string): Promise<string[]> {
  const libraries = [steamRoot];
  try {
    const vdf = await readFile(join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      if (match[1]) libraries.push(match[1].replace(/\\\\/g, '\\'));
    }
  } catch { /* Steam may not be installed here. */ }
  return [...new Set(libraries.map(normalize))];
}

export async function validateGameInstallation(root: string, source: GameInstallation['source'] = 'manual'): Promise<GameInstallation> {
  const normalized = normalize(root);
  const evidence: string[] = [];
  let confidence = 0;
  const rootStat = await stat(normalized).catch(() => null);
  if (!rootStat?.isDirectory()) {
    return { root: normalized, source, valid: false, confidence: 0, evidence: ['Directory does not exist.'], validatedAt: new Date().toISOString() };
  }
  if (await exists(join(normalized, 'config.blk'))) { confidence += 40; evidence.push('config.blk'); }
  const executableCandidates = [join(normalized, 'win64', 'aces.exe'), join(normalized, 'aces.exe'), join(normalized, 'win32', 'aces.exe')];
  if ((await Promise.all(executableCandidates.map(exists))).some(Boolean)) { confidence += 40; evidence.push('aces.exe'); }
  if (await exists(join(normalized, 'UserSkins'))) { confidence += 10; evidence.push('UserSkins'); }
  if (await exists(join(normalized, 'sound'))) { confidence += 10; evidence.push('sound'); }
  return { root: normalized, source, valid: confidence >= 70, confidence, evidence, validatedAt: new Date().toISOString() };
}

export async function detectGameInstallation(savedRoot?: string | null): Promise<GameInstallation | null> {
  const candidates: Array<{ path: string; source: GameInstallation['source'] }> = [];
  if (savedRoot) candidates.push({ path: savedRoot, source: 'saved' });
  for (const steamRoot of steamRoots()) {
    for (const library of await parseSteamLibraries(steamRoot)) {
      candidates.push({ path: join(library, 'steamapps', 'common', 'War Thunder'), source: 'steam' });
    }
  }
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  if (local) candidates.push({ path: join(local, 'WarThunder'), source: 'gaijin' });
  if (programFiles) candidates.push({ path: join(programFiles, 'War Thunder'), source: 'gaijin' });
  if (programFilesX86) candidates.push({ path: join(programFilesX86, 'War Thunder'), source: 'gaijin' });

  const seen = new Set<string>();
  const results: GameInstallation[] = [];
  for (const candidate of candidates) {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await validateGameInstallation(candidate.path, candidate.source);
    if (result.valid) results.push(result);
  }
  return results.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}

export function gameSubpath(root: string, ...parts: string[]): string {
  return join(dirname(join(root, 'sentinel')), 'sentinel', '..', ...parts).replace(`${join(root, 'sentinel', '..')}`, root);
}
