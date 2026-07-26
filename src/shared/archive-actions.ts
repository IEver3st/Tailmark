import type { ArchiveAnalysis, InstallResult } from './models';

const DUPLICATE_WARNING_CODES = new Set(['duplicate-skin', 'duplicate-sound']);

export function isDuplicateArchive(analysis: ArchiveAnalysis): boolean {
  return analysis.warnings.some((warning) => DUPLICATE_WARNING_CODES.has(warning.code));
}

export function isIgnoredDuplicateArchive(analysis: ArchiveAnalysis): boolean {
  return analysis.status === 'skipped' && isDuplicateArchive(analysis);
}

export function shouldIncludeInInstallBatch(
  analysis: ArchiveAnalysis,
  _recycleSourceZips: boolean,
): boolean {
  return ['ready', 'conflict', 'duplicate'].includes(analysis.status)
    || isIgnoredDuplicateArchive(analysis);
}

export function shouldRecycleSourceArchive(
  result: InstallResult,
  analysis: ArchiveAnalysis,
  recycleInstalledSkins = true,
): boolean {
  if (!result.success) return false;
  const type = analysis.manualType ?? analysis.detected.type;
  return (recycleInstalledSkins && result.status === 'installed' && type === 'skin')
    || (result.status === 'skipped' && isIgnoredDuplicateArchive(analysis));
}
