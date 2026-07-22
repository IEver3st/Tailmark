export interface HashCandidate { archiveHash?: string; contentHash?: string; displayName?: string; name?: string }

export function findContentDuplicate(hash: string, candidates: HashCandidate[]): string | undefined {
  if (!hash) return undefined;
  const candidate = candidates.find((item) => (item.archiveHash ?? item.contentHash) === hash);
  return candidate?.displayName ?? candidate?.name;
}
