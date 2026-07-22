import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectDirectoryContent, type DirectoryContentSummary } from '@main/archives/content-fingerprint';
import { WARM_FOLDER_CONCURRENCY, mapWithConcurrency } from '@main/concurrency';
import { pathExists } from '@main/filesystem/file-operations';
import { StateRepository } from '@main/persistence/state';
import type { SkinPackage } from '@shared/models';

export class InstalledSkinIndex {
  private readonly summaries = new Map<string, DirectoryContentSummary>();
  private readonly queued = new Set<string>();
  private warmChain: Promise<void> = Promise.resolve();

  constructor(private readonly repository: StateRepository) {}

  async scan(gameRoot: string | null, recorded: SkinPackage[]): Promise<SkinPackage[]> {
    if (!gameRoot) return recorded;
    const folder = join(gameRoot, 'UserSkins');
    if (!await pathExists(folder)) return recorded;
    const byPath = new Map(recorded.map((skin) => [skin.path.toLowerCase(), skin]));
    const entries = await readdir(folder, { withFileTypes: true });
    const discovered = await Promise.all(entries.map(async (entry): Promise<SkinPackage | null> => {
      if (!entry.isDirectory() || entry.isSymbolicLink() || /^\.(?:tailmark|thundermod)-/i.test(entry.name)) return null;
      const path = join(folder, entry.name);
      if (byPath.has(path.toLowerCase())) return null;
      const folderStat = await stat(path);
      return {
        id: `external:${createHash('sha256').update(path.toLowerCase()).digest('hex').slice(0, 24)}`,
        name: entry.name,
        path,
        installedAt: folderStat.birthtime.toISOString(),
        fileCount: 0,
        totalSize: 0,
        validationStatus: 'valid',
      };
    }));
    for (const skin of discovered) if (skin) byPath.set(skin.path.toLowerCase(), skin);

    const existing = await Promise.all([...byPath.values()].map(async (skin): Promise<SkinPackage | null> => {
      if (!await pathExists(skin.path)) return null;
      const summary = this.summaries.get(skin.path.toLowerCase());
      return summary ? { ...skin, ...summary } : skin;
    }));
    return existing.filter((skin): skin is SkinPackage => skin !== null);
  }

  warm(skins: SkinPackage[]): Promise<void> {
    const pending = skins.filter((skin) => {
      const key = skin.path.toLowerCase();
      if (skin.contentHash?.startsWith('skin-v2:') || this.summaries.has(key) || this.queued.has(key)) return false;
      this.queued.add(key);
      return true;
    });
    if (!pending.length) return this.warmChain;

    this.warmChain = this.warmChain.catch(() => undefined).then(async () => {
      const completed = (await mapWithConcurrency(pending, WARM_FOLDER_CONCURRENCY, async (skin) => {
        const key = skin.path.toLowerCase();
        try {
          const summary = await inspectDirectoryContent(skin.path);
          this.summaries.set(key, summary);
          return { skin, summary };
        } catch {
          // A missing, locked, or linked external folder remains visible but is not indexed.
          return null;
        } finally {
          this.queued.delete(key);
        }
      })).filter((item): item is { skin: SkinPackage; summary: DirectoryContentSummary } => item !== null);

      if (!completed.length) return;
      await this.repository.update((state) => {
        for (const { skin, summary } of completed) {
          const existing = state.skins.find((item) => item.path.toLowerCase() === skin.path.toLowerCase());
          if (existing) Object.assign(existing, summary);
          else state.skins.push({ ...skin, ...summary });
        }
      });
    });
    return this.warmChain;
  }
}
